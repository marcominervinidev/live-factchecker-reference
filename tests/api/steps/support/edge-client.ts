// Stage-3 support (issue #27, T2): the HTTPS client of the edge, without steps, so that step files share it.
// Trusts the root CA the stack exported (LFC_EDGE_CA_FILE), never skips verification. Environment as in
// edge.steps.ts: LFC_EDGE_URL, LFC_EDGE_CA_FILE (set by `make test-api` and `make acceptance`).
// edge.steps.ts (#25, frozen) still holds its own copy (askEdge, the header name); switching it to this module is a
// follow-up after #25 is closed (.claude/frozen/27.json, "followUp").
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

/** The header the edge sets on the 404 it writes itself for an unrouted path (#25, AC9). */
export const EDGE_MARK_HEADER = 'x-lfc-edge';

export interface EdgeAnswer {
  readonly status: number;
  readonly body: string;
  readonly edgeMark: string | undefined;
}

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set: make test-api must provide it`);
  return value;
}

/** One request to the edge; a method other than GET sends an empty JSON object as its body. */
export function sendToEdge(method: string, path: string): Promise<EdgeAnswer> {
  const url = new URL(path, required('LFC_EDGE_URL'));
  if (url.protocol !== 'https:')
    throw new Error('LFC_EDGE_URL must be an https URL: the edge serves TLS only');
  const ca = readFileSync(required('LFC_EDGE_CA_FILE'));
  const body = method === 'GET' ? undefined : '{}';
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        ca,
        timeout: 5000,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const mark = res.headers[EDGE_MARK_HEADER];
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            edgeMark: Array.isArray(mark) ? mark.join(',') : mark,
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error(`the edge did not answer ${method} ${path} within 5 s`)),
    );
    req.on('error', reject);
    req.end(body);
  });
}
