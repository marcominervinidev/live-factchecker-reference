// Stage 1, issue #29 (T4), Task 2: prompt assembly of the Claim Extractor (docs/spec/erkennung-modellrollen.md 3,
// ADR 0004: append-only blocks for caching), AC1 to AC7. Reference: evals/src/harness/prompt.py in text mode
// (render_setting, render_claim_list, cap_claim_list, render_context, render_turn_block, assign_breakpoints,
// prefix_block, FINAL_INSTRUCTION, ClaimPromptState) and pipeline.py (prompt_state, delta_cards, context_items).
// Exact strings below were computed by that harness; a Turn's Speaker is its Session label (the segment contract
// carries labels only), so the label stands where the harness's text mode writes the reference transcript's name.
//
// Public interface these tests define (built in Task 2; pure, no I/O):
//   src/claim-extractor/prompt.ts
//     export interface SettingSpeaker { readonly name: string; readonly role: 'moderator' | 'host' | 'guest' | 'private';
//                                      readonly public: boolean }
//     export interface Setting { readonly mode: 'broadcast' | 'conversation';
//                                readonly speakers?: readonly SettingSpeaker[]; readonly topic?: string }
//     export interface ClaimShort { readonly id: string; readonly speaker: string; readonly sentence: string }
//     export interface ContextItem { readonly speaker: string; readonly start: number; readonly end: number;
//                                    readonly text: string }
//     export interface PromptParameters { readonly contextTokenCap: number; readonly claimListCap: number;
//                                         readonly cacheBlockBreakpoint: number; readonly tokensPerWord: number }
//     export function renderSetting(setting: Setting): string
//     export function prefixBlock(instruction: string, setting: Setting): ContentBlock          // kind 'prefix'
//     export function attributionBlock(labels: readonly string[],
//                                      names: Readonly<Record<string, string>>): ContentBlock    // kind 'attribution'
//     export function selectContext(turns: readonly Turn[], current: Turn, at: number, count: number): ContextItem[]
//     export function createClaimPrompt(options: {
//       readonly prefix: ContentBlock; readonly attribution: ContentBlock;
//       readonly claims: readonly ClaimShort[];     // every Claim of the Session at the Turn's first call, oldest first
//       readonly context: readonly ContextItem[];   // selectContext at the Turn's first call
//       readonly parameters: PromptParameters;
//     }): ClaimPrompt
//     export interface ClaimPrompt {
//       /** One call of the Turn: appends one Turn block, returns every block of this request. `claims` is the
//        *  Session's Claim list now; the delta Claims are those of `claims` whose id is not in `listedIds`. */
//       next(call: { readonly speaker: string; readonly segments: readonly Segment[]; readonly final: boolean },
//            claims: readonly ClaimShort[]): readonly ContentBlock[];
//       readonly listedIds: ReadonlySet<string>;    // the ids of the Claim list block
//     }
//   ContentBlock: { kind, text, cache, system } of @lfc/providers (src/model-adapter.ts), kinds 'prefix',
//   'attribution', 'claim_list', 'context', 'turn', 'delta', 'final'.
// Delta Claims (AC4, owner decision on gate 1 question 9 of 2026-11-03: "Harness-Regel: zusätzlich die vom Deckel
// verdrängten listen"): the delta block lists every Claim of the Session that is not in the Claim list block, i.e. the
// Claims emitted after the list was fixed and, with more than 100 Claims, those the cap displaced. Harness rule,
// evals/src/harness/pipeline.py delta_cards (scope "conversation"):
//   `return [c for c in self.known_until(t) if c["id"] not in ps.frozen_ids]`
// Parameters are spec 8's start values (context_turns 2, context_token_cap 600, claim_list_cap 100,
// cache_block_breakpoint 20) and the token estimate per word of Haiku 5.5, 2.1 (evals/configs/pricing.json).
import {
  attributionBlock,
  createClaimPrompt,
  prefixBlock,
  renderSetting,
  selectContext,
  type ClaimShort,
  type ContextItem,
  type Setting,
} from './prompt.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seg, sid } from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { Turn } from '../turns/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROMPT_FILE = join(ROOT, 'evals', 'configs', 'prompts', 'claim_extractor.v2.de.txt');
const PARAMETERS = {
  contextTokenCap: 600,
  claimListCap: 100,
  cacheBlockBreakpoint: 20,
  tokensPerWord: 2.1,
};

