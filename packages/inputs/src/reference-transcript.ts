// The reference-transcript Input (docs/spec/inputs.md 1 and 4; messaufbau-erkennung 2.3; ticket #27, AC14, AC15):
// a port of the Python harness `build_segments` (evals/src/harness/turns.py) with its defaults (config.py: cut at
// sentence-end punctuation, at a pause of 1.0 s, before a Segment would span more than 10 s), no new rules.
// Deviations from the harness, both decided: the words of each cut piece are sorted stably by start before start,
// end and the id order are taken (gate 1, 2026-10-29, variant (a)), and the Turn's `overlap` mark does not reach the
// Segments (ADR 0005 addendum 2026-10-25).
import type { Segment } from '@lfc/contracts';

import { replay } from './replay.ts';
import {
  isRecord,
  type Piece,
  pieceEnd,
  pieceStart,
  sortByStart,
  toSegments,
  type Word,
} from './segments.ts';

/** A transcript that is no list of Turns with words, or that yields a Segment the contract refuses. */
export class TranscriptError extends Error {
  override name = 'TranscriptError';
}

const SENTENCE_END = ['.', '?', '!', '…'] as const;
const SPLIT_GAP_SECONDS = 1.0;
const MAX_SEGMENT_SECONDS = 10.0;

interface Turn {
  readonly speaker: string;
  readonly words: readonly Word[];
}

export function referenceTranscriptInput(options: {
  /** Parsed transcript.json: a list of Turns { speaker, start, end, overlap?, words }. */
  readonly transcript: unknown;
  readonly sessionId: string;
  /** A parameter of the Input (inputs 4.1). */
  readonly language: string;
}): Promise<{
  segments: AsyncIterable<Segment>;
  /** Label -> Speaker name from the reference transcript (CONTEXT.md Attribution, text mode only). */
  speakers: Readonly<Record<string, string>>;
}> {
  return Promise.resolve(options).then(({ transcript, sessionId, language }) => {
    const pieces = readTurns(transcript)
      .flatMap(cutTurn)
      // stable: pieces starting and ending together keep the transcript order, as in the harness
      .sort((a, b) => pieceStart(a) - pieceStart(b) || pieceEnd(a) - pieceEnd(b));
    const { segments, labels } = toSegments(
      pieces,
      { sessionId, language },
      (message) => new TranscriptError(message),
    );
    const speakers: Record<string, string> = {};
    for (const [name, label] of labels) speakers[label] = name;
    return { segments: replay(segments), speakers };
  });
}

/** The harness's cut of one Turn; finalizedAt is the end (text mode, segment_finalize_delay_seconds 0). */
function cutTurn(turn: Turn): Piece[] {
  const pieces: Piece[] = [];
  let current: Word[] = [];
  turn.words.forEach((word, i) => {
    current.push(word);
    const next = turn.words[i + 1];
    const first = current[0] ?? word;
    const cut =
      next === undefined ||
      SENTENCE_END.some((mark) => word.w.endsWith(mark)) ||
      next.start - word.end >= SPLIT_GAP_SECONDS ||
      next.end - first.start > MAX_SEGMENT_SECONDS;
    if (!cut) return;
    const words = sortByStart([first, ...current.slice(1)]);
    pieces.push({
      speaker: turn.speaker,
      words,
      finalizedAt: (words.at(-1) ?? words[0]).end,
    });
    current = [];
  });
  return pieces;
}

function readTurns(transcript: unknown): Turn[] {
  if (!Array.isArray(transcript)) throw new TranscriptError('the transcript is no list of Turns');
  return transcript.map((turn: unknown, t) => {
    if (!isRecord(turn) || typeof turn['speaker'] !== 'string') {
      throw new TranscriptError(`Turn ${t}: no object with a speaker`);
    }
    // the harness's entry.get("words", []): only a missing key means no words; null fails there with a TypeError
    const words = 'words' in turn ? turn['words'] : [];
    if (!Array.isArray(words)) throw new TranscriptError(`Turn ${t}: words is no list`);
    return {
      speaker: turn['speaker'],
      words: words.map((word: unknown, i): Word => {
        if (
          !isRecord(word) ||
          typeof word['w'] !== 'string' ||
          typeof word['start'] !== 'number' ||
          typeof word['end'] !== 'number'
        ) {
          throw new TranscriptError(`Turn ${t}, word ${i}: needs w, start and end`);
        }
        return { w: word['w'], start: word['start'], end: word['end'] };
      }),
    };
  });
}
