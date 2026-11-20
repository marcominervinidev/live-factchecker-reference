// Stage 1, issue #29 task 2, internals of prompt.ts the frozen tests leave open: byte parity with the harness where
// prompt.test.ts compares parsed values (schema text, rounding of times), the boundaries of selectContext and of the
// context cap. Unless a case says otherwise, the expected value was printed on 2026-11-05 by Python 3.12.7 importing
// evals/src/harness (`python3 -I` in evals/src: prompt.py prefix_block, render_turn_block, render_context,
// assign_breakpoints; schemas.py claim_extractor_schema(False) through json.dumps(..., ensure_ascii=False,
// sort_keys=True); pipeline.py context_items and turns.py `turns.sort(key=lambda t: (t.start, t.id))` for the Turn order).
// Cases marked "owner question" pin a reading the harness does not print; they wait for the owner's decision.
import { describe, expect, it } from 'vitest';

import { seg, sid } from '../testing/turns.ts';
import type { Turn } from '../turns/types.ts';
import {
  attributionBlock,
  createClaimPrompt,
  prefixBlock,
  renderSetting,
  selectContext,
  type ContextItem,
} from './prompt.ts';

const HARNESS_SCHEMA_TEXT =
  '{"additionalProperties": false, "properties": {"candidates": {"items": {"additionalProperties": false, "properties": {"note": {"type": "string"}, "reason": {"enum": ["bezug_unklar", "kern_unklar", "sprecher_unklar"], "type": "string"}, "segmentIds": {"items": {"type": "string"}, "type": "array"}, "speaker": {"type": "string"}, "verbatim": {"type": "string"}}, "required": ["speaker", "verbatim", "segmentIds", "reason", "note"], "type": "object"}, "type": "array"}, "claims": {"items": {"additionalProperties": false, "properties": {"checkworthiness": {"enum": ["hoch", "niedrig"], "type": "string"}, "kind": {"enum": ["tatsache", "widerspruch", "zustimmung", "meinung_mit_kern"], "type": "string"}, "refersTo": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "repeatOf": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "segmentIds": {"items": {"type": "string"}, "type": "array"}, "sentence": {"type": "string"}, "speaker": {"type": "string"}, "type": {"enum": ["zahl", "ereignis", "zitat", "ursache"], "type": "string"}, "verbatim": {"type": "string"}}, "required": ["speaker", "sentence", "verbatim", "segmentIds", "type", "checkworthiness", "kind", "refersTo", "repeatOf"], "type": "object"}, "type": "array"}}, "required": ["claims", "candidates"], "type": "object"}';

const PARAMETERS = {
  contextTokenCap: 600,
  claimListCap: 100,
  cacheBlockBreakpoint: 20,
  tokensPerWord: 2.1,
};

function promptOf(options: {
  context?: readonly ContextItem[];
  parameters?: Partial<typeof PARAMETERS>;
}) {
  return createClaimPrompt({
    prefix: prefixBlock('Anweisung', { mode: 'conversation' }),
    attribution: attributionBlock(['A'], {}),
    claims: [],
    context: options.context ?? [],
    parameters: { ...PARAMETERS, ...options.parameters },
  });
}

function blocksOf(
  options: { context?: readonly ContextItem[]; parameters?: Partial<typeof PARAMETERS> },
  segments = [seg(sid(1), 'A', 0, 1)],
) {
  return promptOf(options).next({ speaker: 'A', segments, final: false }, []);
}

const textOf = (blocks: readonly { kind: string; text: string }[], kind: string) =>
  blocks.find((b) => b.kind === kind)?.text;
const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');

describe('prefixBlock writes the prefix byte for byte as the harness does', () => {
  it('trims the instruction and writes the schema as json.dumps with sorted keys', () => {
    const prefix = prefixBlock('\n  Anweisung \n', { mode: 'conversation' });
    expect(
      prefix.text.startsWith(
        `Anweisung\n\n## Ausgabeschema (JSON)\n${HARNESS_SCHEMA_TEXT}\n\n## Setting\n`,
      ),
    ).toBe(true);
    expect(prefix).toMatchObject({ kind: 'prefix', cache: false, system: true });
  });
});