/** claim_extractor_schema(False) of evals/src/harness/schemas.py (spec 4.1 without `discarded`), as the harness
 * prints it with json.dumps. */
const HARNESS_SCHEMA = JSON.parse(
  '{"type": "object", "properties": {"claims": {"type": "array", "items": {"type": "object", "properties": {"speaker": {"type": "string"}, "sentence": {"type": "string"}, "verbatim": {"type": "string"}, "segmentIds": {"type": "array", "items": {"type": "string"}}, "type": {"type": "string", "enum": ["zahl", "ereignis", "zitat", "ursache"]}, "checkworthiness": {"type": "string", "enum": ["hoch", "niedrig"]}, "kind": {"type": "string", "enum": ["tatsache", "widerspruch", "zustimmung", "meinung_mit_kern"]}, "refersTo": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "repeatOf": {"anyOf": [{"type": "string"}, {"type": "null"}]}}, "required": ["speaker", "sentence", "verbatim", "segmentIds", "type", "checkworthiness", "kind", "refersTo", "repeatOf"], "additionalProperties": false}}, "candidates": {"type": "array", "items": {"type": "object", "properties": {"speaker": {"type": "string"}, "verbatim": {"type": "string"}, "segmentIds": {"type": "array", "items": {"type": "string"}}, "reason": {"type": "string", "enum": ["bezug_unklar", "kern_unklar", "sprecher_unklar"]}, "note": {"type": "string"}}, "required": ["speaker", "verbatim", "segmentIds", "reason", "note"], "additionalProperties": false}}}, "required": ["claims", "candidates"], "additionalProperties": false}',
) as unknown;

const FINAL_SENTENCE =
  'Gib nur aus, was in der Behauptungsliste und den Delta-Behauptungen noch nicht steht; verweise Wiederholungen mit `repeatOf`.';

const SETTING: Setting = {
  mode: 'broadcast',
  speakers: [
    { name: 'Kallac Haqy', role: 'moderator', public: true },
    { name: 'Anna Müller', role: 'guest', public: false },
    { name: 'Jens Weber', role: 'host', public: true },
  ],
  topic: 'Mieten in Berlin',
};

function turn(id: string, speaker: string, segments: readonly Segment[]): Turn {
  return { id, speaker, interjection: false, segments };
}

function claim(n: number, speaker = 'Kallac Haqy'): ClaimShort {
  return {
    id: `c-${String(n).padStart(2, '0')}`,
    speaker,
    sentence: `${speaker} behauptet Sachverhalt ${n}.`,
  };
}

function claims(count: number): ClaimShort[] {
  return Array.from({ length: count }, (_, i) => claim(i + 1));
}

function prompt(
  options: { claims?: readonly ClaimShort[]; context?: readonly ContextItem[] } = {},
) {
  return createClaimPrompt({
    prefix: prefixBlock('Anweisung', SETTING),
    attribution: attributionBlock(['A', 'B'], { A: 'Kallac Haqy' }),
    claims: options.claims ?? [],
    context: options.context ?? [],
    parameters: PARAMETERS,
  });
}

const A1 = seg('s-0001', 'A', 0, 2.5, 2.5, 'Die Mieten sind seit 2015');
const A2 = seg('s-0002', 'A', 2.5, 5, 5, 'um 40 Prozent gestiegen.');
const A3 = seg('s-0003', 'A', 5, 7.5, 7.5, 'Das sagt die Statistik.');

const kinds = (blocks: readonly { kind: string }[]) => blocks.map((b) => b.kind);
const textOf = (blocks: readonly { kind: string; text: string }[], kind: string) =>
  blocks.filter((b) => b.kind === kind).map((b) => b.text);
