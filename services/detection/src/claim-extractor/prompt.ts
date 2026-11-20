// Prompt assembly of the Claim Extractor (docs/spec/erkennung-modellrollen.md 3; ADR 0004: append-only blocks for
// caching; #29 AC1 to AC7). Port of evals/src/harness/prompt.py in text mode (render_setting, render_attribution,
// render_claim_list, cap_claim_list, render_context, render_turn_block, assign_breakpoints, prefix_block,
// FINAL_INSTRUCTION, ClaimPromptState) and pipeline.py (prompt_state, delta_cards, context_items). Pure, no I/O.
import type { Segment } from '@lfc/contracts';
import type { ContentBlock } from '@lfc/providers';

import type { Turn } from '../turns/types.ts';
import { claimExtractorJsonSchema, segmentText, splitWords } from './output-schema.ts';

export interface SettingSpeaker {
  readonly name: string;
  readonly role: 'moderator' | 'host' | 'guest' | 'private';
  /** Whether a public figure (docs/spec/sprecher.md 1). */
  readonly public: boolean;
}

export interface Setting {
  readonly mode: 'broadcast' | 'conversation';
  readonly speakers?: readonly SettingSpeaker[];
  readonly topic?: string;
}

export interface ClaimShort {
  readonly id: string;
  readonly speaker: string;
  readonly sentence: string;
}

export interface ContextItem {
  readonly speaker: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Spec 8: context_token_cap, claim_list_cap, cache_block_breakpoint; tokens per word of the model. */
export interface PromptParameters {
  readonly contextTokenCap: number;
  readonly claimListCap: number;
  readonly cacheBlockBreakpoint: number;
  readonly tokensPerWord: number;
}

export interface ClaimPrompt {
  /** One call of the Turn: appends one Turn block and returns every block of this request. */
  next(
    call: {
      readonly speaker: string;
      readonly segments: readonly Segment[];
      readonly final: boolean;
    },
    claims: readonly ClaimShort[],
  ): readonly ContentBlock[];
  /** The ids of the Claim list block. */
  readonly listedIds: ReadonlySet<string>;
}

const FINAL_INSTRUCTION =
  'Gib nur aus, was in der Behauptungsliste und den Delta-Behauptungen noch nicht steht; verweise Wiederholungen mit `repeatOf`.';
const MODE = { broadcast: 'Sendung', conversation: 'Gespräch' } as const;
const ROLE = {
  moderator: 'Moderation',
  host: 'Host',
  guest: 'Gast',
  private: 'private Person',
} as const;

function block(kind: string, text: string, cache = false): ContentBlock {
  return { kind, text, cache, system: false };
}

/** Python's f"{x:.2f}": an exact tie (an odd eighth) rounds half to even, where toFixed rounds up. */
export function fmt(seconds: number): string {
  if (!Number.isInteger(seconds * 8) || Number.isInteger(seconds * 4)) return seconds.toFixed(2);
  const down = Math.floor(seconds * 100);
  return ((down + (down % 2)) / 100).toFixed(2);
}

/** json.dumps(value, ensure_ascii=False, sort_keys=True), byte for byte. */
export function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`;
  if (!(value instanceof Object)) return JSON.stringify(value);
  const entries = new Map(Object.entries(value));
  const keys = [...entries.keys()].sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${pythonJson(entries.get(key))}`).join(', ')}}`;
}

function speakerLine(speaker: SettingSpeaker): string {
  const figure = speaker.public ? 'Person des öffentlichen Lebens' : 'private Person';
  return `- ${speaker.name} (${[...new Set([ROLE[speaker.role], figure])].join(', ')})`;
}

/** The Setting in German words; Speakers and Topic only when the Setting has them (AC2). */
export function renderSetting(setting: Setting): string {
  const speakers = setting.speakers ?? [];
  const lines = [`Modus: ${MODE[setting.mode]}`];
  if (speakers.length > 0) lines.push('Sprecher:', ...speakers.map(speakerLine));
  if (setting.topic !== undefined) lines.push(`Anfangs-Topic: ${setting.topic}`);
  return lines.join('\n');
}

/** Block 1: the instruction trimmed (gate 1 of #29, question 14), output schema 4.1 and the Setting. */
export function prefixBlock(instruction: string, setting: Setting): ContentBlock {
  const parts = [
    instruction.trim(),
    `## Ausgabeschema (JSON)\n${pythonJson(claimExtractorJsonSchema)}`,
    `## Setting\n${renderSetting(setting)}`,
  ];
  return { kind: 'prefix', text: parts.join('\n\n'), cache: false, system: true };
}

/** Block 1a: each label seen, `certain` with its name, else `none`. */
export function attributionBlock(
  labels: readonly string[],
  names: Readonly<Record<string, string>>,
): ContentBlock {
  const lines = labels.map((label) => {
    const name = Object.hasOwn(names, label) ? names[label] : undefined;
    return name === undefined
      ? `- ${label} -> nicht zugeordnet · keine Quelle · none`
      : `- ${label} -> ${name} · Referenz-Transkript · certain`;
  });
  return block(
    'attribution',
    ['Zuordnungstabelle (Label -> Sprecher, Quelle, Sicherheit):', ...lines].join('\n'),
  );
}

