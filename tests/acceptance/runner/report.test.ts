// The canary must not stand out in report.json (main session, round 2 of #25 task 3): a real Cucumber run of two
// real-style cases (with assertion steps) and a canary from canaryFeature, against a fake edge in place of
// tests/api/steps/edge.steps.ts (same step texts, same world field `answer`, no network), through the real
// evidence hook and report builder. Vitest (script test:unit); one shared Cucumber run in beforeAll, because the
// support code registers once per process.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { canaryFeature, ROOT, runCases } from './cases.ts';
import { tlsFacts, tlsLine } from './exchange.ts';
import { buildCases, type ReportCase } from './report.ts';

const EDGE = 'https://edge:8443';
const CUCUMBER = JSON.stringify(import.meta.resolve('@cucumber/cucumber'));

const FAKE_EDGE = `import { Then, When } from ${CUCUMBER};
const routed = { '/detection/health': { status: 200, body: '{"status":"up"}', edgeMark: undefined } };
When('the client asks the edge for {string}', function (path) {
  this.answer = routed[path] ?? { status: 404, body: '', edgeMark: 'unrouted' };
});
Then('the edge answers with status {int}', function (status) {
  if (this.answer.status !== status) throw new Error('expected ' + status + ', got ' + this.answer.status);
});
Then('the answer was written by the edge itself and reached no service', function () {
  if (this.answer.edgeMark !== 'unrouted') throw new Error('not the edge');
});
`;

const realCase = (title: string, path: string, thens: readonly string[]): string =>
  [
    'Feature: Real cases',
    `  Scenario: ${title}`,
    '    Given the owner expects:',
    '      """',
    `      Über den Eingang antwortet ${path} wie beschrieben.`,
    '      """',
    `    When the client asks the edge for "${path}"`,
    ...thens.map((t, i) => `    ${i === 0 ? 'Then' : 'And'} ${t}`),
    '',
  ].join('\n');

