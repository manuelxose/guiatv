import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createSwaggerRoutes } from './swagger.routes';

// M10: production looped /v2/docs <-> /v2/docs/ (nginx strips the slash, serve-static adds it).
test('docs answer 200 without a trailing slash and their relative assets resolve under /v2/docs/', async () => {
  const app = express();
  app.use('/v2/docs', createSwaggerRoutes());
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/v2/docs`, { redirect: 'manual' });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<head><base href="\/v2\/docs\/">/);
    const css = html.match(/href="\.\/(swagger-ui\.css)"/)?.[1];
    assert.ok(css, 'the page references its stylesheet relatively');
    assert.equal((await fetch(`${base}/v2/docs/${css}`)).status, 200);
    const init = await fetch(`${base}/v2/docs/swagger-ui-init.js`);
    assert.equal(init.status, 200);
    assert.match(await init.text(), /Guía TV|openapi|swagger/i);
  } finally {
    server.close();
  }
});
