// The STT-recording Input (docs/spec/inputs.md 4.2 and 5; ADR 0005 with its addendum of 2026-10-25; ticket #27,
// AC16, AC17): the reader of the recording format mitschnitt-1 (ticket #73) and the Deepgram segment adapter, a port
// of the Python harness `read_mitschnitt` and `deepgram_segments` (evals/src/harness/mitschnitt.py), no new rules.
// Deviations from the harness, both decided or forced by the segment contract: the words of each piece are sorted
// stably by start (gate 1, 2026-10-29, variant (a)), and finalizedAt, rounded to 0.001 s like the harness, is never
// below the end of the block's last word (rounding could otherwise push a clamped final below it).
// The adapter moves to packages/providers when the live STT connection arrives (ticket #27, Assumptions).
import type { Segment } from '@lfc/contracts';

import { replay } from './replay.ts';
import {
  isRecord,
  type Piece,
  pieceStart,
  sortByStart,
  toSegments,
  type Word,
} from './segments.ts';

/** A recording the harness refuses, or one that yields a Segment the contract refuses. No Segment exists then. */
export class RecordingError extends Error {
  override name = 'RecordingError';
}

/** Diagnosis counters of the adapter, named after the harness's (camelCase). */
export interface Diagnosis {
  resultsFinal: number;
  resultsInterim: number;
  resultsFinalEmpty: number;
  splitFinals: number;
  clampedFinals: number;
  utteranceEnd: number;
  speechStarted: number;
  metadata: number;
  errors: number;
  other: number;
  wordsWithoutSpeaker: number;
}

const FORMAT = 'mitschnitt-1';

type Json = Record<string, unknown>;

interface Recording {
  readonly header: Json;
  readonly events: readonly { readonly t: number; readonly msg: Json }[];
}

export function sttRecordingInput(options: {
  /** The mitschnitt-1 file as text (JSON Lines). */
  readonly recording: string;
  readonly sessionId: string;
  readonly language: string;
}): Promise<{ segments: AsyncIterable<Segment>; diagnosis: Diagnosis }> {
  return Promise.resolve(options).then(({ recording, sessionId, language }) => {
    const { pieces, diagnosis } = deepgramPieces(readRecording(recording));
    const { segments } = toSegments(
      pieces,
      { sessionId, language },
      (message) => new RecordingError(message),
    );
    return { segments: replay(segments), diagnosis };
  });
}

/** The harness's read_mitschnitt: header first, events with monotonic arrival times, a footer with complete true. */
function readRecording(text: string): Recording {
  let header: Json | undefined;
  let footer: Json | undefined;
  const events: { t: number; msg: Json }[] = [];
  text.split('\n').forEach((line, index) => {
    const n = index + 1;
    if (line.trim() === '') return;
    const entry = parseLine(line, n);
    if (header === undefined) {
      header = headerLine(entry);
      return;
    }
    if (footer !== undefined) throw new RecordingError(`line ${n}: line after the footer`);
    if (entry['kind'] === 'footer') footer = entry;
    else events.push(eventLine(entry, n, events.at(-1)));
  });
  if (header === undefined) throw new RecordingError('the recording is empty');
  if (footer === undefined) throw new RecordingError('the recording is incomplete (no footer)');
  if (footer['complete'] !== true) {
    throw new RecordingError('the recording is incomplete (complete false)');
  }
  return { header, events };
}

/** The first line: a header in format mitschnitt-1. */
function headerLine(entry: Json): Json {
  if (entry['kind'] !== 'header' || entry['format'] !== FORMAT) {
    throw new RecordingError(`line 1 is no header in format ${FORMAT}`);
  }
  return entry;
}

/** A line between header and footer: an event whose arrival time does not go back behind the previous one's. */
function eventLine(
  entry: Json,
  n: number,
  previous: { readonly t: number } | undefined,
): { t: number; msg: Json } {
  if (entry['kind'] !== 'event') throw new RecordingError(`line ${n}: unknown line kind`);
  const t = entry['t'];
  const msg = entry['msg'];
  if (!isRecord(msg) || typeof t !== 'number') {
    throw new RecordingError(`line ${n}: event without t or msg`);
  }
  if (previous !== undefined && t + 1e-9 < previous.t) {
    throw new RecordingError(`line ${n}: arrival times not monotonic`);
  }
  return { t, msg };
}

