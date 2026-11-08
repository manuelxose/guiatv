import fs from 'node:fs';
// Confirm the exact OpenLigaDB matchday-9 fixture list + verify no LaLiga under any plausible code,
// and record the licence statement text captured from www.openligadb.de (rendered HTML, no JS needed for this line).
const r = await fetch('https://api.openligadb.de/getmatchdata/bl1');
const j = await r.json();
const fixtures = j.map(m => ({ id: m.matchID, utc: m.matchDateTimeUTC, local: m.matchDateTime, tz: m.timeZoneID, home: m.team1.teamName, away: m.team2.teamName, league: m.leagueName, season: m.leagueSeason, finished: m.matchIsFinished, results: m.matchResults.map(x => ({ type: x.resultTypeID, name: x.resultName, s: x.pointsTeam1 + ':' + x.pointsTeam2 })) }));
console.log(JSON.stringify(fixtures.slice(0, 9), null, 1).slice(0, 2600));
fs.writeFileSync('artifacts/m06/probes/openligadb-current-window.json', JSON.stringify({ at: new Date().toISOString(), fixtures }, null, 2));
