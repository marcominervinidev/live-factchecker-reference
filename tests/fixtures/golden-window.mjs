#!/usr/bin/env node
// Deterministic cut of a Golden Set excerpt to a time window (issue #27, T2; .claude/rules/tests.md "Step libraries
// and fixtures"). Fixtures are references, never copies: a test names `golden: <slug> mm:ss-mm:ss`, this script
// reads the excerpt from evals/golden/<slug>/ at run time and prints the window to stdout. Nothing is written.
//
//   node tests/fixtures/golden-window.mjs recording  "golden: synt-2026-10-06-a 01:10-01:55"
//   node tests/fixtures/golden-window.mjs transcript "golden: synt-2026-10-06-a 01:10-01:55"
//
// recording   evals/golden/<slug>/mitschnitt/deepgram-nova3-v1.jsonl (format mitschnitt-1, ticket #73): the header
//             unchanged, every event whose arrival time t x realtime_factor lies in [from, to), and a new footer
//             (complete true, events and finals of the window). No time is shifted, so word times and arrival
//             times stay those of the Golden Set. The source must be complete (footer with complete true).
// transcript  evals/golden/<slug>/transcript.json (messaufbau 2.3): every word whose start lies in [from, to);
//             a Turn keeps its speaker and its overlap mark, its start and end become those of its first and last
//             kept word; Turns without a kept word are dropped. Output is JSON, one Turn list.
//
// The repository root is two levels above this file; LFC_GOLDEN_ROOT overrides it (a checkout that holds
// evals/golden). Exit 2 on a malformed reference, a missing excerpt or an incomplete recording.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFERENCE = /^golden: ([a-z0-9][a-z0-9-]*) (\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

function fail(message) {
  process.stderr.write(`golden-window: ${message}\n`);
  process.exit(2);
}

function parseReference(text) {
  const match = REFERENCE.exec(text ?? '');
  if (match === null)
    fail(`reference must look like "golden: <slug> mm:ss-mm:ss", got ${JSON.stringify(text)}`);
  const [, slug, m1, s1, m2, s2] = match;
  const from = Number(m1) * 60 + Number(s1);
  const to = Number(m2) * 60 + Number(s2);
  if (!(to > from)) fail('the window must end after it starts');
  return { slug, from, to };
}

function root() {
  const fromEnv = process.env['LFC_GOLDEN_ROOT'];
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fail(
      `excerpt file missing: ${path} (Golden Set recordings arrive with branch evals/audiomodus)`,
    );
  }
}

function cutRecording({ slug, from, to }) {
  const lines = read(join(root(), 'evals', 'golden', slug, 'mitschnitt', 'deepgram-nova3-v1.jsonl'))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const [header] = lines;
  if (header?.kind !== 'header' || header.format !== 'mitschnitt-1')
    fail(`${slug}: line 1 is no mitschnitt-1 header`);
  const footer = lines.at(-1);
  if (footer?.kind !== 'footer' || footer.complete !== true)
    fail(`${slug}: the recording is incomplete`);
  const factor = Number(header.pacing?.realtime_factor ?? 1) || 1;
  const events = lines.filter(
    (line) => line.kind === 'event' && line.t * factor >= from && line.t * factor < to,
  );
  const finals = events.filter(
    (event) => event.msg?.type === 'Results' && event.msg.is_final === true,
  ).length;
  const out = [
    header,
    ...events,
    { kind: 'footer', complete: true, events: events.length, finals, error: null },
  ];
  return out.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

function cutTranscript({ slug, from, to }) {
  const turns = JSON.parse(read(join(root(), 'evals', 'golden', slug, 'transcript.json')));
  const kept = [];
  for (const turn of turns) {
    const words = (turn.words ?? []).filter((word) => word.start >= from && word.start < to);
    if (words.length === 0) continue;
    kept.push({
      speaker: turn.speaker,
      start: words[0].start,
      end: words.at(-1).end,
      overlap: turn.overlap === true,
      words,
    });
  }
  return JSON.stringify(kept) + '\n';
}

const [kind, reference] = process.argv.slice(2);
const window = parseReference(reference);
if (kind === 'recording') process.stdout.write(cutRecording(window));
else if (kind === 'transcript') process.stdout.write(cutTranscript(window));
else fail('first argument must be "recording" or "transcript"');
