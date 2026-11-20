// Stage 1 of the `routes` option of the probe handler (#27, review round 2, R1): a request that is not a probe goes
// to the service's routes; once the service stops, the routed answer closes its connection like every other answer,
// so server.close() is not held up by a keep-alive connection. The HTTP exchange is real, over node:http.
import { Agent, createServer, get as httpGet, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createProbeHandler } from './health.ts';

const servers: Server[] = [];
const agents: Agent[] = [];

afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function serve(accepting: () => boolean, withRoutes = true): Promise<number> {
  const server = createServer(
    createProbeHandler({
      checks: {},
      accepting,
      routes: withRoutes
        ? (_request, response) => {
            response.writeHead(200, { 'content-type': 'text/plain' });
            response.end('routed');
          }
        : undefined,
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function ask(
  port: number,
  path: string,
): Promise<{ body: string; connection: string | undefined }> {
  const agent = new Agent({ keepAlive: true });
  agents.push(agent);
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, agent }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      response.on('end', () => {
        resolve({ body, connection: response.headers.connection });
      });
    }).on('error', reject);
  });
}

describe('createProbeHandler with routes', () => {
  it('hands a request that is not a probe to the routes and keeps the connection while running', async () => {
    const port = await serve(() => true);
    expect(await ask(port, '/sessions')).toEqual({ body: 'routed', connection: 'keep-alive' });
  });

  it('closes the connection of a routed answer once the service stops', async () => {
    const port = await serve(() => false);
    expect(await ask(port, '/sessions')).toEqual({ body: 'routed', connection: 'close' });
  });

  it('still answers /health itself', async () => {
    const port = await serve(() => true);
    expect((await ask(port, '/health')).body).toBe('{"status":"up"}');
  });
});

describe('createProbeHandler without routes', () => {
  // Kills health.ts:82 (routes !== undefined -> true) and the #25 survivors at :86/:87 (empty 404 branch, body {}).
  it('answers a request that is not a probe with 404 and a JSON error', async () => {
    const port = await serve(() => true, false);
    const response = await fetch(`http://127.0.0.1:${port}/sessions`);
    const body = JSON.parse(await response.text()) as { error?: unknown };
    expect([response.status, typeof body.error]).toEqual([404, 'string']);
  });
});
