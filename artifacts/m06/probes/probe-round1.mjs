const urls = {
  ol_current_leagues: 'https://api.openligadb.de/getavailableleagues',
  ol_currentgroup_bl1: 'https://api.openligadb.de/getcurrentgroup/bl1',
  ol_now_bl1: 'https://api.openligadb.de/getmatchdata/bl1',
  ol_liga1_2026_8: 'https://api.openligadb.de/getmatchdata/liga1/2026/8',
  ol_spa1_2026: 'https://api.openligadb.de/getmatchdata/spa1/2026',
  ol_ucl_2026: 'https://api.openligadb.de/getmatchdata/ucl/2026',
  tsdb_key123_leagues: 'https://www.thesportsdb.com/api/v1/json/123/all_leagues.php',
  openfootball_es_2627: 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/es.1.json',
  openfootball_en_2627: 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json',
  openfootball_de_2627: 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/de.1.json',
  football_data_org_nokey: 'https://api.football-data.org/v4/competitions/PD/matches',
};
const out = {};
for (const [k, u] of Object.entries(urls)) {
  const t0 = Date.now();
  try {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 20000);
    const r = await fetch(u, { signal: ac.signal, headers: { 'User-Agent': 'guiatv-m06-probe/1.0' } });
    const body = await r.text(); clearTimeout(timer);
    out[k] = { status: r.status, bytes: body.length, ms: Date.now() - t0, head: body.slice(0, 260) };
  } catch (e) { out[k] = { error: String(e && e.message || e), ms: Date.now() - t0 }; }
  console.log(k.padEnd(24), JSON.stringify(out[k]).slice(0, 300));
}
require('fs').writeFileSync('artifacts/m06/probes/probe-round1.json', JSON.stringify({ at: new Date().toISOString(), urls, out }, null, 2));
