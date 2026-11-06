import fs from 'node:fs';
const r = await fetch('https://api.openligadb.de/getmatchdata/ucl/2026');
const j = await r.json();
let noSide = 0, total = 0, finished = 0, scoreMismatch = 0, sampleMismatch = [];
const teamIds = new Map();
for (const m of j) {
  teamIds.set(m.team1.teamId, m.team1.teamName); teamIds.set(m.team2.teamId, m.team2.teamName);
  if (!m.matchIsFinished) continue;
  finished++;
  for (const g of (m.goals || [])) {
    total++;
    if (g.scoringTeamId == null || !teamIds.has(g.scoringTeamId)) { noSide++; }
  }
  const final = (m.matchResults || []).filter(x => String(x.resultTypeID) === '2' || !x.resultName);
  const last = m.matchResults && m.matchResults[m.matchResults.length - 1];
  const gl = m.goals || [];
  if (gl.length) { const lg = gl[gl.length - 1]; if (last && (Number(lg.scoreTeam1) !== Number(last.pointsTeam1) || Number(lg.scoreTeam2) !== Number(last.pointsTeam2))) { scoreMismatch++; if (sampleMismatch.length < 5) sampleMismatch.push({ id: m.matchID, t: m.team1.teamName + ' v ' + m.team2.teamName, results: m.matchResults.map(x => x.resultName + ':' + x.pointsTeam1 + '-' + x.pointsTeam2), lastGoal: lg.scoreTeam1 + '-' + lg.scoreTeam2 }); } }
}
console.log(JSON.stringify({ finished, totalGoals: total, goalsWithoutResolvableSide: noSide, finalScoreDisagreementWithLastGoal: scoreMismatch }, null, 1));
console.log(JSON.stringify(sampleMismatch, null, 1));
console.log('teamIds resolvable', teamIds.size);
