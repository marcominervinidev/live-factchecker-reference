// The deterministic mock adapter of the Claim Extractor (#29 AC19): mechanics only, never quality. It is the oracle
// of evals/src/harness/adapters/mock.py claim_extractor without its random rates: it answers an expectation (one line
// of a Golden Set labels.jsonl) once its verbatim is completely in the Segments sent in a Turn of its Speaker.
//
// Like a model it reads only the request's blocks, in the text form the Claim Extractor's prompt renders (harness
// text mode; pinned in services/detection/src/claim-extractor/prompt.test.ts):
//   'attribution'          `- <label> -> <name> · <source> · <certainty>` per label
//   'turn'                 `Turn-Block <k> · <label>`, then `<segment id> [<start>–<end>] <text>` per Segment
//   'claim_list', 'delta'  `<claim id> · <speaker> · <sentence>` per Claim
// The Turn's Speaker is the name its label has as `certain`; a label without one names no Speaker.
import { z } from 'zod';

import type { AdapterResult, ModelAdapter, ModelRequest } from '../model-adapter.ts';

/** The fields of a Golden Set label the mock uses; the label's other fields are ignored. */
export interface Expectation {
  readonly id: string;
  readonly speaker: string;
  readonly sentence: string;
  readonly verbatim: string;
  readonly type: string;
  readonly checkworthiness: string;
  readonly kind: string;
  readonly refersTo: string | null;
  readonly repeatOf: string | null;
}

const ExpectationLine = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  sentence: z.string().min(1),
  verbatim: z.string().min(1),
  // The enums of output schema 4.1 (evals/src/harness/schemas.py TYPES, CHECKWORTHINESS, KINDS): a typo in a labels
  // file fails at start instead of making every due call a schema failure.
  type: z.enum(['zahl', 'ereignis', 'zitat', 'ursache']),
  checkworthiness: z.enum(['hoch', 'niedrig']),
  kind: z.enum(['tatsache', 'widerspruch', 'zustimmung', 'meinung_mit_kern']),
  refersTo: z.string().nullable(),
  repeatOf: z.string().nullable(),
  /** Only to order the expectations, not part of an Expectation. */
  start: z.number(),
});

/**
 * Reads the text of a labels.jsonl file, one expectation per non-empty line, ordered by the label's `start` (file
 * order on equal starts), so that expectations due in the same call are answered in the harness's order
 * (evals/src/harness/adapters/mock.py claim_extractor: `for lab in sorted(labels, key=lambda l: l["start"])`) and
 * the Claim ids follow it. An invalid line throws an Error naming its line number and fields, never its content
 * (labels carry Transcript text).
 */
export function parseExpectations(jsonl: string): Expectation[] {
  const lines: { readonly start: number; readonly expectation: Expectation }[] = [];
  jsonl.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`expectations line ${index + 1}: not JSON`);
    }
    const parsed = ExpectationLine.safeParse(value);
    if (!parsed.success) {
      const fields = [
        ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '(line)'))),
      ];
      throw new Error(`expectations line ${index + 1}: invalid ${fields.join(', ')}`);
    }
    const { start, ...expectation } = parsed.data;
    lines.push({ start, expectation });
  });
  return lines.sort((a, b) => a.start - b.start).map((line) => line.expectation);
}

/** Case and punctuation folded away, like the harness (evals/src/harness/util.py norm_word, norm_tokens). */
function normTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) =>
      word
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, ''),
    )
    .filter((word) => word !== '');
}

interface SentSegment {
  readonly id: string;
  readonly text: string;
}

interface ListedClaim {
  readonly id: string;
  readonly sentence: string;
}

interface Prompt {
  readonly turnLabel: string | undefined;
  readonly certainNames: ReadonlyMap<string, string>;
  readonly segments: readonly SentSegment[];
  readonly listed: readonly ListedClaim[];
}

const TURN_HEADER = /^Turn-Block \d+ · (\S+)$/;
const SEGMENT_LINE = /^(\S+) \[[^\]]*\](?: (.*))?$/;
const CLAIM_LINE = /^(\S+) · (.+?) · (.+)$/;

/** Adds the label -> name pairs of an attribution block whose certainty is `certain`. */
function readAttribution(lines: readonly string[], certainNames: Map<string, string>): void {
  for (const line of lines) {
    if (!line.startsWith('- ')) continue;
    const arrow = line.indexOf(' -> ');
    const parts = line.slice(arrow + 4).split(' · ');
    if (arrow < 0 || parts.length < 3 || parts.at(-1) !== 'certain') continue;
    certainNames.set(line.slice(2, arrow), parts.slice(0, -2).join(' · '));
  }
}

/** Adds the Segments of a Turn block not sent before and returns the label of its header, if it has one. */
function readTurn(lines: readonly string[], segments: SentSegment[]): string | undefined {
  for (const line of lines.slice(1)) {
    const match = SEGMENT_LINE.exec(line);
    const id = match?.[1];
    // A Segment is sent once per Turn; a repeated line adds no words.
    if (id !== undefined && !segments.some((s) => s.id === id)) {
      segments.push({ id, text: match?.[2] ?? '' });
    }
  }
  return TURN_HEADER.exec(lines[0] ?? '')?.[1];
}

/** Adds the Claims of a Claim list or delta block. */
function readClaimList(lines: readonly string[], listed: ListedClaim[]): void {
  for (const line of lines) {
    const match = CLAIM_LINE.exec(line);
    if (match?.[1] !== undefined && match[3] !== undefined) {
      listed.push({ id: match[1], sentence: match[3] });
    }
  }
}

