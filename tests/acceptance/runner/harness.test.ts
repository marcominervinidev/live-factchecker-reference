// A harness fault breaks the run (review R1): a fake edge that keeps its answer under another name than the stage-3
// World (`reply` instead of `answer`). The request step passes, the evidence hook finds no answer, report.ts lifts
// the fault into the top-level errors, and run.ts exits 1 on any error. Own file: its own Cucumber run per worker.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { canaryFeature, ROOT, runCases } from './cases.ts';
import { buildCases, type ReportCase } from './report.ts';

const CUCUMBER = JSON.stringify(import.meta.resolve('@cucumber/cucumber'));
const MISNAMED_EDGE = `import { When } from ${CUCUMBER};
When('the client asks the edge for {string}', function (path) {
  this.reply = { status: 200, body: path, edgeMark: undefined };
});
`;

describe('a request step that leaves no answer in the World', () => {
  let run: { cases: ReportCase[]; errors: string[] } = { cases: [], errors: [] };
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lfc-harness-test-'));
    const edge = join(dir, 'misnamed-edge.mjs');
    writeFileSync(edge, MISNAMED_EDGE);
    const feature = canaryFeature({
      title: 'Probe',
      expected: 'Über den Eingang antwortet /detection/health.',
    });
    const support = [edge, join(ROOT, 'steps/owner.steps.ts'), join(ROOT, 'support/evidence.ts')];
    run = buildCases(
      await runCases({ paths: [feature], import: support }, false),
      'https://edge:8443',
    );
  });

  it('is a top-level run error naming the case, not an answer of the edge', () => {
    expect(run.errors).toEqual([
      'Probe: harness: the request step passed, but the World holds no answer under `answer`',
    ]);
  });

  it('still reports the case, as passed, with no answer observed', () => {
    expect(run.cases.map((c) => [c.title, c.status])).toEqual([['Probe', 'passed']]);
    expect(run.cases[0]?.steps.at(-1)?.title).toBe('Then the edge gave no answer');
  });
});