const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe('createClaimPrompt orders the blocks of a request (AC1)', () => {
  it('sends prefix, attribution, Claim list, context, Turn blocks, delta Claims and closing instruction in order', () => {
    const p = prompt();
    p.next({ speaker: 'A', segments: [A1], final: false }, []);
    const blocks = p.next({ speaker: 'A', segments: [A2], final: true }, []);
    expect(kinds(blocks)).toEqual([
      'prefix',
      'attribution',
      'claim_list',
      'context',
      'turn',
      'turn',
      'delta',
      'final',
    ]);
  });

  it('ends with the fixed closing instruction of spec 3, block 6', () => {
    const blocks = prompt().next({ speaker: 'A', segments: [A1], final: false }, []);
    expect(blocks.at(-1)).toMatchObject({ kind: 'final', text: FINAL_SENTENCE });
  });

  it('marks only the prefix as system text', () => {
    const blocks = prompt().next({ speaker: 'A', segments: [A1], final: false }, []);
    expect(blocks.filter((b) => b.system).map((b) => b.kind)).toEqual(['prefix']);
  });
});

describe('prefixBlock holds the instruction, the output schema and the Setting (AC1, AC2)', () => {
  const instruction = readFileSync(PROMPT_FILE, 'utf8');
  const prefix = prefixBlock(instruction, SETTING);

  it('starts with the instruction text of claim_extractor.v2.de.txt byte for byte', () => {
    expect(prefix.kind).toBe('prefix');
    expect(prefix.text.startsWith(`${instruction.trim()}\n\n`)).toBe(true);
  });

  it('carries output schema 4.1 without discarded, exactly as the harness requests it in product mode', () => {
    const match = /## Ausgabeschema \(JSON\)\n(.*)\n\n## Setting\n/s.exec(prefix.text);
    expect(match).not.toBeNull();
    expect(JSON.parse(match?.[1] ?? 'null')).toEqual(HARNESS_SCHEMA);
    // AC1: "the output schema 4.1 without `discarded`". The instruction text itself names `discarded`
    // (its rule for the diagnostic mode), so this checks everything the prefix adds after the
    // instruction: the schema and the Setting.
    expect(prefix.text.slice(instruction.trim().length)).not.toContain('discarded');
  });

  it('ends with the Setting as renderSetting writes it', () => {
    expect(prefix.text.endsWith(`## Setting\n${renderSetting(SETTING)}`)).toBe(true);
  });
});

