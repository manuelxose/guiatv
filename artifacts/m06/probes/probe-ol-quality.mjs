import fs from 'node:fs';
const codes = { 'bl1@2026': ['bl1','2026'], 'pl@2026': ['pl','2026'], 'ucl@2026': ['ucl','2026'], 'uel2026@2026': ['uel2026','2026'], 'uecl2026@2026': ['uecl2026','2026'], 'wm2026@2026': ['wm2026','2026'], 'dfb@2026': ['dfb','2026'], 'bl2@2026': ['bl2','2026'] };
const report = {};
for (const [key, [code, season]] of Object.entries(codes)) {
  const j = await (await fetch(`https://api.openligadb.de/getmatchdata/${code}/${season}`)).json();
  const teamIds = new Set(j.flatMap(m => [m.team1.teamId, m.team2.teamId]));
  let goals = 0, noSide = 0, mismatch = 0, noVenue = 0, finished = 0, badFinal = 0;
  for (const m of j) {
    if (!m.matchIsFinished) continue;
    finished++;
    if (!m.location || !m.location.locationStadium) noVenue++;
    const last = m.matchResults && m.matchResults[m.matchResults.length - 1];
    if (!last) { badFinal++; continue; }
    const gl = m.goals || [];
    for (const g of gl) { goals++; if (g.scoringTeamId == null || !teamIds.has(g.scoringTeamId)) noSide++; }
    if (gl.length) { const lg = gl[gl.length - 1]; if (Number(lg.scoreTeam1) !== Number(last.pointsTeam1) || Number(lg.scoreTeam2) !== Number(last.pointsTeam2)) mismatch++; }
  }
  const anyResultFields = j[0] ? Object.keys(j[0]) : [];
  const latestUpdate = j.map(m => m.lastUpdateDateTime).filter(Boolean).sort().pop();
  report[key] = { total: j.length, finished, goals, goalsWithoutSide: noSide, finalScoreMismatch: mismatch, finishedWithoutVenue: noVenue, finishedWithoutFinalResult: badFinal, latestUpdate, hasRefereeField: anyResultFields.some(f => /referee/i.test(f)) };
  console.log(key.padEnd(14), JSON.stringify(report[key]));
}
fs.writeFileSync('artifacts/m06/probes/openligadb-quality-2026.json', JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
