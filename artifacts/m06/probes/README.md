# M06 probe artifacts

Raw, machine-generated evidence. Nothing here is hand-written or estimated.

| File | Produced by | What it proves |
|---|---|---|
| `probe-round1.json` | `probe-round1.mjs` (2026-11-06) | HTTP status/bytes/latency for the first candidate-endpoint sweep |
| `probe-round2.json` | `probe-round2.mjs` | OpenLigaDB league-code discovery (which 2026/27 competitions carry data) |
| `openligadb-leagues-2026.json` | `probe-ol-leagues.mjs` | The complete OpenLigaDB catalogue for season 2026 (83 shortcuts) |
| `openligadb-quality-2026.json` | `probe-ol-quality.mjs` | Per-competition counts of finished matches, goals, goals without a resolvable side, final-score/goal-timeline disagreements, venue presence |
| `ucl-sample.json` | `probe-ucl.mjs` | One complete raw UCL match payload (schema reference) |
| `openfootball-es-sample.json` | `probe-of-es.mjs` | One complete raw OpenFootball Spain payload (schema reference) |

Re-run any probe with `node artifacts/m06/probes/<script>.mjs` from the repository root.
Probes are read-only GETs against public endpoints; none authenticates, none scrapes HTML.