function parseLine(line: string, n: number): Json {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    // never the parser's message: it quotes the line, which can hold transcript text
    throw new RecordingError(`line ${n}: no JSON`);
  }
  if (!isRecord(entry)) throw new RecordingError(`line ${n}: no JSON object`);
  return entry;
}

/**
 * pacing.realtime_factor of the header; missing, null or 0 count as 1.0 like in the harness. A falsy pacing counts
 * as no pacing (`or {}`); a pacing that is present but no object is refused, where the harness fails on `.get`.
 */
function realtimeFactor(header: Json): number {
  const pacing = present(header['pacing'], isRecord, 'pacing is no object');
  const factor = pacing === undefined ? undefined : pacing['realtime_factor'];
  if (factor === undefined || factor === null || factor === 0) return 1.0;
  if (typeof factor !== 'number' || !(factor > 0)) {
    throw new RecordingError('pacing.realtime_factor is no positive number');
  }
  return factor;
}

/** The harness's deepgram_segments up to the sort: pieces in id order plus the diagnosis. */
function deepgramPieces(recording: Recording): { pieces: Piece[]; diagnosis: Diagnosis } {
  const factor = realtimeFactor(recording.header);
  const diagnosis = emptyDiagnosis();
  const pieces: Piece[] = [];
  for (const { t, msg } of recording.events) {
    if (!isResults(msg)) {
      countOther(msg, diagnosis);
      continue;
    }
    // a loop, not a spread: a spread of a huge block's pieces could overflow the call stack
    for (const piece of resultPieces(msg, t * factor, diagnosis)) pieces.push(piece);
  }
  // stable: the parts of one final block keep their order when they start together
  pieces.sort((a, b) => a.finalizedAt - b.finalizedAt || pieceStart(a) - pieceStart(b));
  return { pieces, diagnosis };
}

function emptyDiagnosis(): Diagnosis {
  return {
    resultsFinal: 0,
    resultsInterim: 0,
    resultsFinalEmpty: 0,
    splitFinals: 0,
    clampedFinals: 0,
    utteranceEnd: 0,
    speechStarted: 0,
    metadata: 0,
    errors: 0,
    other: 0,
    wordsWithoutSpeaker: 0,
  };
}

function isResults(msg: Json): boolean {
  return msg['type'] === 'Results' || ('channel' in msg && 'is_final' in msg);
}

/** A Results message: nothing for an interim or an empty final, else one piece per Speaker run of the final block. */
function resultPieces(msg: Json, arrival: number, diagnosis: Diagnosis): Piece[] {
  if (!truthy(msg['is_final'])) {
    diagnosis.resultsInterim += 1;
    return [];
  }
  const words = finalWords(msg);
  if (words.length === 0) {
    diagnosis.resultsFinalEmpty += 1;
    return [];
  }
  diagnosis.resultsFinal += 1;
  const runs = speakerRuns(words, diagnosis);
  if (runs.length > 1) diagnosis.splitFinals += 1;
  const finalizedAt = finalizedAtOf(arrival, runs, diagnosis);
  return runs.map((run) => ({ speaker: run.speaker, words: sortByStart(run.words), finalizedAt }));
}

/** The arrival time, clamped up to the block's last word end, rounded to 0.001 s and never below that word end. */
function finalizedAtOf(
  arrival: number,
  runs: readonly { readonly words: readonly Word[] }[],
  diagnosis: Diagnosis,
): number {
  // reduce, not a spread: a spread of every word end overflows the call stack on a huge block (RangeError)
  const lastEnd = runs.reduce(
    (max, run) => run.words.reduce((m, word) => Math.max(m, word.end), max),
    -Infinity,
  );
  let clamped = arrival;
  if (arrival + 1e-9 < lastEnd) {
    diagnosis.clampedFinals += 1;
    clamped = lastEnd;
  }
  return Math.max(roundHalfEven3(clamped), lastEnd);
}

