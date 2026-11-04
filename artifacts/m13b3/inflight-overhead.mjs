// M13-B3a overhead: loopback requests/s against a trivial Express app with and without the in-flight tracker.
// Server in a child process (fresh per run), client in the parent; ABBA order; per-process medians reported.
// Usage (after `npm run build -w apps/backend`): node artifacts/m13b3/inflight-overhead.mjs [runs=6] [seconds=3]
import { fork } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..', '..', 'apps', 'backend');

if (process.argv[2] === '--server') {
  const require = createRequire(join(backend, 'package.json'));
  const express = require('express');
  const app = express();
  if (process.argv[3] === 'tracked') app.use(require(join(backend, 'dist/presentation/middlewares/inflightRequestTracker.js')).inflightRequestTracker);
  app.get('/items/:id', (req, res) => res.json({ id: req.params.id, ok: true }));
  const server = http.createServer(app).listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
} else {
  const runs = Number(process.argv[2] ?? 6);
  const seconds = Number(process.argv[3] ?? 3);
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  async function once(arm) {
    const child = fork(fileURLToPath(import.meta.url), ['--server', arm]);
    const { port } = await new Promise((resolve) => child.once('message', resolve));
    const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
    const lat = [];
    let done = 0;
    const end = performance.now() + seconds * 1000;
    const worker = async () => {
      while (performance.now() < end) {
        const t0 = performance.now();
        await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: `/items/${done % 997}`, agent }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject));
        lat.push(performance.now() - t0); done += 1;
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    agent.destroy(); child.kill();
    lat.sort((a, b) => a - b);
    return { rps: done / seconds, p50: lat[Math.floor(lat.length / 2)], p99: lat[Math.floor(lat.length * 0.99)] };
  }
  const order = [];
  for (let i = 0; i < runs; i += 1) order.push(...(i % 2 === 0 ? ['plain', 'tracked'] : ['tracked', 'plain']));
  const results = { plain: [], tracked: [] };
  await once('plain'); // warm-up, discarded
  for (const arm of order) results[arm].push(await once(arm));
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
    rpsMedian: Math.round(median(v.map((r) => r.rps))), rpsRange: [Math.round(Math.min(...v.map((r) => r.rps))), Math.round(Math.max(...v.map((r) => r.rps)))],
    p50Ms: +median(v.map((r) => r.p50)).toFixed(3), p99Ms: +median(v.map((r) => r.p99)).toFixed(3),
  }]));
  const out = { node: process.version, runsPerArm: runs, seconds, summary, raw: results };
  writeFileSync(join(here, 'inflight-overhead.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