describe('renderSetting names mode, Speakers and Topic in German words (AC2)', () => {
  const text = renderSetting(SETTING);
  const lines = text.split('\n');
  const lineOf = (name: string) => lines.find((l) => l.includes(name)) ?? '';

  it('names the mode broadcast as "Sendung"', () => {
    expect(lines).toContain('Modus: Sendung');
  });

  it('names the mode conversation as "Gespräch"', () => {
    expect(renderSetting({ ...SETTING, mode: 'conversation' }).split('\n')).toContain(
      'Modus: Gespräch',
    );
  });

  // Harness render_setting: public true -> ", Person des öffentlichen Lebens", public false -> ", private Person".
  it.each([
    ['Kallac Haqy', 'Moderation', true],
    ['Anna Müller', 'Gast', false],
    ['Jens Weber', 'Host', true],
  ] as const)('names %s with role %s and whether a public figure', (name, role, isPublic) => {
    expect(lineOf(name)).toContain(role);
    expect(lineOf(name).includes('Person des öffentlichen Lebens')).toBe(isPublic);
    expect(lineOf(name).includes('private Person')).toBe(!isPublic);
  });

  it('names a private Speaker as "private Person"', () => {
    const own = renderSetting({
      mode: 'conversation',
      speakers: [{ name: 'Tante Inge', role: 'private', public: false }],
    });
    expect(own.split('\n').find((l) => l.includes('Tante Inge'))).toContain('private Person');
  });

  it('names the initial Topic', () => {
    expect(lines).toContain('Anfangs-Topic: Mieten in Berlin');
  });

  it('writes no English value of the Setting into the prompt', () => {
    for (const word of ['broadcast', 'conversation', 'moderator', 'guest', 'host', 'public']) {
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it('renders a Setting with only the mode as a valid prefix without Speakers and without Topic', () => {
    const only = renderSetting({ mode: 'conversation' });
    expect(only).toContain('Gespräch');
    expect(only).not.toContain('Anfangs-Topic');
    expect(only.split('\n').filter((l) => l.startsWith('- '))).toEqual([]);
    const prefix = prefixBlock('Anweisung', { mode: 'conversation' });
    expect(prefix.text.startsWith('Anweisung\n\n')).toBe(true);
    expect(prefix.text.endsWith(`## Setting\n${only}`)).toBe(true);
  });
});

describe('attributionBlock lists the labels seen with their names (block 1a, Assumptions)', () => {
  it('names a label of the mapping as certain and leaves any other label a label with none', () => {
    const block = attributionBlock(['A', 'B', 'C'], { A: 'Kallac Haqy', B: 'Hukgl Suubayy' });
    const lines = block.text.split('\n');
    expect(block.kind).toBe('attribution');
    expect(lines.filter((l) => /^- A -> Kallac Haqy · .+ · certain$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /^- B -> Hukgl Suubayy · .+ · certain$/.test(l))).toHaveLength(1);
    const c = lines.filter((l) => l.startsWith('- C '));
    expect(c).toHaveLength(1);
    expect(c[0]).toContain('none');
    expect(c[0]).not.toContain('certain');
  });

  it('names no label it was not given', () => {
    const block = attributionBlock(['A'], { A: 'Kallac Haqy', B: 'Hukgl Suubayy' });
    expect(block.text).not.toContain('Hukgl Suubayy');
  });
});

describe('the Claim list is fixed at the first call of a Turn (AC3)', () => {
  it('lists every Claim of the Session in short form, oldest first', () => {
    const blocks = prompt({ claims: [claim(1), claim(2, 'Anna Müller')] }).next(
      { speaker: 'A', segments: [A1], final: false },
      [],
    );
    expect(textOf(blocks, 'claim_list')).toEqual([
      'Behauptungsliste des Gesprächs:\nc-01 · Kallac Haqy · Kallac Haqy behauptet Sachverhalt 1.\nc-02 · Anna Müller · Anna Müller behauptet Sachverhalt 2.',
    ]);
  });

  it('says so when the Session has no Claim yet', () => {
    const blocks = prompt().next({ speaker: 'A', segments: [A1], final: false }, []);
    expect(textOf(blocks, 'claim_list')).toEqual(['Behauptungsliste des Gesprächs: (leer)']);
  });

  it.each([
    [99, 'c-01', 99],
    [100, 'c-01', 100],
    [101, 'c-02', 100],
    [150, 'c-51', 100],
  ])('with %i Claims lists from %s on, %i lines', (count, first, lines) => {
    const blocks = prompt({ claims: claims(count) }).next(
      { speaker: 'A', segments: [A1], final: false },
      [],
    );
    const listed = (textOf(blocks, 'claim_list')[0] ?? '').split('\n').slice(1);
    expect(listed).toHaveLength(lines);
    expect(listed[0]?.startsWith(`${first} · `)).toBe(true);
    expect(listed.at(-1)?.startsWith(`c-${String(count).padStart(2, '0')} · `)).toBe(true);
  });

  it('keeps the Claim list identical for every later call of the same Turn', () => {
    const p = prompt({ claims: [claim(1)] });
    const first = p.next({ speaker: 'A', segments: [A1], final: false }, [claim(1)]);
    const later = p.next({ speaker: 'A', segments: [A2], final: true }, [
      claim(1),
      claim(2),
      claim(3),
    ]);
    expect(textOf(later, 'claim_list')).toEqual(textOf(first, 'claim_list'));
    expect([...p.listedIds]).toEqual(['c-01']);
  });
});

describe('the delta Claims are every Claim of the Session not in the Claim list block (AC4, gate 1 question 9)', () => {
  it('lists the Claims emitted since, in short form, oldest first', () => {
    const p = prompt({ claims: [claim(1)] });
    p.next({ speaker: 'A', segments: [A1], final: false }, [claim(1)]);
    const blocks = p.next({ speaker: 'A', segments: [A2], final: false }, [
      claim(1),
      claim(2),
      claim(3, 'Anna Müller'),
    ]);
    expect(textOf(blocks, 'delta')).toEqual([
      'Delta-Behauptungen (in diesem Turn bereits ausgegeben):\nc-02 · Kallac Haqy · Kallac Haqy behauptet Sachverhalt 2.\nc-03 · Anna Müller · Anna Müller behauptet Sachverhalt 3.',
    ]);
  });

  it('says so when no Claim was emitted since', () => {
    const blocks = prompt({ claims: [claim(1)] }).next(
      { speaker: 'A', segments: [A1], final: false },
      [claim(1)],
    );
    expect(textOf(blocks, 'delta')).toEqual([
      'Delta-Behauptungen (in diesem Turn bereits ausgegeben): (leer)',
    ]);
  });

  it('also lists a Claim the cap displaced from the Claim list, oldest first (harness delta_cards, question 9)', () => {
    const p = prompt({ claims: claims(101) });
    const blocks = p.next({ speaker: 'A', segments: [A1], final: false }, [
      ...claims(101),
      claim(102),
    ]);
    const delta = (textOf(blocks, 'delta')[0] ?? '').split('\n').slice(1);
    expect(delta.map((l) => l.split(' · ')[0])).toEqual(['c-01', 'c-102']);
  });
});

describe('selectContext takes the last two Turns that started before the current Turn (AC5)', () => {
  const t1 = turn('t-001', 'A', [seg(sid(1), 'A', 0, 2, 2.5, 'eins zwei')]);
  const t2 = turn('t-002', 'B', [seg(sid(2), 'B', 2, 4, 4.5, 'drei vier')]);
  const t3 = turn('t-003', 'A', [
    seg(sid(3), 'A', 4, 6, 6.5, 'fünf sechs'),
    seg(sid(4), 'A', 6, 8, 12, 'sieben acht'),
  ]);
  const current = turn('t-004', 'B', [seg(sid(5), 'B', 8, 10, 10.5, 'neun zehn')]);

  it('takes the two latest earlier Turns of any Speaker, oldest first, with the text of their Segments', () => {
    expect(selectContext([t1, t2, t3, current], current, 13, 2)).toEqual([
      { speaker: 'B', start: 2, end: 4, text: 'drei vier' },
      { speaker: 'A', start: 4, end: 8, text: 'fünf sechs sieben acht' },
    ]);
  });

  it('takes only the Segments finalized at the time of the call', () => {
    expect(selectContext([t1, t2, t3, current], current, 11, 2).at(-1)).toEqual({
      speaker: 'A',
      start: 4,
      end: 6,
      text: 'fünf sechs',
    });
  });

  it('takes no Turn that started after the current one, such as an interjection within it', () => {
    const interjection = turn('t-005', 'C', [seg(sid(6), 'C', 9, 9.5, 10, 'ach was')]);
    expect(
      selectContext([t1, t2, t3, current, interjection], current, 13, 2).map((i) => i.speaker),
    ).toEqual(['B', 'A']);
    expect(
      selectContext([t1, t2, t3, current, interjection], interjection, 13, 2).at(-1)?.text,
    ).toBe('neun zehn');
  });

  it('takes fewer Turns at the start of the Session', () => {
    expect(selectContext([t1, current], current, 13, 2)).toHaveLength(1);
    expect(selectContext([current], current, 13, 2)).toEqual([]);
  });
});

describe('the context block caps the context Turns at 600 tokens, the older first (AC5)', () => {
  const item = (speaker: string, start: number, end: number, text: string): ContextItem => ({
    speaker,
    start,
    end,
    text,
  });
  const contextOf = (context: readonly ContextItem[]) =>
    textOf(
      prompt({ context }).next({ speaker: 'A', segments: [A1], final: false }, []),
      'context',
    )[0] ?? '';

  it('renders each context Turn with Speaker, start and end time and its text', () => {
    expect(contextOf([item('A', 1, 2, 'o0 o1'), item('B', 3, 4, 'n0 n1 n2')])).toBe(
      'Kontext-Turns:\n[A · 1.00–2.00 s]\no0 o1\n[B · 3.00–4.00 s]\nn0 n1 n2',
    );
  });

  it('says so when there is no earlier Turn', () => {
    expect(contextOf([])).toBe('Kontext-Turns: (keine)');
  });

  // Boundaries computed by evals/src/harness/prompt.py render_context (ceil(words x 2.1) per Turn, summed).
  it('keeps 2 + 283 words, exactly 600 estimated tokens', () => {
    const text = contextOf([
      item('A', 1, 2, words('o', 2).join(' ')),
      item('B', 3, 4, words('n', 283).join(' ')),
    ]);
    expect(text.split('\n')[2]).toBe('o0 o1');
    expect(text.split('\n')[4]?.split(' ')).toHaveLength(283);
  });

  it('removes the first word of the older Turn at 2 + 284 words, 602 estimated tokens', () => {
    const text = contextOf([
      item('A', 1, 2, words('o', 2).join(' ')),
      item('B', 3, 4, words('n', 284).join(' ')),
    ]);
    expect(text.split('\n')[2]).toBe('o1');
    expect(text.split('\n')[4]?.split(' ')).toEqual(words('n', 284));
  });

  it('empties the older Turn before it shortens the newer one, from the beginning', () => {
    const text = contextOf([
      item('A', 1, 2, words('o', 10).join(' ')),
      item('B', 3, 4, words('n', 300).join(' ')),
    ]);
    expect(text.split('\n')[2]).toBe('(gekürzt)');
    expect(text.split('\n')[4]?.split(' ')).toEqual(words('n', 300).slice(15));
  });
});

describe('each call appends exactly one Turn block with the new Segments only (AC6)', () => {
  it('writes Segment id, start and end time and text per line', () => {
    const blocks = prompt().next({ speaker: 'A', segments: [A1, A2], final: false }, []);
    expect(textOf(blocks, 'turn')).toEqual([
      'Turn-Block 1 · A\ns-0001 [0.00–2.50] Die Mieten sind seit 2015\ns-0002 [2.50–5.00] um 40 Prozent gestiegen.',
    ]);
  });

  it('repeats the earlier Turn blocks byte for byte and adds one block with the Segments not yet sent', () => {
    const p = prompt();
    const first = p.next({ speaker: 'A', segments: [A1], final: false }, []);
    const firstText = [...textOf(first, 'turn')];
    const second = p.next({ speaker: 'A', segments: [A2, A3], final: false }, []);
    const turns = textOf(second, 'turn');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toBe(firstText[0]);
    expect(turns[1]).toBe(
      'Turn-Block 2 · A\ns-0002 [2.50–5.00] um 40 Prozent gestiegen.\ns-0003 [5.00–7.50] Das sagt die Statistik.',
    );
    expect(textOf(first, 'turn')).toEqual(firstText);
  });

  it('marks the block of the final analysis with the end of the Turn', () => {
    const p = prompt();
    const first = p.next({ speaker: 'A', segments: [A1], final: false }, []);
    expect(textOf(first, 'turn')[0]).not.toContain('(Ende des Redebeitrags)');
    const last = p.next({ speaker: 'A', segments: [A2], final: true }, []);
    expect(textOf(last, 'turn')[1]).toBe(
      'Turn-Block 2 · A\ns-0002 [2.50–5.00] um 40 Prozent gestiegen.\n(Ende des Redebeitrags)',
    );
  });

  it('writes a final analysis without new Segments as a block saying so', () => {
    const p = prompt();
    p.next({ speaker: 'A', segments: [A1], final: false }, []);
    const last = p.next({ speaker: 'A', segments: [], final: true }, []);
    expect(textOf(last, 'turn')[1]).toBe(
      'Turn-Block 2 · A\n(kein neuer Redetext)\n(Ende des Redebeitrags)',
    );
  });
});

describe('cache breakpoints (AC7): prefix, context, the last Turn block, every 20th Turn block, at most four', () => {
  /** Indices of the blocks with a cache mark after k calls; prefix 0, context 3, Turn block n at 3 + n. */
  function marks(k: number): number[] {
    const p = prompt();
    let blocks: readonly { cache: boolean }[] = [];
    for (let n = 1; n <= k; n += 1) {
      const s = seg(sid(n), 'A', n, n + 0.5, n + 0.5, `Wort${n}`);
      blocks = p.next({ speaker: 'A', segments: [s], final: false }, []);
    }
    return blocks.flatMap((b, i) => (b.cache ? [i] : []));
  }

  it.each([
    [1, [0, 3, 4]],
    [19, [0, 3, 22]],
    [20, [0, 3, 23]],
    [21, [0, 3, 23, 24]],
    [40, [0, 3, 23, 43]],
    [41, [0, 3, 43, 44]],
    [61, [0, 3, 63, 64]],
  ])('after %i calls marks blocks %j', (k, expected) => {
    expect(marks(k)).toEqual(expected);
  });

  it('never marks the attribution, the Claim list, the delta Claims or the closing instruction', () => {
    const p = prompt();
    const blocks = p.next({ speaker: 'A', segments: [A1], final: false }, []);
    expect(blocks.filter((b) => b.cache).map((b) => b.kind)).toEqual(['prefix', 'context', 'turn']);
  });
});