/** Every other message type is only counted. */
function countOther(msg: Json, diagnosis: Diagnosis): void {
  const type = msg['type'];
  if (type === 'UtteranceEnd') diagnosis.utteranceEnd += 1;
  else if (type === 'SpeechStarted') diagnosis.speechStarted += 1;
  else if (type === 'Metadata') diagnosis.metadata += 1;
  else if (type === 'Error' || truthy(msg['err_code']) || truthy(msg['error']))
    diagnosis.errors += 1;
  else diagnosis.other += 1;
}

interface ProviderWord {
  readonly word: Word;
  readonly speaker: number | undefined;
}

/**
 * The words of the first alternative, in provider order. Like the harness's `_alt(msg).get("words") or []`: a falsy
 * channel, alternatives or words (missing, null, empty) yields no words; one that is present with the wrong type is
 * refused, where the harness fails on `.get`, an index or the iteration (mitschnitt.py, _alt and deepgram_segments).
 */
function finalWords(msg: Json): ProviderWord[] {
  const channel = present(msg['channel'], isRecord, 'a final block whose channel is no object');
  if (channel === undefined) return [];
  const alternatives = present(
    channel['alternatives'],
    isList,
    'a final block whose alternatives are no list',
  );
  if (alternatives === undefined) return [];
  const first: unknown = alternatives[0];
  if (!isRecord(first))
    throw new RecordingError('a final block whose first alternative is no object');
  const words = present(first['words'], isList, 'a final block whose words are no list');
  if (words === undefined) return [];
  return words.map((raw: unknown): ProviderWord => {
    if (!isRecord(raw) || typeof raw['start'] !== 'number' || typeof raw['end'] !== 'number') {
      throw new RecordingError('a final word without start or end');
    }
    const speaker = raw['speaker'];
    if (speaker !== undefined && speaker !== null && typeof speaker !== 'number') {
      throw new RecordingError('a final word with a speaker that is no number');
    }
    return {
      word: { w: wordText(raw), start: raw['start'], end: raw['end'] },
      speaker: speaker ?? undefined,
    };
  });
}

function wordText(raw: Json): string {
  const text = [raw['punctuated_word'], raw['word']].find(truthy);
  if (text === undefined) return '';
  if (typeof text !== 'string' && typeof text !== 'number') {
    throw new RecordingError('a final word whose text is no string');
  }
  return String(text);
}

/** Splits a final block at every Speaker change; a word without speaker stays with the run before it (or 0). */
function speakerRuns(
  words: readonly ProviderWord[],
  diagnosis: Diagnosis,
): { speaker: string; words: [Word, ...Word[]] }[] {
  const runs: { speaker: number; words: [Word, ...Word[]] }[] = [];
  for (const { word, speaker } of words) {
    const current = runs.at(-1);
    let label = speaker;
    if (label === undefined) {
      diagnosis.wordsWithoutSpeaker += 1;
      label = current?.speaker ?? 0;
    }
    if (current?.speaker === label) current.words.push(word);
    else runs.push({ speaker: label, words: [word] });
  }
  return runs.map((run) => ({ speaker: `dg-${run.speaker}`, words: run.words }));
}

/**
 * Python's `value or <empty>` with a type check: a falsy value is absent (undefined), a truthy one must pass `is`,
 * else a RecordingError with `message` (never the value: it can hold transcript text).
 */
function present<T>(value: unknown, is: (v: unknown) => v is T, message: string): T | undefined {
  if (!truthy(value)) return undefined;
  if (!is(value)) throw new RecordingError(message);
  return value;
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Python's truthiness for JSON values. */
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Python's round(x, 3): the exact binary value rounded half to even. An exact tie at the third decimal is only
 * possible where x × 16 is an odd integer; every other value rounds the same in both languages.
 */
function roundHalfEven3(x: number): number {
  const sixteenths = x * 16;
  if (Number.isInteger(sixteenths) && sixteenths % 2 !== 0) {
    const below = Math.floor(x * 1000);
    return (below % 2 === 0 ? below : below + 1) / 1000;
  }
  return Number(x.toFixed(3));
}
