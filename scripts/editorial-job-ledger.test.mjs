import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLedgerLifecycle } from './editorial-job-ledger.mjs';

/** Minimal ledger API double: proves the runner sends a lease on every write and closes after publication. */
async function fakeLedger() {
  const calls = [];
  let cancel = false;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method: request.method, path: request.url, body });
    response.setHeader('content-type', 'application/json');
    const send = (status, data) => { response.statusCode = status; response.end(JSON.stringify({ success: status < 400, data })); };
    if (request.url.endsWith('/register')) return send(201, { jobId: body.jobId, state: 'queued' });
    if (request.url.endsWith('/claim')) return send(200, { jobId: 'job', state: 'running', lease: { token: '11111111-1111-4111-8111-111111111111', generation: 1 } });
    if (request.url.endsWith('/heartbeat')) return send(200, { job: { state: 'running' }, cancelRequested: cancel, pauseRequested: false });
    if (request.url.endsWith('/finish')) return send(200, { jobId: 'job', state: body.state });
    return send(200, { jobId: 'job', ok: true });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    api: `http://127.0.0.1:${port}`,
    calls,
    setCancel: (value) => { cancel = value; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('ledger runner session: register, claim, stage, publish and finish are lease-guarded', async () => {
  const fake = await fakeLedger();
  try {
    const ledger = createLedgerLifecycle({ api: fake.api, key: 'test-key', stageMs: 60_000, articleMs: 120_000, heartbeatMs: 60_000, leaseMs: 90_000 });
    const session = await ledger.lifecycle.start({ slug: 'guia-de-prueba' });
    assert.match(session.lease.token, /^[0-9a-f-]{36}$/);
    assert.equal(session.lease.generation, 1);
    // Stages decided before the pipeline starts are explicitly skipped, not invented as completed.
    const skipped = fake.calls.filter((call) => call.path.endsWith('/stage/finish')).map((call) => call.body.state);
    assert.deepEqual(skipped, ['skipped', 'skipped', 'skipped']);

    await session.stage({ name: 'source-retrieval', phase: 'start', detail: 'semillas' });
    await session.stage({ name: 'source-retrieval', phase: 'finish', status: 'completed' });
    await session.checkpoint('run-1', 'abc', 'source-retrieval');
    await session.startStage('publication', 'publicación');
    await session.publicationBegin('guia-de-prueba:hash');
    await session.publicationFinish('published', 'https://guiaprogramaciontv.com/guias/guia-de-prueba');
    session.record({ state: 'published', cost: { entries: [{ inputTokens: 10, outputTokens: 5 }], usd: 0.01 } });
    await ledger.close('guia-de-prueba', session.run);

    const finish = fake.calls.find((call) => call.path.endsWith('/finish') && !call.path.includes('/stage/'));
    assert.equal(finish.body.state, 'completed');
    assert.equal(finish.body.usage.inputTokens, 10);
    assert.equal(finish.body.usage.usd, 0.01);
    assert.ok(fake.calls.filter((call) => call.path.includes('/stage/') || call.path.includes('/checkpoint') || call.path.includes('/publication') || call.path.endsWith('/finish')).every((call) => call.body.token === session.lease.token));
  } finally {
    await fake.close();
  }
});

test('a cancel heartbeat aborts the in-flight provider stream', async () => {
  const fake = await fakeLedger();
  try {
    const ledger = createLedgerLifecycle({ api: fake.api, key: 'test-key', stageMs: 60_000, articleMs: 120_000, heartbeatMs: 60_000 });
    const session = await ledger.lifecycle.start({ slug: 'guia-cancelada' });
    fake.setCancel(true);
    await session.heartbeat();
    assert.equal(session.signal.aborted, true);
    await ledger.close('guia-cancelada', { state: 'blocked', reason: 'cancelado' });
    const finish = fake.calls.find((call) => call.path.endsWith('/finish') && !call.path.includes('/stage/'));
    assert.equal(finish.body.state, 'cancelled');
  } finally {
    await fake.close();
  }
});
