import test from 'node:test';
import assert from 'node:assert/strict';
import express, { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import { createRateLimiter, isDirectLocalRead } from './rateLimit';
import { trustProxy } from './trustProxy';

// A real express app with the production proxy setting (`trust proxy` = trustProxy, app.ts). The test client connects
// over loopback, exactly like nginx and Angular SSR do on the server; what tells them apart is nginx's forwarding header.
async function withApp(
  run: (call: (init?: { method?: string; headers?: Record<string, string>; path?: string }) => Promise<number>) => Promise<void>,
  limiterOptions: Parameters<typeof createRateLimiter>[0] = {},
) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(createRateLimiter({ windowMs: 60_000, max: 2, ...limiterOptions }));
  app.all(['/v2/x', '/v2/affiliate/resolve', '/v2/affiliate/impression'], (_req, res) => res.status(200).end());
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.statusCode || 500).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((ok) => server.once('listening', ok));
  const { port } = server.address() as AddressInfo;
  try {
    await run(async ({ path = '/v2/x', ...init } = {}) => (await fetch(`http://127.0.0.1:${port}${path}`, init)).status);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

const statuses = async (call: () => Promise<number>, n: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await call());
  return out;
};

test('external clients (arriving through nginx, with X-Forwarded-For) stay rate-limited', async () => {
  await withApp(async (call) => {
    const viaNginx = () => call({ headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.1', 'x-real-ip': '198.51.100.1' } });
    assert.deepEqual(await statuses(viaNginx, 3), [200, 200, 429]);
  });
});

// 172.68.10.20 is inside Cloudflare's 172.64.0.0/13: the edge address nginx appends for public traffic.
test('visitors behind the same Cloudflare edge get their own buckets', async () => {
  await withApp(async (call) => {
    const visitor = (ip: string) => () => call({ headers: { 'x-forwarded-for': `${ip}, 172.68.10.20`, 'x-real-ip': '172.68.10.20' } });
    assert.deepEqual(await statuses(visitor('83.40.1.1'), 2), [200, 200]);
    assert.deepEqual(await statuses(visitor('2a02:9130::1'), 2), [200, 200], 'a second visitor is not limited by the first');
    assert.equal(await visitor('83.40.1.1')(), 429, 'the first visitor is still limited');
  });
});

test('a forged X-Forwarded-For sent straight to the origin cannot pick a fresh bucket', async () => {
  // 198.51.100.9 bypasses Cloudflare and talks to nginx, which appends it; everything to its left is the sender's.
  let n = 0;
  const forged = [
    () => `203.0.113.${++n}, 198.51.100.9`,
    () => `203.0.113.${++n}, 172.68.10.20, 198.51.100.9`,
    () => `172.68.10.${++n}, 198.51.100.9`,
  ];
  for (const header of forged) {
    await withApp(async (call) => {
      const results = await statuses(() => call({ headers: { 'x-forwarded-for': header() } }), 3);
      assert.equal(results[2], 429, `still limited with ${header()}`);
    });
  }
  // Through Cloudflare, a client-written prefix is ignored too: Cloudflare appends the real visitor after it.
  await withApp(async (call) => {
    const throughEdge = () => call({ headers: { 'x-forwarded-for': `203.0.113.${++n}, 83.40.1.1, 172.68.10.20` } });
    assert.deepEqual(await statuses(throughEdge, 3), [200, 200, 429]);
  });
});

test('direct reads from this host (Angular SSR → 127.0.0.1:4000, no forwarding header) do not share one bucket', async () => {
  await withApp(async (call) => {
    assert.deepEqual(await statuses(() => call(), 6), [200, 200, 200, 200, 200, 200]);
  });
});

test('a spoofed forwarding header never grants the exemption', async () => {
  await withApp(async (call) => {
    const spoofed: Array<Record<string, string>> = [{ 'x-forwarded-for': '127.0.0.1' }, { 'x-forwarded-for': '' }, { 'x-real-ip': '127.0.0.1' }, { forwarded: 'for=127.0.0.1' }];
    for (const headers of spoofed) {
      const results = await statuses(() => call({ headers }), 3);
      assert.equal(results[2], 429, `still limited with ${JSON.stringify(headers)}`);
    }
  });
});

test('writes from this host stay rate-limited', async () => {
  await withApp(async (call) => {
    assert.deepEqual(await statuses(() => call({ method: 'POST' }), 3), [200, 200, 429]);
  });
});

test('a per-endpoint quota that opts out (data export) still limits direct local reads', async () => {
  await withApp(async (call) => {
    assert.deepEqual(await statuses(() => call(), 3), [200, 200, 429]);
  }, { exemptLocalReads: false });
});

test('direct HEAD reads from this host are exempt like GET', async () => {
  await withApp(async (call) => {
    assert.deepEqual(await statuses(() => call({ method: 'HEAD' }), 4), [200, 200, 200, 200]);
  });
});

// 2D-2C.2: SSR sends the read-only affiliate resolve over loopback (internal-api.backend.ts READ_SHAPED_POSTS).
test('the read-shaped POST /v2/affiliate/resolve from this host is exempt; other local POSTs stay limited', async () => {
  await withApp(async (call) => {
    const resolve = () => call({ method: 'POST', path: '/v2/affiliate/resolve', headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await statuses(resolve, 5), [200, 200, 200, 200, 200]);
    const resolveQuery = () => call({ method: 'POST', path: '/v2/affiliate/resolve?market=es' });
    assert.deepEqual(await statuses(resolveQuery, 3), [200, 200, 200]);
  });
  await withApp(async (call) => {
    const impression = () => call({ method: 'POST', path: '/v2/affiliate/impression' });
    assert.deepEqual(await statuses(impression, 3), [200, 200, 429], 'impression writes stay limited');
  });
});

test('POST /v2/affiliate/resolve through nginx or with spoofed forwarding headers stays limited', async () => {
  const forwarded: Array<Record<string, string>> = [
    { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7' },
    { 'x-forwarded-for': '127.0.0.1' },
    { 'x-forwarded-for': '' },
    { 'x-real-ip': '127.0.0.1' },
    { forwarded: 'for=127.0.0.1' },
  ];
  for (const headers of forwarded) {
    await withApp(async (call) => {
      const results = await statuses(() => call({ method: 'POST', path: '/v2/affiliate/resolve', headers }), 3);
      assert.equal(results[2], 429, `still limited with ${JSON.stringify(headers)}`);
    });
  }
});

test('a per-endpoint quota that opts out also limits the local affiliate resolve', async () => {
  await withApp(async (call) => {
    assert.deepEqual(await statuses(() => call({ method: 'POST', path: '/v2/affiliate/resolve' }), 3), [200, 200, 429]);
  }, { exemptLocalReads: false });
});

const req = (method: string, originalUrl: string, remoteAddress = '::ffff:127.0.0.1', headers: Record<string, string> = {}) =>
  ({ method, originalUrl, socket: { remoteAddress }, headers }) as any;

test('isDirectLocalRead: loopback reads and the read-shaped affiliate resolve only', () => {
  assert.equal(isDirectLocalRead(req('GET', '/v2/catalog?types=movie')), true);
  assert.equal(isDirectLocalRead(req('POST', '/v2/affiliate/resolve')), true);
  assert.equal(isDirectLocalRead(req('POST', '/v2/affiliate/resolve?x=1')), true);
  assert.equal(isDirectLocalRead(req('POST', '/v2/affiliate/resolve/x')), false);
  assert.equal(isDirectLocalRead(req('POST', '/v2/affiliate/impression')), false, 'writes stay limited');
  assert.equal(isDirectLocalRead(req('POST', '/v2/auth/login')), false);
  assert.equal(isDirectLocalRead(req('PUT', '/v2/affiliate/resolve')), false);
  assert.equal(isDirectLocalRead(req('POST', '/v2/affiliate/resolve', '203.0.113.9')), false, 'remote peer');
  assert.equal(
    isDirectLocalRead(req('POST', '/v2/affiliate/resolve', '127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })),
    false,
    'through nginx'
  );
});