describe('renderSetting and attributionBlock lines', () => {
  // Owner question (interpretation 2): the harness writes "(private Person, private Person)".
  it('writes a Speaker as name, role and public figure, a private one once as "private Person"', () => {
    const text = renderSetting({
      mode: 'broadcast',
      speakers: [
        { name: 'Kallac Haqy', role: 'moderator', public: true },
        { name: 'Tante Inge', role: 'private', public: false },
      ],
    });
    expect(text).toBe(
      'Modus: Sendung\nSprecher:\n- Kallac Haqy (Moderation, Person des öffentlichen Lebens)\n- Tante Inge (private Person)',
    );
  });

  // Owner question (interpretation 1, the header half): the harness always writes "Sprecher:".
  it('writes no Speaker header for an empty Speaker list', () => {
    expect(renderSetting({ mode: 'conversation', speakers: [] })).toBe('Modus: Gespräch');
  });

  // Owner question (interpretation 3): the harness's text mode has no line for a label without a name.
  it('writes the harness header and one line per label', () => {
    expect(attributionBlock(['A', 'C'], { A: 'Kallac Haqy' }).text).toBe(
      'Zuordnungstabelle (Label -> Sprecher, Quelle, Sicherheit):\n- A -> Kallac Haqy · Referenz-Transkript · certain\n- C -> nicht zugeordnet · keine Quelle · none',
    );
  });

  // Own rule, no harness counterpart: a mapping is read for its own entries only.
  it('reads no inherited property of the mapping as a name', () => {
    expect(attributionBlock(['constructor'], {}).text).toContain(
      '- constructor -> nicht zugeordnet',
    );
  });
});

describe('times round like Python f"{x:.2f}"', () => {
  it('rounds an exact tie half to even and every other value to the nearest', () => {
    const segments = [
      seg('s-0001', 'A', 0.125, 0.375, 0.375, 'eins'),
      seg('s-0002', 'A', 1.625, 2.875, 2.875, 'zwei'),
      seg('s-0003', 'A', 0.005, 10.0049, 10.0049, 'drei'),
    ];
    expect(textOf(blocksOf({}, segments), 'turn')).toBe(
      'Turn-Block 1 · A\ns-0001 [0.12–0.38] eins\ns-0002 [1.62–2.88] zwei\ns-0003 [0.01–10.00] drei',
    );
  });

  it('writes quarter seconds exactly', () => {
    expect(textOf(blocksOf({}, [seg('s-0001', 'A', 0.25, 12.75, 12.75, 'eins')]), 'turn')).toBe(
      'Turn-Block 1 · A\ns-0001 [0.25–12.75] eins',
    );
  });

  it('rounds the times of a context Turn the same way', () => {
    const context = [{ speaker: 'A', start: 0.125, end: 1.625, text: 'x y' }];
    expect(textOf(blocksOf({ context }), 'context')).toBe('Kontext-Turns:\n[A · 0.12–1.62 s]\nx y');
  });
});

describe('the context block at its boundaries (prompt.py render_context)', () => {
  it('writes the words of a context Turn without blanks at the edges or doubled', () => {
    const context = [{ speaker: 'A', start: 1, end: 2, text: ' a  b ' }];
    expect(textOf(blocksOf({ context }), 'context')).toBe('Kontext-Turns:\n[A · 1.00–2.00 s]\na b');
  });

  it('caps nothing with a cap of 0 (`if token_cap:`)', () => {
    const context = [
      { speaker: 'A', start: 1, end: 2, text: words('o', 300) },
      { speaker: 'B', start: 3, end: 4, text: words('n', 300) },
    ];
    const lines =
      textOf(blocksOf({ context, parameters: { contextTokenCap: 0 } }), 'context')?.split('\n') ??
      [];
    expect([lines[2]?.split(' ').length, lines[4]?.split(' ').length]).toEqual([300, 300]);
  });

  it('cuts with another token estimate per word as the harness does (cap 50, 1.6 per word)', () => {
    const context = [
      { speaker: 'A', start: 1, end: 2, text: words('o', 40) },
      { speaker: 'B', start: 3, end: 4, text: words('n', 30) },
    ];
    const parameters = { contextTokenCap: 50, tokensPerWord: 1.6 };
    expect(textOf(blocksOf({ context, parameters }), 'context')).toBe(
      `Kontext-Turns:\n[A · 1.00–2.00 s]\no39\n[B · 3.00–4.00 s]\n${words('n', 30)}`,
    );
  });
});

