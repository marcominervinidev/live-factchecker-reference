// One model call with validation and at most `retries` repeats (docs/spec/erkennung-modellrollen.md 4.2; #29 AC8 to
// AC10). Reference: evals/src/harness/adapters/base.py call_validated, parse_json and split_elements.
//
// A repeat happens only when the answer as a whole is unusable: no JSON, a schema violation, a contract violation
// outside the element lists, or a retryable or timeout adapter error. A contract violation of one element of a
// listed list drops only that element and is never repeated (ADR 0004, addendum 2026-10-26). A fatal adapter error
// ends the call at once. Both attempts together are bounded by `request.deadline`: the attempt still running then is
// aborted, and when the latencies the attempts report add up to more than the time to the deadline (the simulated
// clock of a replay), the call is lost too; either way as a timeout that took the time from its start to the
// deadline.
import type { z } from 'zod';

import type { AdapterResult, ContentBlock, ModelAdapter, ModelRequest } from './model-adapter.ts';

/** A violation of the contract check; `path` like the harness, e.g. `$.claims[0].verbatim`. */
export interface ContractViolation {
  readonly path: string;
  readonly message: string;
  readonly reason?: string;
}

export interface DroppedElement {
  readonly list: string;
  readonly index: number;
  readonly violations: readonly ContractViolation[];
}

export type CallOutcome<T> =
  | {
      readonly kind: 'valid';
      readonly data: T;
      readonly attempts: number;
      readonly latencySeconds: number;
      readonly dropped: readonly DroppedElement[];
    }
  | {
      readonly kind: 'schema_failure' | 'adapter_error' | 'timeout' | 'fatal';
      readonly attempts: number;
      readonly latencySeconds: number;
    };

export interface CallValidatedOptions<T> {
  /** The whole answer. */
  readonly schema: z.ZodType<T>;
  readonly contract?: (data: T) => readonly ContractViolation[];
  /** Lists of the answer whose elements a contract violation drops one by one (`claims`, `candidates`). */
  readonly elementLists?: readonly string[];
  /** schema_retries (spec 8), default 1. */
  readonly retries?: number;
}

type FailureKind = 'schema_failure' | 'adapter_error' | 'timeout';

type Checked<T> =
  | { readonly usable: true; readonly data: T; readonly dropped: readonly DroppedElement[] }
  | { readonly usable: false; readonly kind: FailureKind; readonly errors: readonly string[] };

const ELEMENT_PATH = /^\$\.(\w+)\[(\d+)\]/;

/** The harness's parse_json: tolerates a Markdown code fence around the JSON. */
function parseJson(text: string): unknown {
  let body = text.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^`+|`+$/g, '');
    if (body.startsWith('json')) body = body.slice(4);
  }
  return JSON.parse(body) as unknown;
}

function issuePath(path: readonly PropertyKey[]): string {
  return `$${path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('')}`;
}

function issues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`);
}

function describe(violations: readonly ContractViolation[]): string[] {
  return violations.map((violation) => `${violation.path}: ${violation.message}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The key `<list>[<index>]` of the existing listed element a violation names, or undefined: then the violation
 * belongs to the envelope.
 */
function elementKey(
  data: Readonly<Record<string, unknown>>,
  violation: ContractViolation,
  lists: readonly string[],
): string | undefined {
  const match = ELEMENT_PATH.exec(violation.path);
  const list = match?.[1];
  if (list === undefined || !lists.includes(list)) return undefined;
  const items = data[list];
  const index = Number(match?.[2]);
  // A violation naming an element the answer does not have belongs to no single element (AC9) and so to the
  // envelope; the harness's split_elements ignores it instead.
  return Array.isArray(items) && index < items.length ? `${list}[${String(index)}]` : undefined;
}

