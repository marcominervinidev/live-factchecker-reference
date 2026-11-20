// Acceptance runner (`make acceptance ISSUE=<n>`, tests/acceptance/README.md): code, no model. Runs the cases of
// features/<issue>/ and the ticket's canary with the API driver through the edge, in random order, and writes
// reports/<issue>/report.json. Every case has the same shape there (runner/report.ts), so the judge can tell the
// canary only by comparing its expectation with the evidence; nothing here prints which case it is.
// Environment, set by make acceptance: LFC_ISSUE, LFC_COMMIT, LFC_STACK, LFC_EDGE_URL, LFC_EDGE_CA_FILE.
import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { casePlan, canaryFeature, readCanary, ROOT, runCases } from './cases.ts';
import { buildCases, type ReportCase } from './report.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set: make acceptance provides it`);
  return value;
}

const issue = required('LFC_ISSUE');
if (!/^[1-9]\d*$/.test(issue)) throw new Error('LFC_ISSUE must be an issue number');
const edgeUrl = required('LFC_EDGE_URL');
const [commit, stack] = [required('LFC_COMMIT'), required('LFC_STACK')];
const startedAt = new Date().toISOString();
const errors: string[] = [];
let cases: ReportCase[] = [];
try {
  const plan = casePlan(issue, canaryFeature(readCanary(issue)), randomInt(2 ** 31));
  const run = buildCases(await runCases({ ...plan }), edgeUrl);
  errors.push(...run.errors);
  if (run.cases.length <= 1) errors.push(`features/${issue}/ holds no case`);
  cases = run.cases;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const report = { issue: Number(issue), startedAt, commit, stack, errors, cases };
writeFileSync(join(ROOT, 'reports', issue, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const c of cases) process.stdout.write(`${c.status.padEnd(9)} ${c.title}\n`);
process.stdout.write(
  `report: reports/${issue}/report.json, ${cases.length} cases, ${errors.length} run errors\n`,
);
process.exit(errors.length === 0 ? 0 : 1);
