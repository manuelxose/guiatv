import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createTrustProxy, trustProxy } from './trustProxy';

// A real express app reporting req.ip. The client connects over loopback, like nginx does on the server.
async function ipOf(headers: Record<string, string>, trust: ReturnType<typeof createTrustProxy> = trustProxy): Promise<string> {
  const app = express();
  app.set('trust proxy', trust);
  app.get('/', (req, res) => res.send(req.ip));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((ok) => server.once('listening', ok));
  try {
    const { port } = server.address() as AddressInfo;
    return await (await fetch(`http://127.0.0.1:${port}/`, { headers })).text();
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

const EDGE_V4 = '172.68.10.20'; // 172.64.0.0/13
const EDGE_V6 = '2a06:98c0:3600::103'; // 2a06:98c0::/29

test('visitor behind Cloudflare: req.ip is the address Cloudflare wrote, not the edge nginx appended', async () => {
  assert.equal(await ipOf({ 'x-forwarded-for': `83.40.1.1, ${EDGE_V4}` }), '83.40.1.1');
  assert.equal(await ipOf({ 'x-forwarded-for': `2a02:9130::1, ${EDGE_V6}` }), '2a02:9130::1');
  // The client sent its own X-Forwarded-For; Cloudflare appended the real visitor after it.
  assert.equal(await ipOf({ 'x-forwarded-for': `127.0.0.1, 10.0.0.1, 83.40.1.1, ${EDGE_V4}` }), '83.40.1.1');
});

test('forged header sent straight to the origin: req.ip is the sender, whatever the header says', async () => {
  // Sent to nginx without Cloudflare: nginx appends the sender (198.51.100.9), which is not a Cloudflare address.
  assert.equal(await ipOf({ 'x-forwarded-for': '203.0.113.50, 198.51.100.9' }), '198.51.100.9');
  assert.equal(await ipOf({ 'x-forwarded-for': `203.0.113.50, ${EDGE_V4}, 198.51.100.9` }), '198.51.100.9');
  assert.equal(await ipOf({ 'x-forwarded-for': 'not-an-ip, 198.51.100.9' }), '198.51.100.9');
  // Sent straight to the API from outside (ports are closed by ufw, but if not): the TCP peer is not trusted,
  // even when it is a Cloudflare address, so the header is never read.
  assert.equal(trustProxy('198.51.100.9', 0), false);
  assert.equal(trustProxy(EDGE_V4, 0), false);
  assert.equal(trustProxy(`::ffff:${EDGE_V4}`, 0), false);
});

test('direct loopback request (Angular SSR → 127.0.0.1:4000, no header): req.ip is loopback', async () => {
  assert.match(await ipOf({}), /^(?:::ffff:)?127\.0\.0\.1$/);
  assert.equal(trustProxy('127.0.0.1', 0), true);
  assert.equal(trustProxy('::ffff:127.0.0.1', 0), true);
  assert.equal(trustProxy('::1', 0), true);
  // Loopback is trusted as the TCP peer only: a loopback entry inside the header is just an address someone wrote.
  assert.equal(trustProxy('127.0.0.1', 1), false);
});

test('ANALYTICS_TRUST_CLOUDFLARE=false falls back to the address nginx saw (the old trust proxy 1)', async () => {
  const off = createTrustProxy({ ANALYTICS_TRUST_CLOUDFLARE: 'false' });
  assert.equal(await ipOf({ 'x-forwarded-for': `83.40.1.1, ${EDGE_V4}` }, off), EDGE_V4);
  const custom = createTrustProxy({ ANALYTICS_CLOUDFLARE_RANGES: '192.0.2.0/24' });
  assert.equal(await ipOf({ 'x-forwarded-for': '83.40.1.1, 192.0.2.7' }, custom), '83.40.1.1');
  assert.equal(await ipOf({ 'x-forwarded-for': `83.40.1.1, ${EDGE_V4}` }, custom), EDGE_V4);
});
