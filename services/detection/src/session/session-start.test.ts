// Stage 1, issue #29 task 3 (implementer-owned, review finding M1): the optional body of POST /sessions, through
// parseSessionStart. Bounds as session-start.ts states them: at most 20 Speakers and 20 labels, a name of 1 to 200
// and a Topic of 1 to 1000 characters, `mode` and `role` from fixed lists, label keys as the segment contract's
// `speaker`, strict objects. A rejection names fields, never a value.
import { describe, expect, it } from 'vitest';

import { parseSessionStart } from './session-start.ts';

const SPEAKER = { name: 'Hukgl Suubayy', role: 'guest', public: true };
const LABELS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

function body(value: unknown): string {
  return JSON.stringify(value);
}

function speakers(count: number) {
  return Array.from({ length: count }, (_, i) => ({ ...SPEAKER, name: `Sprecher ${i}` }));
}

function names(count: number): Record<string, string> {
  return Object.fromEntries(LABELS.slice(0, count).map((label) => [label, `Name ${label}`]));
}

function fieldsOf(text: string): readonly string[] {
  const input = parseSessionStart(text);
  if (input.ok) throw new Error('expected a rejection');
  return input.fields;
}

describe('parseSessionStart: the body-less creation of #27', () => {
  it.each(['', '   \n'])(
    'reads the body %j as mode conversation without Speakers, Topic or names',
    (text) => {
      expect(parseSessionStart(text)).toEqual({
        ok: true,
        start: { setting: { mode: 'conversation' }, speakerNames: {} },
      });
    },
  );

  it('refuses a body that is no JSON without naming a field', () => {
    expect(parseSessionStart('{"setting":')).toEqual({ ok: false, fields: [] });
  });
});

describe('parseSessionStart: a valid Setting', () => {
  it('takes mode, Speakers, Topic and the label mapping as given', () => {
    const setting = { mode: 'broadcast', speakers: [SPEAKER], topic: 'Mieten' };
    expect(parseSessionStart(body({ setting, speakerNames: { B: 'Hukgl Suubayy' } }))).toEqual({
      ok: true,
      start: { setting, speakerNames: { B: 'Hukgl Suubayy' } },
    });
  });

  it('leaves out Speakers and Topic the body does not have', () => {
    expect(parseSessionStart(body({ setting: { mode: 'broadcast' } }))).toEqual({
      ok: true,
      start: { setting: { mode: 'broadcast' }, speakerNames: {} },
    });
  });

  it('runs a body with names but no Setting in mode conversation', () => {
    expect(parseSessionStart(body({ speakerNames: { A: 'Kallac Haqy' } }))).toEqual({
      ok: true,
      start: { setting: { mode: 'conversation' }, speakerNames: { A: 'Kallac Haqy' } },
    });
  });
});

describe('parseSessionStart: bounds', () => {
  it('takes 20 Speakers and refuses 21, naming setting.speakers', () => {
    expect(
      parseSessionStart(body({ setting: { mode: 'broadcast', speakers: speakers(20) } })).ok,
    ).toBe(true);
    expect(fieldsOf(body({ setting: { mode: 'broadcast', speakers: speakers(21) } }))).toEqual([
      'setting.speakers',
    ]);
  });

  it('takes a name of 200 characters and refuses 201 or an empty one', () => {
    const named = (name: string) =>
      body({ setting: { mode: 'broadcast', speakers: [{ ...SPEAKER, name }] } });
    expect(parseSessionStart(named('n'.repeat(200))).ok).toBe(true);
    expect(fieldsOf(named('n'.repeat(201)))).toEqual(['setting.speakers.0.name']);
    expect(fieldsOf(named(''))).toEqual(['setting.speakers.0.name']);
  });

  it('takes a Topic of 1000 characters and refuses 1001 or an empty one', () => {
    const topic = (text: string) => body({ setting: { mode: 'broadcast', topic: text } });
    expect(parseSessionStart(topic('t'.repeat(1000))).ok).toBe(true);
    expect(fieldsOf(topic('t'.repeat(1001)))).toEqual(['setting.topic']);
    expect(fieldsOf(topic(''))).toEqual(['setting.topic']);
  });

  it('takes 20 labels and refuses 21, naming speakerNames', () => {
    expect(parseSessionStart(body({ speakerNames: names(20) })).ok).toBe(true);
    expect(fieldsOf(body({ speakerNames: names(21) }))).toEqual(['speakerNames']);
  });
});

describe('parseSessionStart: rejections', () => {
  it.each([
    ['a lower-case label', { a: 'Kallac Haqy' }],
    ['a label that is a word', { Haqy: 'Kallac Haqy' }],
  ])('refuses %s as a key of speakerNames', (_, speakerNames) => {
    const fields = fieldsOf(body({ speakerNames }));
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => field.startsWith('speakerNames'))).toBe(true);
  });

  it('refuses an unknown field of the Setting', () => {
    expect(fieldsOf(body({ setting: { mode: 'broadcast', extra: 1 } }))).toEqual(['setting']);
  });

  it('refuses an unknown top-level field without naming it (its name could be any text)', () => {
    expect(fieldsOf(body({ settings: { mode: 'broadcast' } }))).toEqual([]);
  });

  it('refuses a mode and a role outside their lists', () => {
    expect(fieldsOf(body({ setting: { mode: 'talk' } }))).toEqual(['setting.mode']);
    const chef = body({ setting: { mode: 'broadcast', speakers: [{ ...SPEAKER, role: 'chef' }] } });
    expect(fieldsOf(chef)).toEqual(['setting.speakers.0.role']);
  });

  it('names fields only, never a value of the body', () => {
    const privateName = 'Anna Geheim-Müller';
    const fields = fieldsOf(
      body({
        setting: {
          mode: privateName,
          speakers: [{ name: '', role: privateName, public: privateName }],
          topic: '',
        },
        speakerNames: { A: '' },
      }),
    );
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.join(' ')).not.toContain('Geheim');
    expect(fields.join(' ')).not.toContain('Anna');
  });
});
