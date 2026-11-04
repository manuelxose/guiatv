/**
 * M12-G3D: low-rate read-only latency probe of the public site (sequential GETs, no concurrency, no load generation).
 * Run it once BEFORE (~03:00), DURING (~03:31) and AFTER (~04:00) the timer window, with the same arguments, and compare:
 *   node scripts/m12g3d-probe.mjs <label> [rounds=20] [pauseMs=1000] <path> [<path> ...]
 * Paths are the actual routes, /v2/health first (e.g. /v2/health /v2/tv/...); the origin comes from PROBE_ORIGIN.
 */
const [label, rounds = '20', pause = '1000', ...paths] = process.argv.slice(2);
const origin = process.env.PROBE_ORIGIN;
if (!origin || !label || !paths.length) { console.error('usage: PROBE_ORIGIN=https://host node m12g3d-probe.mjs <label> [rounds] [pauseMs] <path>...'); process.exit(2); }
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const out = { label, at: new Date().toISOString(), rounds: Number(rounds), paths: {} };
for (const p of paths) {
  const ms = []; let errors = 0;
  for (let i = 0; i < Number(rounds); i++) {
    const t = performance.now();
    try { const r = await fetch(origin + p, { signal: AbortSignal.timeout(15000) }); await r.arrayBuffer(); if (!r.ok) errors++; } catch { errors++; }
    ms.push(Math.round(performance.now() - t));
    await new Promise((r) => setTimeout(r, Number(pause)));
  }
  ms.sort((a, b) => a - b);
  out.paths[p] = { n: ms.length, errors, p50: q(ms, 0.5), p95: q(ms, 0.95), max: ms[ms.length - 1] };
}
console.log(JSON.stringify(out));
