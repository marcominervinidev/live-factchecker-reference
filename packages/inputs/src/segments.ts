// What both replay Inputs share once they have cut a source into pieces: the stable word order of the gate-1
// decision (variant (a), 2026-10-29), Session labels by first appearance, Segment ids and the parse with the
// segment contract. Internal to @lfc/inputs.
import { Segment } from '@lfc/contracts';

export type Word = Segment['words'][number];

/** A cut piece of one Speaker before it gets its id and label; `speaker` is the source's key (name or provider label). */
export interface Piece {
  readonly speaker: string;
  /** Sorted by start (sortByStart), so start is the first and end the last word. */
  readonly words: readonly [Word, ...Word[]];
  readonly finalizedAt: number;
}

/** A JSON object (not null, not a list). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable sort by start: words starting at the same time keep the source order. */
export function sortByStart(words: readonly [Word, ...Word[]]): [Word, ...Word[]] {
  return words.toSorted((a, b) => a.start - b.start) as [Word, ...Word[]];
}

export function pieceStart(piece: Piece): number {
  return piece.words[0].start;
}

export function pieceEnd(piece: Piece): number {
  return (piece.words.at(-1) ?? piece.words[0]).end;
}

/** 0 -> A, 25 -> Z, 26 -> AA (the harness's letter_label). */
function letterLabel(index: number): string {
  let label = '';
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    rest = Math.floor((rest - 1) / 26);
  }
  return label;
}

/** s-0001 upwards; five digits and more from the 10 000th Segment on, like the harness's `s-{n:04d}`. */
function segmentId(index: number): string {
  return `s-${String(index + 1).padStart(4, '0')}`;
}

/**
 * Numbers and labels pieces that are already in id order and parses each with the segment contract. A violation
 * fails the whole Input through `fail`, naming the Segment id and the failing fields, never a word.
 */
export function toSegments(
  pieces: readonly Piece[],
  source: { readonly sessionId: string; readonly language: string },
  fail: (message: string) => Error,
): { segments: Segment[]; labels: Map<string, string> } {
  const labels = new Map<string, string>();
  for (const piece of pieces) {
    if (!labels.has(piece.speaker)) labels.set(piece.speaker, letterLabel(labels.size));
  }
  const segments = pieces.map((piece, index) => {
    const id = segmentId(index);
    const parsed = Segment.safeParse({
      schemaVersion: 1,
      id,
      sessionId: source.sessionId,
      speaker: labels.get(piece.speaker),
      start: pieceStart(piece),
      end: pieceEnd(piece),
      finalizedAt: piece.finalizedAt,
      language: source.language,
      words: piece.words,
    });
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)'),
        ),
      ];
      throw fail(`Segment ${id} violates the segment contract: ${fields.slice(0, 5).join(', ')}`);
    }
    return parsed.data;
  });
  return { segments, labels };
}
