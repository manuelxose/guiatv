import test from 'node:test';
import assert from 'node:assert/strict';
import express, { ErrorRequestHandler } from 'express';
import { createAnalyticsRoutes } from './analytics.routes';
import { AnalyticsController } from '../controllers/AnalyticsController';

test('realtime page report requires an administrator and reports unsupported storage', async () => {
  const app = express();
  const excluded: string[] = [];
  const controller = new AnalyticsController({
    getRealtimePages: async () => null,
    isAvailable: () => true,
    markExcludedSession: async (sessionId: string) => { excluded.push(sessionId); },
    trackEvent: async () => {},
  } as never);
  const auth = { getSession: async (token: string) => ({ id: token, role: token === 'admin' ? 'admin' : 'user' }) };
  app.use(express.json());
  app.use('/analytics', createAnalyticsRoutes(controller, auth as never));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.statusCode || 500).json({ message: error.message }); };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const url = `http://127.0.0.1:${address.port}/analytics/realtime-pages`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer user' } })).status, 403);
    const response = await fetch(url, { headers: { Authorization: 'Bearer admin' } });
    assert.equal(response.status, 503);
    assert.match((await response.json() as { message: string }).message, /no permite calcular/);
    const event = { sessionId: 'session-one', anonId: 'anon-one', type: 'click' };
    const post = (token: string) => fetch(`http://127.0.0.1:${address.port}/analytics/event`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    // Default: legacy endpoints keep their response contract but persist nothing (no consent check upstream).
    const dropped = await post('admin');
    assert.equal(dropped.status, 201);
    assert.equal(dropped.headers.get('x-telemetry-disabled'), '1');
    assert.deepEqual(excluded, []);
    process.env.ANALYTICS_LEGACY_ENDPOINTS = 'accept';
    try {
      assert.equal((await post('user')).status, 201);
      assert.deepEqual(excluded, []);
      assert.equal((await post('admin')).status, 201);
      assert.deepEqual(excluded, ['session-one']);
    } finally {
      delete process.env.ANALYTICS_LEGACY_ENDPOINTS;
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
