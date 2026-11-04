// Stub API for the analytics browser benchmark (no Mongo is available in the benchmark host).
// Every content endpoint answers 503 so SSR takes its documented fallback path in both arms; telemetry endpoints
// answer like the real API and record what the page sent (count, bytes, path, time) for the harness to read.
import http from 'node:http';
const port = Number(process.env.STUB_PORT || 4000);
const telemetry = [];
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__telemetry') {
    if (req.method === 'DELETE') telemetry.length = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(telemetry));
    return;
  }
  let size = 0;
  const chunks = [];
  req.on('data', (c) => { size += c.length; chunks.push(c); });
  req.on('end', () => {
    if (url.pathname.startsWith('/v2/telemetry/') || url.pathname.startsWith('/telemetry/')) {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { body = null; }
      telemetry.push({ path: url.pathname, bytes: size, at: Date.now(), body });
      if (url.pathname.endsWith('/config')) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ success: true, data: { enabled: process.env.STUB_DISABLED !== '1', ga4: { enabled: process.env.STUB_GA4 === '1', measurementId: 'G-P6Z3BY2DVW' } } }));
        return;
      }
      res.writeHead(url.pathname.endsWith('/collect') ? 202 : 201, { 'content-type': 'application/json' });
      res.end('{"success":true,"data":{"ok":true}}');
      return;
    }
    if (url.pathname === '/v2/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end('{"success":false,"message":"stub"}');
  });
}).listen(port, '127.0.0.1', () => console.log(`stub backend on ${port}`));