/** The answer without the listed elements that have violations, and those elements with their violations. */
function dropElements(
  data: Readonly<Record<string, unknown>>,
  byElement: ReadonlyMap<string, readonly ContractViolation[]>,
  lists: readonly string[],
): { kept: Record<string, unknown>; dropped: DroppedElement[] } {
  const kept: Record<string, unknown> = { ...data };
  const dropped: DroppedElement[] = [];
  for (const list of lists) {
    const items = data[list];
    if (!Array.isArray(items)) continue;
    kept[list] = items.filter((_item: unknown, index) => {
      const own = byElement.get(`${list}[${String(index)}]`);
      if (own === undefined) return true;
      dropped.push({ list, index, violations: own });
      return false;
    });
  }
  return { kept, dropped };
}

/** Splits contract violations into those of single existing listed elements and the rest (the envelope). */
function splitElements(
  data: Readonly<Record<string, unknown>>,
  violations: readonly ContractViolation[],
  lists: readonly string[],
): { kept: Record<string, unknown>; dropped: DroppedElement[]; envelope: ContractViolation[] } {
  const byElement = new Map<string, ContractViolation[]>();
  const envelope: ContractViolation[] = [];
  for (const violation of violations) {
    const key = elementKey(data, violation, lists);
    if (key === undefined) envelope.push(violation);
    else byElement.set(key, [...(byElement.get(key) ?? []), violation]);
  }
  return { ...dropElements(data, byElement, lists), envelope };
}

/** The answer text as JSON, or why it is none. */
function readJson(
  text: string,
):
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, value: parseJson(text) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unlesbar' };
  }
}

/**
 * Applies contract violations of an answer that fits the schema: violations of single listed elements drop those
 * elements; any other violation makes the whole answer unusable (AC9).
 */
function checkElements<T>(
  json: unknown,
  violations: readonly ContractViolation[],
  options: CallValidatedOptions<T>,
): Checked<T> {
  const lists = options.elementLists ?? [];
  const whole = { usable: false, kind: 'schema_failure', errors: describe(violations) } as const;
  if (lists.length === 0 || !isRecord(json)) return whole;
  const split = splitElements(json, violations, lists);
  if (split.envelope.length > 0) return whole;
  // Dropping elements can break the schema (a list with a lower bound): check the rest again and repeat the answer
  // as a schema violation if it fails (gate 1, question 1: "repeat only for no JSON, schema violation or adapter
  // error").
  const rest = options.schema.safeParse(split.kept);
  if (rest.success) return { usable: true, data: rest.data, dropped: split.dropped };
  return {
    usable: false,
    kind: 'schema_failure',
    errors: [...describe(violations), ...issues(rest.error)],
  };
}

function check<T>(result: AdapterResult, options: CallValidatedOptions<T>): Checked<T> {
  if (!result.ok) {
    const kind = result.error.kind === 'timeout' ? 'timeout' : 'adapter_error';
    return { usable: false, kind, errors: [`Adapterfehler: ${result.error.message}`] };
  }
  const json = readJson(result.text);
  if (!json.ok) {
    return {
      usable: false,
      kind: 'schema_failure',
      errors: [`kein gültiges JSON: ${json.reason}`],
    };
  }
  const parsed = options.schema.safeParse(json.value);
  if (!parsed.success) {
    return { usable: false, kind: 'schema_failure', errors: issues(parsed.error) };
  }
  const violations = options.contract?.(parsed.data) ?? [];
  if (violations.length === 0) return { usable: true, data: parsed.data, dropped: [] };
  return checkElements(json.value, violations, options);
}

/** The block appended to the repeat, as the harness words it (at most ten violations). */
function retryBlock(errors: readonly string[]): ContentBlock {
  const text =
    'Deine letzte Antwort verletzte das Ausgabeschema oder den Vertrag:\n- ' +
    errors.slice(0, 10).join('\n- ') +
    '\nAntworte erneut, vollständig und nur mit gültigem JSON.';
  return { kind: 'retry', text, cache: false, system: false };
}

/** The deadline of both attempts and the abort of the caller, joined into the one signal the adapter gets. */
interface Clock {
  readonly signal: AbortSignal;
  /** Settles with 'deadline' once the time to the deadline has run out; the attempt still running is aborted. */
  readonly deadline: Promise<'deadline'>;
  readonly deadlinePassed: () => boolean;
  /** Clears the timer and the listener on the caller's signal. */
  readonly stop: () => void;
}

