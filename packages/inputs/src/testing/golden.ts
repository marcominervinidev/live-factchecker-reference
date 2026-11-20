// Test helper of @lfc/inputs (issue #27, T2, Task 2): Golden Set fixtures by reference, never copies
// (.claude/rules/tests.md). A window `golden: <slug> mm:ss-mm:ss` is cut at run time by the deterministic script
// tests/fixtures/golden-window.mjs, run as a child process: packages/* must not import tests/* (dependency-cruiser
// rule packages-only-packages). The harness format fixture is read from evals/tests/fixtures/audio_golden/.
// Both sources arrive on main with branch evals/audiomodus (external prerequisite of #27).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The window of a Golden Set excerpt: the recording as mitschnitt-1 JSON Lines, or the transcript as JSON text. */
export function goldenWindow(kind: 'recording' | 'transcript', reference: string): string {
  return execFileSync(
    process.execPath,
    [join(ROOT, 'tests', 'fixtures', 'golden-window.mjs'), kind, reference],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

/** The harness format fixture mini-audio-a (synthetic, mechanics only): its recording as text. */
export function harnessFormatRecording(): string {
  return readFileSync(
    join(
      ROOT,
      'evals',
      'tests',
      'fixtures',
      'audio_golden',
      'mini-audio-a',
      'mitschnitt',
      'deepgram-nova3-v1.jsonl',
    ),
    'utf8',
  );
}

/** The recording's lines, parsed; a test changes one of them to build a single invalid or variant input. */
export function recordingLines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function recordingText(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

/** Takes every Segment an async iterable yields. */
export async function collect<T>(segments: AsyncIterable<T>): Promise<T[]> {
  const taken: T[] = [];
  for await (const segment of segments) taken.push(segment);
  return taken;
}
