// The TLS line of a request belongs to that request's own connection (judge J1, round 4): a local HTTPS server with
// a throwaway CA made by openssl in the temporary directory (no key in the repository), a fake stage-3 library
// that asks it four ways, the real evidence hook and report builder. Own file: its own Cucumber run per worker.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROOT, runCases } from './cases.ts';
import { buildCases, type ReportCase } from './report.ts';

const CUCUMBER = JSON.stringify(import.meta.resolve('@cucumber/cucumber'));

// verified, verified-again: the global agent with the test CA (a resumed session would show no issuer); own-agent: its own agent with verification off; wrong-ca: the
// global agent with the system CAs, so the handshake fails; no-connection: an answer without any request.
const FAKE_LIBRARY = `import { When } from ${CUCUMBER};
import https from 'node:https';
import { readFileSync } from 'node:fs';
const ca = readFileSync(process.env.LFC_EDGE_CA_FILE);
const base = 'https://localhost:' + process.env.LFC_TLS_TEST_PORT;
const ask = (path, options) => new Promise((resolve, reject) => {
  const req = https.request(new URL(path, base), { method: 'GET', timeout: 5000, ...options }, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => resolve({ status: res.statusCode, body, edgeMark: undefined }));
  });
  req.on('error', reject);
  req.end();
});
When('the client asks the edge for {string}', async function (path) {
  if (path.startsWith('/verified')) this.answer = await ask(path, { ca });
  else if (path === '/own-agent') this.answer = await ask(path, { agent: new https.Agent({ rejectUnauthorized: false }) });
  else if (path === '/wrong-ca') this.answer = await ask(path, {});
  else this.answer = { status: 200, body: '', edgeMark: undefined };
});
`;

const scenario = (path: string): string =>
  [
    `  Scenario: ${path}`,
    '    Given the owner expects:',
    '      """',
    `      ${path}`,
    '      """',
    `    When the client asks the edge for "${path}"`,
  ].join('\n');

function throwawayCa(dir: string): { caPath: string; key: Buffer; cert: Buffer } {
  const at = (name: string): string => join(dir, name);
  const openssl = (...args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  };
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];
  openssl(
    'req',
    '-x509',
    ...ec,
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-days',
    '1',
    '-subj',
    '/CN=LFC Test CA',
  );
  openssl('req', ...ec, '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=localhost');
  writeFileSync(at('san.ext'), 'subjectAltName=DNS:localhost\n');
  openssl(
    'x509',
    '-req',
    '-in',
    'srv.csr',
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-out',
    'srv.crt',
    '-days',
    '1',
    '-extfile',
    'san.ext',
  );
  return {
    caPath: at('ca.crt'),
    key: readFileSync(at('srv.key')),
    cert: readFileSync(at('srv.crt')),
  };
}

let server: Server | undefined;
let caPath = '';
let cases = new Map<string, ReportCase>();

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-tls-test-'));
  const ca = throwawayCa(dir);
  caPath = ca.caPath;
  const listening = createServer({ key: ca.key, cert: ca.cert }, (_req, res) => {
    res.end('{"status":"up"}');
  });
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  server = listening;
  process.env['LFC_EDGE_CA_FILE'] = caPath;
  process.env['LFC_TLS_TEST_PORT'] = String((listening.address() as AddressInfo).port);
  const feature = join(dir, 'tls.feature');
  const paths = ['/verified', '/verified-again', '/own-agent', '/wrong-ca', '/no-connection'];
  writeFileSync(feature, ['Feature: TLS evidence', ...paths.map(scenario), ''].join('\n'));
  const library = join(dir, 'fake-library.mjs');
  writeFileSync(library, FAKE_LIBRARY);
  const support = [library, join(ROOT, 'steps/owner.steps.ts'), join(ROOT, 'support/evidence.ts')];
  const run = buildCases(
    await runCases({ paths: [feature], import: support }, false),
    'https://edge:8443',
  );
  cases = new Map(run.cases.map((c) => [c.title, c]));
});

afterAll(() => {
  server?.close();
});

const tlsOf = (title: string): string =>
  cases
    .get(title)
    ?.stdout.split('\n')
    .find((line) => line.startsWith('TLS ')) ?? 'no TLS line';

describe('the TLS line of a request', () => {
  it('shows the verified handshake against the trust anchor the request carried', () => {
    expect(tlsOf('/verified')).toBe(
      `TLS rejectUnauthorized=true ca=${caPath} authorized=true issuer="LFC Test CA" servername=localhost`,
    );
  });

  it('shows the full handshake for a second verified request too, never a resumed session without issuer', () => {
    expect(tlsOf('/verified-again')).toBe(tlsOf('/verified'));
  });

  it("shows a library's own agent with verification off as such, never the facts of another connection", () => {
    expect(tlsOf('/own-agent')).toMatch(
      /^TLS rejectUnauthorized=false ca=system authorized=false error="[A-Z_]+"/,
    );
  });

  it('shows a failed handshake as authorized=false with its error code, and no answer', () => {
    expect(tlsOf('/wrong-ca')).toMatch(
      /^TLS rejectUnauthorized=true ca=system authorized=false error="[A-Z_]+"/,
    );
    expect(cases.get('/wrong-ca')?.stdout).toContain('-> no answer');
  });

  it('shows a step that opened no connection as not observed, not the previous step', () => {
    expect(tlsOf('/no-connection')).toBe('TLS not observed');
  });
});