function startClock(callerSignal: AbortSignal, budgetMs: number): Clock {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (callerSignal.aborted) abort();
  else callerSignal.addEventListener('abort', abort, { once: true });
  let passed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => {
      passed = true;
      abort();
      resolve('deadline');
    }, budgetMs);
  });
  return {
    signal: controller.signal,
    deadline,
    deadlinePassed: () => passed,
    stop: () => {
      clearTimeout(timer);
      callerSignal.removeEventListener('abort', abort);
    },
  };
}

/** Where a call stands between its attempts. */
interface Progress {
  attempts: number;
  latencySeconds: number;
  /** The kind of the last unusable attempt. */
  kind: FailureKind;
}

type Lost = Exclude<CallOutcome<never>, { readonly kind: 'valid' }>;

type Unusable = Extract<Checked<never>, { readonly usable: false }>;

/** The outcome that ends the call before another attempt starts, or undefined when one may start. */
function stopBefore(budgetMs: number, clock: Clock, progress: Progress): Lost | undefined {
  const { attempts, latencySeconds, kind } = progress;
  // No attempt starts once the deadline has passed (AC10: the call is lost) or the caller has aborted.
  if (budgetMs === 0 || clock.deadlinePassed()) {
    return { kind: 'timeout', attempts, latencySeconds: budgetMs / 1000 };
  }
  // Before any attempt there is no answer whose kind could end the call: an abort is never repeated, which is what
  // `fatal` means at the port; after an attempt the call ends with that attempt's kind.
  if (clock.signal.aborted)
    return { kind: attempts === 0 ? 'fatal' : kind, attempts, latencySeconds };
  return undefined;
}

/** The outcome an answered attempt ends the call with, or the unusable check that is repeated. */
function settle<T>(
  result: AdapterResult,
  progress: Progress,
  budgetMs: number,
  options: CallValidatedOptions<T>,
): CallOutcome<T> | Unusable {
  const { attempts, latencySeconds } = progress;
  // The reported latency counts against the deadline as well: on the simulated clock of a replay no wall-clock
  // time passes (AC10: "the 15 s deadline for both attempts together passes, the call is lost"; harness
  // pipeline.py call_verifier: `timed_out = outcome.latency > timeout`).
  if (latencySeconds > budgetMs / 1000) {
    return { kind: 'timeout', attempts, latencySeconds: budgetMs / 1000 };
  }
  if (!result.ok && result.error.kind === 'fatal')
    return { kind: 'fatal', attempts, latencySeconds };
  const checked = check(result, options);
  if (!checked.usable) return checked;
  return { kind: 'valid', data: checked.data, attempts, latencySeconds, dropped: checked.dropped };
}

/**
 * Calls the adapter, validates the answer and repeats an unusable one with the violations appended as one block.
 * Never rejects for an answer or an adapter error; `attempts` counts the adapter calls it started.
 */
export async function callValidated<T>(
  adapter: ModelAdapter,
  request: ModelRequest,
  options: CallValidatedOptions<T>,
): Promise<CallOutcome<T>> {
  const retries = options.retries ?? 1;
  const budgetMs = Math.max(0, request.deadline - Date.now());
  const clock = startClock(request.signal, budgetMs);
  const progress: Progress = { attempts: 0, latencySeconds: 0, kind: 'schema_failure' };
  let blocks = request.blocks;
  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const lost = stopBefore(budgetMs, clock, progress);
      if (lost !== undefined) return lost;
      progress.attempts += 1;
      const result = await Promise.race([
        adapter.call({ ...request, blocks, signal: clock.signal }),
        clock.deadline,
      ]);
      if (result === 'deadline') {
        return { kind: 'timeout', attempts: progress.attempts, latencySeconds: budgetMs / 1000 };
      }
      progress.latencySeconds += result.latencySeconds;
      const step = settle(result, progress, budgetMs, options);
      if (!('usable' in step)) return step;
      progress.kind = step.kind;
      blocks = [...request.blocks, retryBlock(step.errors)];
    }
    return {
      kind: progress.kind,
      attempts: progress.attempts,
      latencySeconds: progress.latencySeconds,
    };
  } finally {
    clock.stop();
  }
}