function readPrompt(request: ModelRequest): Prompt {
  let turnLabel: string | undefined;
  const certainNames = new Map<string, string>();
  const segments: SentSegment[] = [];
  const listed: ListedClaim[] = [];
  for (const block of request.blocks) {
    const lines = block.text.split('\n');
    if (block.kind === 'attribution') readAttribution(lines, certainNames);
    else if (block.kind === 'turn') turnLabel = readTurn(lines, segments) ?? turnLabel;
    else if (block.kind === 'claim_list' || block.kind === 'delta') readClaimList(lines, listed);
  }
  return { turnLabel, certainNames, segments, listed };
}

/** The ids of the Segments holding the first contiguous occurrence of `verbatim`, or undefined. */
function passage(verbatim: string, segments: readonly SentSegment[]): string[] | undefined {
  const needle = normTokens(verbatim);
  const hay: { word: string; segment: string }[] = segments.flatMap((segment) =>
    normTokens(segment.text).map((word) => ({ word, segment: segment.id })),
  );
  if (needle.length === 0) return undefined;
  for (let start = 0; start + needle.length <= hay.length; start += 1) {
    if (needle.every((word, offset) => hay[start + offset]?.word === word)) {
      const ids = hay.slice(start, start + needle.length).map((entry) => entry.segment);
      return [...new Set(ids)];
    }
  }
  return undefined;
}

export interface MockClaimExtractorOptions {
  readonly expectations: readonly Expectation[];
  /** Reported by every call, fixed. */
  readonly latencySeconds: number;
  /** 1-based numbers of the adapter's calls that answer no JSON. */
  readonly invalidCalls?: readonly number[];
}

/** The mock adapter of the Claim Extractor, name `mock`; product mode (no `discarded`). */
export function createMockClaimExtractor(options: MockClaimExtractorOptions): ModelAdapter {
  const answered = new Map<string, Set<string>>();
  const invalid = new Set(options.invalidCalls ?? []);
  let calls = 0;

  /** The listed id of the Claim whose sentence is the referenced expectation's (harness mock.py _card_for). */
  function listedIdOf(expectationId: string, listed: readonly ListedClaim[]): string | null {
    const referenced = options.expectations.find((e) => e.id === expectationId);
    if (referenced === undefined) return null;
    const key = normTokens(referenced.sentence).join(' ');
    return listed.find((claim) => normTokens(claim.sentence).join(' ') === key)?.id ?? null;
  }

  /** The Claim an expectation becomes, or a Candidate when the Claim it answers is not listed (bezug_unklar). */
  function elementFor(
    expectation: Expectation,
    segmentIds: readonly string[],
    listed: readonly ListedClaim[],
  ): { readonly list: 'claims' | 'candidates'; readonly value: Record<string, unknown> } {
    const refersTo =
      expectation.refersTo === null ? null : listedIdOf(expectation.refersTo, listed);
    if (expectation.refersTo !== null && refersTo === null) {
      const value = {
        speaker: expectation.speaker,
        verbatim: expectation.verbatim,
        segmentIds,
        reason: 'bezug_unklar',
        note: 'Bezugsbehauptung nicht in der Behauptungsliste',
      };
      return { list: 'candidates', value };
    }
    const value = {
      speaker: expectation.speaker,
      sentence: expectation.sentence,
      verbatim: expectation.verbatim,
      segmentIds,
      type: expectation.type,
      checkworthiness: expectation.checkworthiness,
      kind: expectation.kind,
      refersTo,
      repeatOf: expectation.repeatOf === null ? null : listedIdOf(expectation.repeatOf, listed),
    };
    return { list: 'claims', value };
  }

  function answer(request: ModelRequest, done: Set<string>): string {
    const prompt = readPrompt(request);
    const speaker =
      prompt.turnLabel === undefined ? undefined : prompt.certainNames.get(prompt.turnLabel);
    const output: Record<'claims' | 'candidates', Record<string, unknown>[]> = {
      claims: [],
      candidates: [],
    };
    for (const expectation of options.expectations) {
      if (speaker === undefined || expectation.speaker !== speaker || done.has(expectation.id))
        continue;
      const segmentIds = passage(expectation.verbatim, prompt.segments);
      if (segmentIds === undefined) continue;
      done.add(expectation.id);
      const element = elementFor(expectation, segmentIds, prompt.listed);
      output[element.list].push(element.value);
    }
    return JSON.stringify(output);
  }

  return {
    name: 'mock',
    call(request: ModelRequest): Promise<AdapterResult> {
      calls += 1;
      const common = {
        latencySeconds: options.latencySeconds,
        model: request.model,
        adapter: 'mock',
      };
      if (request.role !== 'claim_extractor') {
        const message = `the mock has no behaviour for the role ${request.role}`;
        return Promise.resolve({ ok: false, error: { kind: 'fatal', message }, ...common });
      }
      // The mock reports no tokens; token figures come with a real adapter (T7).
      const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
      if (invalid.has(calls)) {
        // A discarded attempt leaves the oracle as it was, as in the harness mock.
        return Promise.resolve({ ok: true, text: 'kein JSON (Mock)', usage, ...common });
      }
      let done = answered.get(request.sessionId);
      if (done === undefined) {
        done = new Set();
        answered.set(request.sessionId, done);
      }
      return Promise.resolve({ ok: true, text: answer(request, done), usage, ...common });
    },
  };
}
