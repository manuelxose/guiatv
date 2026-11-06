const r = await fetch('https://www.openligadb.de/');
const html = await r.text();
const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&auml;/g, 'ä').replace(/&uuml;/g, 'ü').replace(/&ouml;/g, 'ö').replace(/&szlig;/g, 'ß').replace(/\s+/g, ' ');
const idx = [];
for (const kw of ['Lizenz', 'license', 'Nutzungsbedingung', 'Attribution', 'Nennung', 'kommerziell', 'ODbL', 'Open Data', 'Quelle']) {
  let i = -1; while ((i = text.toLowerCase().indexOf(kw.toLowerCase(), i + 1)) !== -1) { idx.push([kw, text.slice(Math.max(0, i - 180), i + 320)]); if (idx.length > 24) break; }
}
const seen = new Set();
for (const [kw, s] of idx) { if (seen.has(s)) continue; seen.add(s); console.log('[' + kw + '] ...' + s + '...\n'); }
