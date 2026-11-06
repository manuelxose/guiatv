import fs from 'node:fs';
const r = await fetch('https://api.openligadb.de/getmatchdata/ucl/2026', { headers: { 'User-Agent': 'guiatv-m06-probe/1.0' } });
const j = await r.json();
const fin = j.filter(m => m.matchIsFinished);
const withGoals = fin.filter(m => Array.isArray(m.goals) && m.goals.length);
console.log('ucl total', j.length, 'finished', fin.length, 'withGoals', withGoals.length);
const leagues = [...new Set(j.map(m => m.leagueName + '|' + m.leagueShortcut + '|' + m.leagueSeason))];
console.log('leagues', JSON.stringify(leagues));
const teams = [...new Set(j.flatMap(m => [m.team1.teamName, m.team2.teamName]))];
console.log('teamCount', teams.length, JSON.stringify(teams.slice(0, 24)));
const s = withGoals[0];
console.log('sample', s.matchDateTimeUTC, s.team1.teamName, 'vs', s.team2.teamName, s.matchResults.map(x => x.pointsTeam1 + ':' + x.pointsTeam2), 'group', JSON.stringify(s.group), 'loc', JSON.stringify(s.location));
console.log('goals', JSON.stringify(s.goals.slice(0, 5)));
const keys = Object.keys(s);
console.log('fields', JSON.stringify(keys));
fs.writeFileSync('artifacts/m06/probes/ucl-sample.json', JSON.stringify(s, null, 2));
// group stage vs knockout structure
const groups = {}; for (const m of j) { const g = m.group && m.group.groupName || 'none'; groups[g] = (groups[g] || 0) + 1; }
console.log('groups', JSON.stringify(groups).slice(0, 600));
