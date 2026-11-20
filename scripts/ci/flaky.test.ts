// Stage 1, issue #26 (T1b), Task 2, AC5 to AC7: the flaky list of a stage (ADR 0011 addendum 2026-10-25, R7;
// docs/process/test-strategy.md, "Flaky"). After a run, `tests/<stage>/reports/flaky.txt` lists each scenario that
// failed and then passed on its retry, one per line; pr.yml opens one issue per line ("flaky: <line>").
//
// Public interface these tests define (built in Task 2, `scripts/ci/flaky.ts`):
//   flakyScenarios(messages) -> string[]   messages: the text of a Cucumber messages report (NDJSON)
//   CLI: node scripts/ci/flaky.ts <messages.ndjson> <flaky.txt>   writes one line per flaky scenario; it always
//   writes the file, empty when nothing was flaky (owner decision Q2, gate 1 of #26: `make test-api` always leaves a
//   flaky.txt and stack-tests.yml treats a missing one as an error).
//
// Fixtures (fixtures/flaky/*.ndjson) are real message reports of cucumber-js 13.3.0 (the version of tests/api),
// recorded on 2026-10-28 in the toolbox from one feature with three scenarios ("a scenario that passes on its first
// attempt", "… fails on its first attempt only", "… fails on every attempt"; the second fails while its attempt
// counter is 1):
//   fails-once-retry-1.ndjson    passes + fails-once, --retry 1: run green (success true)
//   fails-always-retry-1.ndjson  passes + fails-always, --retry 1: run red
//   fails-once-no-retry.ndjson   passes + fails-once, no retry: run red
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { flakyScenarios } from './flaky.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'flaky');
const PASSES = 'a scenario that passes on its first attempt';
const FAILS_ONCE = 'a scenario that fails on its first attempt only';
const FAILS_ALWAYS = 'a scenario that fails on every attempt';

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.ndjson`), 'utf8');
}

function occurrences(lines: readonly string[], name: string): number {
  return lines.filter((line) => line.includes(name)).length;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the CLI on a messages report; the flaky list file must exist afterwards, also when it holds no entry. */
function runCliOn(messagesPath: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-26-flaky-'));
  dirs.push(dir);
  const out = join(dir, 'flaky.txt');
  execFileSync(process.execPath, [join(import.meta.dirname, 'flaky.ts'), messagesPath, out], {
    stdio: 'pipe',
  });
  expect(existsSync(out), 'the flaky list file is written').toBe(true);
  return readFileSync(out, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

function runCli(messages: string): string[] {
  return runCliOn(join(FIXTURES, `${messages}.ndjson`));
}

describe('flakyScenarios (AC5): retry at 1, a scenario fails once and passes on its retry', () => {
  it('lists the scenario that failed and then passed, exactly once', () => {
    const lines = flakyScenarios(fixture('fails-once-retry-1'));
    expect(lines).toHaveLength(1);
    expect(occurrences(lines, FAILS_ONCE)).toBe(1);
  });

  it('does not list the scenario that passed on its first attempt', () => {
    expect(occurrences(flakyScenarios(fixture('fails-once-retry-1')), PASSES)).toBe(0);
  });

  it('writes each listed scenario on one line of its own', () => {
    for (const line of flakyScenarios(fixture('fails-once-retry-1')))
      expect(line).not.toMatch(/[\r\n]/);
  });
});

describe('flakyScenarios (AC6): a scenario fails on both attempts', () => {
  it('does not list the scenario that failed on every attempt, nor any other', () => {
    const lines = flakyScenarios(fixture('fails-always-retry-1'));
    expect(occurrences(lines, FAILS_ALWAYS)).toBe(0);
    expect(lines).toEqual([]);
  });
});

describe('flakyScenarios (AC7): no retry, a scenario fails', () => {
  it('lists nothing', () => {
    expect(flakyScenarios(fixture('fails-once-no-retry'))).toEqual([]);
  });
});

describe('flakyScenarios: input', () => {
  it('lists nothing for an empty messages report', () => {
    expect(flakyScenarios('')).toEqual([]);
  });
});

describe('flaky.ts CLI: the stage flaky list file', () => {
  it('writes the scenario that failed once and passed on its retry exactly once (AC5)', () => {
    const lines = runCli('fails-once-retry-1');
    expect(lines).toHaveLength(1);
    expect(occurrences(lines, FAILS_ONCE)).toBe(1);
  });

  it('leaves the list without an entry when the scenario failed on both attempts (AC6)', () => {
    expect(runCli('fails-always-retry-1')).toEqual([]);
  });

  it('leaves the list without an entry when nothing was retried (AC7)', () => {
    expect(runCli('fails-once-no-retry')).toEqual([]);
  });

  it('writes an empty list file for an empty messages report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lfc-26-flaky-empty-'));
    dirs.push(dir);
    const messages = join(dir, 'messages.ndjson');
    writeFileSync(messages, '');
    expect(runCliOn(messages)).toEqual([]);
  });
});
