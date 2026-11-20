// Stage-3 step library (API driver): talks to the Compose stack only through the edge, over HTTPS, trusting the root
// CA the stack exported; it never imports service code and never skips TLS verification (ticket #25, Task 3).
// The acceptance runner (tests/acceptance, API driver in increment 1) loads this library too.
// Environment, set by `make test-api` and `make acceptance`:
//   LFC_EDGE_URL      base URL of the edge, e.g. https://localhost:8443
//   LFC_EDGE_CA_FILE  PEM file of the stack's root CA (Caddy internal CA)
// Later tickets extend this file's vocabulary; they never copy it (.claude/rules/tests.md).
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

import { Then, When, World, setWorldConstructor, type IWorldOptions } from '@cucumber/cucumber';

// Proposed assumption for ticket #25 (gate 1, round 2, open question 1): the edge marks the answers it writes
// itself for unrouted paths with this header; forwarded answers never carry it, and no service sets it.
const EDGE_OWN_ANSWER = { header: 'x-lfc-edge', value: 'unrouted' } as const;

interface EdgeAnswer {
  readonly status: number;
  readonly body: string;
  readonly edgeMark: string | undefined;
}

class EdgeWorld extends World {
  answer: EdgeAnswer | undefined;

  constructor(options: IWorldOptions) {
    super(options);
  }
}
setWorldConstructor(EdgeWorld);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set: make test-api must provide it`);
  return value;
}

function askEdge(path: string): Promise<EdgeAnswer> {
  const url = new URL(path, required('LFC_EDGE_URL'));
  if (url.protocol !== 'https:') throw new Error('LFC_EDGE_URL must be an https URL: the edge serves TLS only');
  const ca = readFileSync(required('LFC_EDGE_CA_FILE'));
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', ca, timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const mark = res.headers[EDGE_OWN_ANSWER.header];
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          edgeMark: Array.isArray(mark) ? mark.join(',') : mark,
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`the edge did not answer ${path} within 5 s`)));
    req.on('error', reject);
    req.end();
  });
}

When('the client asks the edge for {string}', async function (this: EdgeWorld, path: string) {
  this.answer = await askEdge(path);
});

Then('the edge answers with status {int}', function (this: EdgeWorld, status: number) {
  if (this.answer?.status !== status) throw new Error(`expected status ${status}, got ${String(this.answer?.status)}`);
});

Then('the answer was written by the edge itself and reached no service', function (this: EdgeWorld) {
  if (this.answer?.edgeMark !== EDGE_OWN_ANSWER.value) {
    throw new Error(`the 404 lacks ${EDGE_OWN_ANSWER.header}: ${EDGE_OWN_ANSWER.value}, so a service may have answered it`);
  }
});

Then('the answer was forwarded to a service, not written by the edge itself', function (this: EdgeWorld) {
  if (this.answer?.edgeMark !== undefined) throw new Error(`a routed answer carries ${EDGE_OWN_ANSWER.header}`);
});

// Every [name, state] pair in a JSON body whose value is "ok" or "failed", wherever it sits.
function dependencyStates(body: string): Record<string, string> {
  const states: Record<string, string> = {};
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (inner === 'ok' || inner === 'failed') states[key] = inner;
      else walk(inner);
    }
  };
  walk(JSON.parse(body));
  return states;
}

Then('the edge body names the dependency {string} as {string}', function (this: EdgeWorld, name: string, state: string) {
  const states = dependencyStates(this.answer?.body ?? 'null');
  if (states[name] !== state) throw new Error(`expected ${name} to be ${state}, body names ${JSON.stringify(states)}`);
});
