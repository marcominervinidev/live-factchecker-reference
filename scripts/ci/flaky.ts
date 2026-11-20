// The flaky list of a stack-test stage (ADR 0011 addendum 2026-10-25, R7; ticket #26): each scenario that failed
// and then passed on its retry, one line `<feature uri>: <scenario name>`, read from the Cucumber messages report
// (NDJSON). `make test-api` writes it to tests/api/reports/flaky.txt; pr.yml opens one issue per line.
// Usage: node scripts/ci/flaky.ts <messages.ndjson> <flaky.txt>   (always writes the file, empty when none)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { record, text } from './json.ts';

/** A step result that lets a scenario pass; every other status (FAILED, UNDEFINED, PENDING, …) fails it. */
const PASSING = new Set(['PASSED', 'SKIPPED']);

interface Attempt {
  readonly testCaseId: string;
  passed: boolean;
  willBeRetried: boolean;
}

export function flakyScenarios(messages: string): string[] {
  const pickles = new Map<string, string>();
  const testCases = new Map<string, string>();
  const attempts = new Map<string, Attempt>();
  const finished: Attempt[] = [];
  for (const line of messages.split('\n')) {
    if (line.trim() === '') continue;
    const message = record(JSON.parse(line), 'message');
    if (message['pickle'] !== undefined) {
      const pickle = record(message['pickle'], 'pickle');
      const line = `${text(pickle['uri'], 'pickle.uri')}: ${text(pickle['name'], 'pickle.name')}`;
      pickles.set(text(pickle['id'], 'pickle.id'), line.replace(/[\r\n]+/g, ' '));
    } else if (message['testCase'] !== undefined) {
      const testCase = record(message['testCase'], 'testCase');
      testCases.set(
        text(testCase['id'], 'testCase.id'),
        text(testCase['pickleId'], 'testCase.pickleId'),
      );
    } else if (message['testCaseStarted'] !== undefined) {
      const started = record(message['testCaseStarted'], 'testCaseStarted');
      attempts.set(text(started['id'], 'testCaseStarted.id'), {
        testCaseId: text(started['testCaseId'], 'testCaseStarted.testCaseId'),
        passed: true,
        willBeRetried: false,
      });
    } else if (message['testStepFinished'] !== undefined) {
      const step = record(message['testStepFinished'], 'testStepFinished');
      const status = text(record(step['testStepResult'], 'testStepResult')['status'], 'status');
      const attempt = attemptOf(attempts, step['testCaseStartedId']);
      if (!PASSING.has(status)) attempt.passed = false;
    } else if (message['testCaseFinished'] !== undefined) {
      const done = record(message['testCaseFinished'], 'testCaseFinished');
      const attempt = attemptOf(attempts, done['testCaseStartedId']);
      const willBeRetried = done['willBeRetried'];
      if (typeof willBeRetried !== 'boolean')
        throw new TypeError('testCaseFinished.willBeRetried: expected a boolean');
      attempt.willBeRetried = willBeRetried;
      finished.push(attempt);
    }
  }
  // Cucumber retries only a failed attempt: a test case with a retried attempt whose last attempt passed is flaky.
  const retried = new Set(finished.filter((a) => a.willBeRetried).map((a) => a.testCaseId));
  const flaky = finished
    .filter((a) => !a.willBeRetried && a.passed && retried.has(a.testCaseId))
    .map((a) => scenarioOf(pickles, testCases, a.testCaseId));
  return [...new Set(flaky)];
}

function attemptOf(attempts: ReadonlyMap<string, Attempt>, id: unknown): Attempt {
  const key = text(id, 'testCaseStartedId');
  const attempt = attempts.get(key);
  if (attempt === undefined) throw new Error(`messages: no testCaseStarted for ${key}`);
  return attempt;
}

function scenarioOf(
  pickles: ReadonlyMap<string, string>,
  testCases: ReadonlyMap<string, string>,
  testCaseId: string,
): string {
  const scenario = pickles.get(testCases.get(testCaseId) ?? '');
  if (scenario === undefined) throw new Error(`messages: no pickle for test case ${testCaseId}`);
  return scenario;
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (input === undefined || output === undefined) {
    process.stderr.write('usage: node scripts/ci/flaky.ts <messages.ndjson> <flaky.txt>\n');
    process.exit(2);
  }
  // No messages report means the run broke before Cucumber started: no list, so the missing file shows it too.
  if (!existsSync(input)) {
    process.stderr.write(`flaky: no messages report at ${input}; the run did not start\n`);
    process.exit(1);
  }
  const lines = flakyScenarios(readFileSync(input, 'utf8'));
  writeFileSync(output, lines.map((line) => `${line}\n`).join(''));
  process.stdout.write(`flaky: ${String(lines.length)} scenario(s) in ${output}\n`);
}
