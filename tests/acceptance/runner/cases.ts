// The parts of the acceptance run that need no stack: reading the canary, turning it into a scenario, running
// Cucumber with the messages kept. runner/run.ts is the entry; runner/report.test.ts runs these with a fake edge.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfiguration,
  loadSources,
  runCucumber,
  type IConfiguration,
  type IPickleOrder,
} from '@cucumber/cucumber/api';

import type { Envelope } from './report.ts';

export interface Canary {
  readonly title: string;
  readonly expected: string;
}

export const ROOT = join(import.meta.dirname, '..');
// A path in the canary's expectation, e.g. "/health" in "… per HTTPS /health abfrage …".
const PATH_IN_TEXT = /(?<=^|[\s(„"'])\/[\w.~/-]*/g;

export function readCanary(issue: string): Canary {
  const value: unknown = JSON.parse(readFileSync(join(ROOT, 'canaries', `${issue}.json`), 'utf8'));
  const field = (name: string): unknown =>
    typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
  const [title, expected] = [field('title'), field('expected')];
  if (
    typeof title !== 'string' ||
    typeof expected !== 'string' ||
    /[\r\n]/.test(title) ||
    expected.includes('"""')
  ) {
    throw new Error(
      `canaries/${issue}.json: needs a one-line "title" and an "expected" without """`,
    );
  }
  return { title, expected };
}

/**
 * The canary as a scenario of the same shape as a real case: the expectation, then one request per path its
 * expectation names. It asserts nothing; the report shows every case as expectation, request and observation
 * (runner/report.ts). Written to the temporary directory, never to reports/. Throws when it names no path.
 */
export function canaryFeature(canary: Canary): string {
  const found = canary.expected.match(PATH_IN_TEXT) ?? [];
  const paths = [...new Set(found.map((p) => p.replace(/\.+$/, '')))];
  if (paths.length === 0)
    throw new Error('the canary names no path the API driver could ask the edge for');
  const lines = [
    'Feature: Acceptance',
    `  Scenario: ${canary.title}`,
    '    Given the owner expects:',
  ];
  lines.push(
    '      """',
    ...canary.expected.split('\n').map((line) => `      ${line}`),
    '      """',
  );
  lines.push(...paths.map((p) => `    When the client asks the edge for "${p}"`));
  const file = join(mkdtempSync(join(tmpdir(), 'lfc-acceptance-')), 'case.feature');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

export interface CasePlan {
  readonly paths: string[];
  readonly order: IPickleOrder;
}

/**
 * What one acceptance run executes: the ticket's cases and the canary, shuffled together by Cucumber with `seed`
 * (`random:<seed>`), so the canary's place and timestamps follow no pattern. run.ts draws the seed at random.
 */
export function casePlan(issue: string, canaryFile: string, seed: number): CasePlan {
  return { paths: [`features/${issue}/**/*.feature`, canaryFile], order: `random:${String(seed)}` };
}

/** The scenario titles of a plan in the order Cucumber would run them, without running a step. */
export async function plannedTitles(plan: CasePlan): Promise<string[]> {
  const coordinates = { ...plan, defaultDialect: 'en', names: [], tagExpression: '' };
  const { plan: planned } = await loadSources(coordinates, { cwd: ROOT });
  return planned.map((pickle) => pickle.name);
}

/** One Cucumber run in ROOT; `configFile: false` skips cucumber.json (tests bring their own support code). */
export async function runCases(
  provided: Partial<IConfiguration>,
  configFile = true,
): Promise<Envelope[]> {
  const envelopes: Envelope[] = [];
  const environment = { cwd: ROOT };
  const options = configFile ? { provided } : { provided, file: false as const };
  const { runConfiguration } = await loadConfiguration(options, environment);
  await runCucumber(runConfiguration, environment, (envelope) => envelopes.push(envelope));
  return envelopes;
}