async function report(): Promise<Map<string, ReportCase>> {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-report-test-'));
  const write = (name: string, text: string): string => {
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  const real = write(
    'real.feature',
    [
      realCase('Routed', '/detection/health', ['the edge answers with status 200']),
      realCase('Unrouted', '/admin', [
        'the edge answers with status 404',
        'the answer was written by the edge itself and reached no service',
      ]).replace('Feature: Real cases\n', ''),
    ].join('\n'),
  );
  const canary = canaryFeature({
    title: 'Canary',
    expected: 'Wenn ich per HTTPS /health abfrage, antwortet der Eingang mit 200.',
  });
  const support = [
    write('fake-edge.mjs', FAKE_EDGE),
    join(ROOT, 'steps/owner.steps.ts'),
    join(ROOT, 'support/evidence.ts'),
  ];
  const envelopes = await runCases(
    { paths: [real, canary], import: support, order: 'random' },
    false,
  );
  const { cases, errors } = buildCases(envelopes, EDGE);
  expect(errors).toEqual([]);
  return new Map(cases.map((c) => [c.title, c]));
}

/** Everything a judge could tell a case by, except what the case says and what the edge answered. */
const shape = (c: ReportCase): unknown => ({
  keys: Object.keys(c).sort(),
  status: c.status,
  errors: c.errors,
  steps: c.steps.map((s) => `${Object.keys(s).sort().join(',')}:${s.title.split(' ')[0] ?? ''}`),
  stdout: c.stdout
    .split('\n')
    .filter((line) => line.includes(' GET '))
    .map((line) =>
      line.replace(/^\S+ GET https:\/\/edge:8443\/\S* -> \d+( \(X-Lfc-Edge: \w+\))?$/, 'exchange'),
    ),
  network: c.network.map((n) => Object.keys(n).sort().join(',')),
  tls: c.stdout.split('\n').filter((line) => line.startsWith('TLS ')).length,
});

// One Cucumber run for the whole file (support code registers once per process); the fake edge has no TLS, so every
// request shows `TLS not observed`; the facts themselves are tested on tlsFacts below.
let all = new Map<string, ReportCase>();
beforeAll(async () => {
  all = await report();
});

describe('report.json of a run with real cases and a canary', () => {
  const get = (title: string): ReportCase => {
    const found = all.get(title);
    if (found === undefined) throw new Error(`no case ${title} in the report`);
    return found;
  };

  it('gives the canary the keys, step structure and stdout format of the real cases', () => {
    const [routed, unrouted, canary] = [get('Routed'), get('Unrouted'), get('Canary')];
    expect(shape(canary)).toEqual(shape(unrouted));
    expect({ ...(shape(canary) as object), network: [] }).toEqual({
      ...(shape(routed) as object),
      network: [],
    });
    for (const c of [routed, unrouted, canary]) {
      expect(c.steps.map((s) => s.title.split(' ')[0])).toEqual(['Given', 'When', 'Then']);
    }
  });

  // steps/owner.steps.ts is frozen and attaches with its own literal media type; this pins EXPECTATION_MEDIA_TYPE
  // (runner/exchange.ts) to it: a drift empties every `expected`.
  it("carries the expectation of steps/owner.steps.ts verbatim as the case's expected", () => {
    expect(get('Canary').expected).toBe(
      'Wenn ich per HTTPS /health abfrage, antwortet der Eingang mit 200.',
    );
    expect(get('Routed').expected).toBe(
      'Über den Eingang antwortet /detection/health wie beschrieben.',
    );
  });

  it('titles the steps with the request and the observation, never a scenario assertion', () => {
    expect(get('Unrouted').steps.map((s) => s.title)).toEqual([
      'Given the owner expects:',
      'When the client asks the edge for "/admin"',
      'Then the edge answered with status 404 and X-Lfc-Edge: unrouted',
    ]);
    expect(get('Canary').steps[2]?.title).toBe(
      'Then the edge answered with status 404 and X-Lfc-Edge: unrouted',
    );
  });
});

describe('the TLS check in the report (judge J1)', () => {
  const caFile = { path: '/run/lfc/edge-root.crt', bytes: Buffer.from('stack root CA') };
  const socket = (authorized: boolean, error?: string) => ({
    authorized,
    authorizationError: error === undefined ? undefined : new Error(error),
    getPeerCertificate: () => ({ issuer: { CN: 'Caddy Local Authority - ECC Intermediate' } }),
  });

  it('names the stack CA as trust anchor when the request carried its bytes, and the verdict of the handshake', () => {
    const facts = tlsFacts(
      { ca: Buffer.from('stack root CA'), servername: 'edge' },
      socket(true),
      caFile,
    );
    expect(facts).toEqual({
      rejectUnauthorized: true,
      ca: '/run/lfc/edge-root.crt',
      authorized: true,
      authorizationError: null,
      issuer: 'Caddy Local Authority - ECC Intermediate',
      servername: 'edge',
    });
    expect(tlsLine(facts)).toBe(
      'TLS rejectUnauthorized=true ca=/run/lfc/edge-root.crt authorized=true issuer="Caddy Local Authority - ECC Intermediate" servername=edge',
    );
  });

  it('says so when verification was off, another CA was trusted or the handshake failed', () => {
    const facts = tlsFacts(
      { ca: Buffer.from('another CA'), rejectUnauthorized: false },
      socket(false, 'SELF_SIGNED_CERT_IN_CHAIN'),
      caFile,
    );
    expect(tlsLine(facts)).toBe(
      'TLS rejectUnauthorized=false ca=other authorized=false error="SELF_SIGNED_CERT_IN_CHAIN" issuer="Caddy Local Authority - ECC Intermediate" servername=none',
    );
    expect(tlsFacts({}, socket(true), caFile).ca).toBe('system');
  });

  it('gives every case of the run one TLS line per request in the same place, the canary included', () => {
    for (const c of all.values()) {
      const lines = c.stdout.split('\n');
      const requests = lines.flatMap((line, i) => (line.includes(' GET ') ? [i] : []));
      expect(requests.map((i) => lines[i + 1])).toEqual(requests.map(() => 'TLS not observed'));
    }
  });
});
