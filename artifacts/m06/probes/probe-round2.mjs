import fs from 'node:fs';
const codes = { la1: '2014', spa1: '2026', esp: '2026', pl1: '2026', pl: '2026', uel2026: '2026', uecl2026: '2026', wm2026: '2026', ucl2026: '2026', bl1: '2026', bl2: '2026', dfb: '2026', OL1: '2026' };
const out = {};
for (const [code, season] of Object.entries(codes)) {
  const u = `https://api.openligadb.de/getmatchdata/${code}/${season}`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'guiatv-m06-probe/1.0' } });
    const t = await r.text();
    let summary = { status: r.status, bytes: t.length };
    try { const j = JSON.parse(t); if (Array.isArray(j)) { summary.items = j.length; summary.leagueNames = [...new Set(j.map(m => m.leagueName))].slice(0, 3); summary.finished = j.filter(m => m.matchIsFinished).length; summary.withGoals = j.filter(m => Array.isArray(m.goals) && m.goals.length).length; summary.last = j.length ? `${j[j.length-1].matchDateTimeUTC} ${j[j.length-1].team1.teamName} v ${j[j.length-1].team2.teamName}` : null; } else summary.head = t.slice(0, 120); } catch { summary.head = t.slice(0, 120); }
    out[code + '@' + season] = summary;
  } catch (e) { out[code + '@' + season] = { error: String(e.message || e) }; }
  console.log((code + '@' + season).padEnd(16), JSON.stringify(out[code + '@' + season]).slice(0, 320));
}
fs.writeFileSync('artifacts/m06/probes/probe-round2.json', JSON.stringify({ at: new Date().toISOString(), out }, null, 2));