describe('cache breakpoints with a breakpoint step of 0 (assign_breakpoints: `every and …`)', () => {
  it('marks prefix, context and the last Turn block only', () => {
    const p = promptOf({ parameters: { cacheBlockBreakpoint: 0 } });
    let blocks: readonly { cache: boolean }[] = [];
    for (let n = 1; n <= 3; n += 1) {
      blocks = p.next({ speaker: 'A', segments: [seg(sid(n), 'A', n, n + 0.5)], final: false }, []);
    }
    expect(blocks.flatMap((b, i) => (b.cache ? [i] : []))).toEqual([0, 3, 6]);
  });
});

describe('selectContext boundaries (pipeline.py context_items)', () => {
  const turn = (id: string, segments: Turn['segments'], speaker = 'A'): Turn => ({
    id,
    speaker,
    interjection: false,
    segments,
  });
  const current = turn('t-003', [seg(sid(3), 'A', 4, 5, 5, 'jetzt')]);

  it('takes a Segment finalized exactly at the time of the call', () => {
    const earlier = turn('t-001', [seg(sid(1), 'A', 0, 1, 3, 'vorher')]);
    expect(selectContext([earlier, current], current, 3, 2).map((i) => i.text)).toEqual(['vorher']);
  });

  it('takes no Turn that starts at the same time as the current one', () => {
    const same = turn('t-002', [seg(sid(2), 'B', 4, 4.5, 4.5, 'gleichzeitig')]);
    expect(selectContext([same, current], current, 9, 2)).toEqual([]);
  });

  it('takes the last Turns even when none of their Segments is finalized yet, so none', () => {
    const older = turn('t-000', [seg(sid(1), 'A', 0, 1, 1, 'alt')]);
    const pending = turn('t-001', [seg(sid(2), 'A', 1, 2, 8, 'später')]);
    const later = turn('t-002', [seg(sid(3), 'B', 2, 3, 9, 'danach')]);
    expect(selectContext([older, pending, later, current], current, 6, 2)).toEqual([]);
  });

  // Own rule, no harness counterpart: the Turn builder opens a Turn before its first Segment.
  it('skips a Turn without Segments', () => {
    const older = turn('t-001', [seg(sid(1), 'A', 0, 1, 1, 'alt')]);
    const opened = turn('t-004', []);
    expect(selectContext([older, opened, current], current, 6, 2).map((i) => i.text)).toEqual([
      'alt',
    ]);
  });

  it('takes no Turn for a count of 0 (`prev[-n:] if n else []`)', () => {
    const older = turn('t-001', [seg(sid(1), 'A', 0, 1, 1, 'alt')]);
    expect(selectContext([older, current], current, 6, 0)).toEqual([]);
  });

  it('orders the Turns by start and id, whatever order it gets them in', () => {
    const t1 = turn('t-001', [seg(sid(1), 'A', 0, 1, 1, 'eins zwei')]);
    const t2 = turn('t-002', [seg(sid(2), 'B', 1, 2, 2, 'drei vier')], 'B');
    const t3 = turn('t-005', [seg(sid(4), 'A', 2, 3, 3, 'fünf sechs')]);
    const t4 = turn('t-004', [seg(sid(5), 'C', 2, 2.5, 3, 'sieben')], 'C');
    expect(selectContext([t3, t1, t4, t2, current], current, 9, 3).map((i) => i.text)).toEqual([
      'drei vier',
      'sieben',
      'fünf sechs',
    ]);
  });

  it.each([
    ['t-001', 't-002', 't-003'],
    ['t-001', 't-003', 't-002'],
    ['t-002', 't-001', 't-003'],
    ['t-002', 't-003', 't-001'],
    ['t-003', 't-001', 't-002'],
    ['t-003', 't-002', 't-001'],
  ])('orders Turns of the same start by id, given %s, %s, %s', (...ids) => {
    const late = turn('t-009', [seg(sid(9), 'A', 8, 9, 9, 'spät')]);
    const given = ids.map((id) => turn(id, [seg(sid(Number(id.slice(2))), 'A', 1, 2, 2, id)]));
    expect(selectContext([...given, late], late, 9, 3).map((i) => i.text)).toEqual([
      't-001',
      't-002',
      't-003',
    ]);
  });
});
