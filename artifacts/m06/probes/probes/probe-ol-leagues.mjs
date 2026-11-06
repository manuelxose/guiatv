import fs from 'node:fs';
const r = await fetch('https://api.openligadb.de/getavailableleagues', { headers: { 'User-Agent': 'guiatv-m06-probe/1.0' } });
const j = await r.json();
const cur = j.filter(l => String(l.leagueSeason) === '2026');
console.log('total leagues', j.length, 'season2026', cur.length);
const bySc = {};
for (const l of cur) { (bySc[l.leagueShortcut] ||= []).push(l.leagueShortcut + ':' + l.leagueSeason + ':' + l.leagueName); }
console.log('shortcuts', Object.keys(bySc).length);
console.log(JSON.stringify(Object.keys(bySc).sort()));
fs.writeFileSync('artifacts/m06/probes/openligadb-leagues-2026.json', JSON.stringify(cur.map(l => ({ leagueId: l.leagueId, name: l.leagueName, shortcut: l.leagueShortcut, season: l.leagueSeason, sport: l.sport && l.sport.sportName })), null, 1));
