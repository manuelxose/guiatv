const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createRouter } = require('./dev-server.cjs');

test('routes to the public backend, switches to local, and switches back', async (t) => {
  const listen = async (server, port = 0) => {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return server.address().port;
  };
  const remote = http.createServer((_req, res) => res.end('remote'));
  const remotePort = await listen(remote);
  const local = http.createServer((req, res) => res.end(req.url === '/v2/health' ? 'ok' : 'local'));
  const localPort = await listen(local);
  await new Promise((resolve) => local.close(resolve));
  const router = createRouter(`http://127.0.0.1:${localPort}`, `http://127.0.0.1:${remotePort}`);
  const routerPort = await listen(router);
  t.after(() => { router.close(); local.close(); remote.close(); });
  const read = () => fetch(`http://127.0.0.1:${routerPort}/v2/example`).then((res) => res.text());
  assert.equal(await read(), 'remote');
  await listen(local, localPort);
  assert.equal(await read(), 'local');
  await new Promise((resolve) => local.close(resolve));
  assert.equal(await read(), 'remote');
});
