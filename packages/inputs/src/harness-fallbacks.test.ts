// Implementer's unit tests (#27 task 2, review findings W2 to W4), not frozen: the harness's falsy fallbacks
// (`x or {}`, `x or []`, `entry.get("words", [])`) against values that are present with the wrong type. A falsy value
// stays empty like in Python; a wrong type is refused with the Input's error, whose message never quotes the value
// (evals/src/harness/mitschnitt.py: realtime_factor, _alt, deepgram_segments; turns.py: build_segments).
import { describe, expect, it } from 'vitest';

import { TranscriptError, referenceTranscriptInput } from './reference-transcript.ts';
import { RecordingError, sttRecordingInput } from './stt-recording.ts';

const SESSION = '27a0c0de-0000-4000-8000-0000000000f2';
const PROBE_WORD = 'GEHEIMWORT';

type Line = Record<string, unknown>;

function recording(options: { pacing?: unknown; msg: Line }): string {
  const header: Line = { kind: 'header', format: 'mitschnitt-1' };
  if ('pacing' in options) header['pacing'] = options.pacing;
  return [header, { kind: 'event', t: 2, msg: options.msg }, { kind: 'footer', complete: true }]
    .map((line) => JSON.stringify(line))
    .join('\n');
}

const WORD = { word: 'hallo', punctuated_word: 'Hallo.', start: 0.5, end: 1, speaker: 0 };

function finalBlock(channel: unknown): Line {
  return { type: 'Results', is_final: true, channel };
}

function run(text: string) {
  return sttRecordingInput({ recording: text, sessionId: SESSION, language: 'de' });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof Error)) throw new Error('expected a rejection');
  return error;
}

describe('sttRecordingInput: falsy stays empty (W2)', () => {
  it.each([
    ['channel missing', { type: 'Results', is_final: true }],
    ['channel null', finalBlock(null)],
    ['channel empty', finalBlock({})],
    ['alternatives null', finalBlock({ alternatives: null })],
    ['alternatives empty', finalBlock({ alternatives: [] })],
    ['words missing', finalBlock({ alternatives: [{}] })],
    ['words null', finalBlock({ alternatives: [{ words: null }] })],
    ['words empty', finalBlock({ alternatives: [{ words: [] }] })],
  ])('%s counts as an empty final', async (_, msg) => {
    const { diagnosis } = await run(recording({ msg }));
    expect(diagnosis.resultsFinalEmpty).toBe(1);
    expect(diagnosis.resultsFinal).toBe(0);
  });

  it.each([
    ['missing', undefined, false],
    ['null', null, true],
    ['empty', {}, true],
  ])('pacing %s counts as factor 1.0', async (_, pacing, set) => {
    const text = set
      ? recording({ pacing, msg: finalBlock({ alternatives: [{ words: [WORD] }] }) })
      : recording({ msg: finalBlock({ alternatives: [{ words: [WORD] }] }) });
    const { diagnosis } = await run(text);
    expect(diagnosis.resultsFinal).toBe(1);
    expect(diagnosis.clampedFinals).toBe(0);
  });
});

describe('sttRecordingInput: present with the wrong type is refused (W2)', () => {
  it.each([
    ['channel a string', finalBlock(PROBE_WORD)],
    ['channel a list', finalBlock([PROBE_WORD])],
    ['alternatives a string', finalBlock({ alternatives: PROBE_WORD })],
    ['alternatives an object', finalBlock({ alternatives: { 0: { words: [WORD] } } })],
    ['first alternative null', finalBlock({ alternatives: [null] })],
    ['first alternative a string', finalBlock({ alternatives: [PROBE_WORD] })],
    ['words a string', finalBlock({ alternatives: [{ words: PROBE_WORD }] })],
    ['words an object', finalBlock({ alternatives: [{ words: { a: WORD } }] })],
    ['words a number', finalBlock({ alternatives: [{ words: 3 }] })],
  ])('%s', async (_, msg) => {
    const error = await rejection(run(recording({ msg })));
    expect(error).toBeInstanceOf(RecordingError);
    expect(error.message).not.toContain(PROBE_WORD);
  });

  it.each([
    ['a string', PROBE_WORD],
    ['a list', [PROBE_WORD]],
    ['a number', 2],
  ])('pacing %s', async (_, pacing) => {
    const error = await rejection(
      run(recording({ pacing, msg: finalBlock({ alternatives: [{ words: [WORD] }] }) })),
    );
    expect(error).toBeInstanceOf(RecordingError);
    expect(error.message).not.toContain(PROBE_WORD);
  });
});

describe('sttRecordingInput: a huge final block (W4)', () => {
  it('takes the last word end without a RangeError', async () => {
    const words = Array.from({ length: 200_000 }, (_, i) => ({
      word: 'a',
      start: i / 1000,
      end: i / 1000 + 0.0005,
      speaker: 0,
    }));
    const msg = finalBlock({ alternatives: [{ words }] });
    const outcome = await run(recording({ msg })).then(
      ({ diagnosis }) => diagnosis,
      (e: unknown) => e,
    );
    // resolved, or refused by the Input (the segment contract bounds a Segment), never a RangeError
    expect([undefined, RecordingError]).toContain(
      outcome instanceof Error ? outcome.constructor : undefined,
    );
  });
});

describe('referenceTranscriptInput: words of a Turn (W3)', () => {
  it('reads a Turn without words as no words', async () => {
    const { segments } = await referenceTranscriptInput({
      transcript: [{ speaker: 'Gast', start: 0, end: 1 }],
      sessionId: SESSION,
      language: 'de',
    });
    const all = [];
    for await (const s of segments) all.push(s);
    expect(all).toEqual([]);
  });

  it('refuses words null, where the harness fails with a TypeError', async () => {
    const error = await rejection(
      referenceTranscriptInput({
        transcript: [{ speaker: 'Gast', start: 0, end: 1, words: null }],
        sessionId: SESSION,
        language: 'de',
      }),
    );
    expect(error).toBeInstanceOf(TranscriptError);
  });
});