const start = (turn: Turn) => turn.segments[0]?.start ?? Infinity;

/** The harness's Turn order (turns.py: `turns.sort(key=lambda t: (t.start, t.id))`), whatever order `turns` has. */
function byStart(a: Turn, b: Turn): number {
  // Turn ids are unique in a Session, so two Turns never compare equal.
  return start(a) - start(b) || (a.id < b.id ? -1 : 1);
}

/**
 * The last `count` Turns that started before `current` (none for 0, as pipeline.py context_items), each with its
 * Segments finalized at `at`.
 */
export function selectContext(
  turns: readonly Turn[],
  current: Turn,
  at: number,
  count: number,
): ContextItem[] {
  const earlier = turns.filter((turn) => start(turn) < start(current)).sort(byStart);
  return (count > 0 ? earlier.slice(-count) : []).flatMap((turn) => {
    const segments = turn.segments.filter((segment) => segment.finalizedAt <= at);
    const first = segments[0];
    if (first === undefined) return [];
    const last = segments[segments.length - 1] ?? first;
    const text = segments.map(segmentText).join(' ');
    return [{ speaker: turn.speaker, start: first.start, end: last.end, text }];
  });
}

/** The most words of `count` whose estimate fits into `allowed` tokens: one multiplication per word dropped. */
function fitting(count: number, allowed: number, tokensPerWord: number): number {
  let words = count;
  while (words > 0 && Math.ceil(words * tokensPerWord) > allowed) words -= 1;
  return words;
}

/**
 * Block 3: while the estimate exceeds the cap, words leave from the beginning of the older Turn first; a cap of 0
 * caps nothing (prompt.py render_context: `if token_cap:`). The total is kept as a number, so the cut is linear.
 */
function renderContext(items: readonly ContextItem[], parameters: PromptParameters): string {
  if (items.length === 0) return 'Kontext-Turns: (keine)';
  const { contextTokenCap: cap, tokensPerWord } = parameters;
  const estimate = (words: number) => Math.ceil(words * tokensPerWord);
  const kept = items.map((item) => ({ item, words: splitWords(item.text) }));
  let total = kept.reduce((sum, { words }) => sum + estimate(words.length), 0);
  for (const entry of cap > 0 ? kept : []) {
    const own = estimate(entry.words.length);
    const keep = fitting(entry.words.length, cap - (total - own), tokensPerWord);
    entry.words = entry.words.slice(entry.words.length - keep);
    total += estimate(keep) - own;
  }
  const parts = kept.map(({ item, words }) => {
    const body = words.length > 0 ? words.join(' ') : '(gekürzt)';
    return `[${item.speaker} · ${fmt(item.start)}–${fmt(item.end)} s]\n${body}`;
  });
  return `Kontext-Turns:\n${parts.join('\n')}`;
}

function renderClaims(title: string, claims: readonly ClaimShort[]): string {
  if (claims.length === 0) return `${title}: (leer)`;
  const lines = claims.map((claim) => `${claim.id} · ${claim.speaker} · ${claim.sentence}`);
  return `${title}:\n${lines.join('\n')}`;
}

function renderTurnBlock(number: number, call: Parameters<ClaimPrompt['next']>[0]): string {
  const lines = call.segments.map(
    (segment) =>
      `${segment.id} [${fmt(segment.start)}–${fmt(segment.end)}] ${segmentText(segment)}`,
  );
  const body = lines.length > 0 ? lines.join('\n') : '(kein neuer Redetext)';
  const end = call.final ? '\n(Ende des Redebeitrags)' : '';
  return `Turn-Block ${number} · ${call.speaker}\n${body}${end}`;
}

/**
 * The prompt state of one Turn: Claim list and context fixed at its first call, one Turn block per call. Breakpoints
 * (AC7): prefix, context, the last Turn block and the latest earlier multiple of `cacheBlockBreakpoint`, so four.
 */
export function createClaimPrompt(options: {
  readonly prefix: ContentBlock;
  readonly attribution: ContentBlock;
  readonly claims: readonly ClaimShort[];
  readonly context: readonly ContextItem[];
  readonly parameters: PromptParameters;
}): ClaimPrompt {
  const { parameters } = options;
  const listed = options.claims.slice(-parameters.claimListCap);
  const listedIds: ReadonlySet<string> = new Set(listed.map((claim) => claim.id));
  const fixed = [
    { ...options.prefix, cache: true },
    { ...options.attribution, cache: false },
    block('claim_list', renderClaims('Behauptungsliste des Gesprächs', listed)),
    block('context', renderContext(options.context, parameters), true),
  ];
  const turns: string[] = [];
  return {
    listedIds,
    next(call, claims) {
      turns.push(renderTurnBlock(turns.length + 1, call));
      const every = parameters.cacheBlockBreakpoint;
      const intermediate = every * Math.floor((turns.length - 1) / every);
      const delta = claims.filter((claim) => !listedIds.has(claim.id));
      return [
        ...fixed,
        ...turns.map((text, i) =>
          block('turn', text, i + 1 === turns.length || i + 1 === intermediate),
        ),
        block(
          'delta',
          renderClaims('Delta-Behauptungen (in diesem Turn bereits ausgegeben)', delta),
        ),
        block('final', FINAL_INSTRUCTION),
      ];
    },
  };
}
