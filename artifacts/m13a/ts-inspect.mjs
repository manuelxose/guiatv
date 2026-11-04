// Read-only: one GET per path, report which TransferState keys dominate the SSR HTML.
const [path, base = 'https://guiaprogramaciontv.com'] = process.argv.slice(2);
const res = await fetch(base + path, { headers: { 'user-agent': 'GuiaTV-M13A-baseline/1.0 (read-only)', 'accept-encoding': 'gzip, br' } });
const html = await res.text();
const m = /<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
console.log(path, 'status', res.status, 'enc', res.headers.get('content-encoding'), 'htmlBytes', Buffer.byteLength(html), 'stateBytes', m ? Buffer.byteLength(m[1]) : 0);
if (m) {
  const st = JSON.parse(m[1]);
  const rows = Object.entries(st).map(([k, v]) => {
    const s = JSON.stringify(v);
    const u = v?.u || v?.url || '';
    return { key: k.slice(0, 12), bytes: Buffer.byteLength(s), url: String(u).slice(0, 110), items: Array.isArray(v?.b?.data?.items) ? v.b.data.items.length : Array.isArray(v?.b?.data?.channels) ? v.b.data.channels.length : undefined };
  }).sort((a, b) => b.bytes - a.bytes);
  for (const r of rows.slice(0, 8)) console.log(JSON.stringify(r));
}
