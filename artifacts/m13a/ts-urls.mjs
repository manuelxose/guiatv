// Read-only: lists the API URLs each SSR page put into the HTTP transfer cache + the manual keys (size per entry).
const base = 'https://guiaprogramaciontv.com';
for (const path of ['/', '/canales', '/canales/la-1', '/peliculas/gladiator', '/series/modern-family', '/deportes/futbol', '/guias']) {
  const html = await (await fetch(base + path, { headers: { 'user-agent': 'GuiaTV-M13A-baseline/1.0 (read-only)' } })).text();
  const m = /<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  const st = m ? JSON.parse(m[1]) : {};
  console.log('##', path, 'state', m ? Buffer.byteLength(m[1]) : 0);
  for (const [k, v] of Object.entries(st)) {
    const bytes = Buffer.byteLength(JSON.stringify(v));
    if (bytes > 1500) console.log('  ', bytes, v?.u ? `HTTP ${v.u}` : `MANUAL ${k.slice(0, 90)}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
