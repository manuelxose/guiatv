# M06 — Real ingestion evidence

Date: **2026-11-06**. Author: captain. Branch `feat/m06-ingest-adapters` (commit `4cfc429d`).

Every figure below was produced by a command executed during this session against a **real MongoDB 7**
container and the **live OpenLigaDB API**. Nothing is mocked. Where something could not be verified it
is labelled as such rather than inferred.

---

## 1. Environment

| Item | Value |
|---|---|
| Database | `mongodb://127.0.0.1:27017`, database **`guiatv_m06_evidence`** |
| How | Docker container `guiatv-m06-mongo` (image `mongo:7`, volume `m06mongo`, `--restart unless-stopped`) |
| Provider | `api.openligadb.de` (anonymous, no key) |
| Ingestion entry | `node apps/backend/dist/jobs/football/cli/runIngestion.cli.js` with `MONGODB_DB_NAME=guiatv_m06_evidence` |

**Operator note:** `MONGODB_DB_NAME` overrides the database name in `MONGODB_URI`. The first run of
this session silently wrote into `guiatv` because of that; the runs below use the explicit database
name and the evidence database is separate from any application database.

---

## 2. The data flow that was actually exercised

```
OpenLigaDB (8 competitions)
  -> OpenLigaDbAdapter            (map shortcode -> catalog slug; parse; never fabricate)
  -> eligibility                  (assertEligible: only approved providers)
  -> RequestBudget                (one shared budget for the whole tick)
  -> SingleFlight + GracefulDegradation
  -> buildSnapshots               (canonicalKey + contentHash + sourceTimestamp)
  -> Mongo football_snapshots     (idempotent upsert)
  -> football_provider_sync_state (success/error bookkeeping)
  -> football_ingestion_runs      (audit of each tick)
```

One lock and one budget are shared by every competition, so the quota is authoritative for the whole
run rather than per league.

---

## 3. Run result (real output)

```
{"outcome":"success","requestsUsed":8,"snapshotsWritten":1444,
 "buckets":{"completed":479,"today":4,"future":942,"historical":19},
 "competitions":[
   {"leagueShortcut":"bl1",  "outcome":"success","requestsUsed":1,"snapshotsWritten":306,"matches":306},
   {"leagueShortcut":"bl2",  "outcome":"success","requestsUsed":1,"snapshotsWritten":306,"matches":306},
   {"leagueShortcut":"pl",   "outcome":"success","requestsUsed":1,"snapshotsWritten":380,"matches":380},
   {"leagueShortcut":"ucl",  "outcome":"success","requestsUsed":1,"snapshotsWritten":144,"matches":144},
   {"leagueShortcut":"uel2026","outcome":"success","requestsUsed":1,"snapshotsWritten":144,"matches":144},
   {"leagueShortcut":"uecl2026","outcome":"success","requestsUsed":1,"snapshotsWritten":108,"matches":108},
   {"leagueShortcut":"dfb",  "outcome":"success","requestsUsed":1,"snapshotsWritten":56,"matches":56},
   {"leagueShortcut":"wm2026","outcome":"empty","reason":"provider returned no matches for this competition","requestsUsed":1,"snapshotsWritten":0,"matches":0}
 ]}
```

Total: **1,444 real match snapshots** persisted across **7 competitions**.

`wm2026` (World Cup 2026) returned `empty`: all its matches finished in June 2026 and have aged past
the snapshot TTL. It is reported as `empty`, **not** as a success — see §6.

---

## 4. Stored documents (queried from MongoDB, not from memory)

Counts per competition in `football_snapshots`:

| competitionSlug | documents |
|---|---:|
| premier-league | 380 |
| bundesliga | 306 |
| bundesliga-2 | 306 |
| europa-league | 144 |
| champions-league | 144 |
| conference-league | 108 |
| dfb-pokal | 56 |
| **total** | **1,444** |

### 4.1 A real finished Champions League match

`canonicalKey = fc-brugge-aston-villa-2026-09-08`

| Field | Stored value |
|---|---|
| id | `87388` |
| competition | `champions-league` / "UEFA Champions League" |
| season | `2026` |
| status | `finished` |
| kickoffAt | `2026-09-08T16:45:00Z` |
| home | `FC Brügge` (provider id `openligadb:1210`) |
| away | `Aston Villa` (provider id `openligadb:438`) |
| sourceTimestamp | `2026-09-08T18:40:14.450Z` |
| contentHash | `ef51e3586777a7fd0e5ddae0943769aa1d30e1d4925da90740ca8ffb0b4653f1` |

Real goal timeline as stored (`match.events`), each with the provider's own `goalID`:

| minute | scorer | teamId | penalty | own goal | scoreAfter |
|---:|---|---|---|---|---|
| 11 | John McGinn | 438 | no | no | 0–1 |
| 19 | Hugo Vetlesen | 1210 | no | no | 1–1 |
| 22 | Emiliano Buendía | 438 | no | no | 1–2 |
| 44 | Nicolas Jackson | 438 | no | no | 1–3 |
| 61 | N. Tresoldi | 1210 | no | no | 2–3 |

These are the same values the live provider returned in the probe captured at
`artifacts/m06/probes/ucl-sample.json`, which is the provenance check: the stored timeline is the
provider's timeline, not a reconstruction.

### 4.2 What is honestly absent

For the same stored match: `minute` (live clock) is absent, and `lineups`, team `statistics`,
`standings` and `referee` are absent — because OpenLigaDB does not publish them. The adapter and the
stored document agree that absent means absent.

---

## 5. Idempotency (verified)

A second, independent run of the same tick:

- total `football_snapshots`: **1,444 before and 1,444 after**
- distinct `canonicalKey`: **1,444**
- duplicate `canonicalKey` groups: **0**
- `contentHash` for the sampled UCL match: **identical before and after**
  (`ef51e35…`), and a third run left it unchanged again.

So a repeated tick rewrites the same documents rather than accumulating duplicates.

---

## 6. Defects found during this evidence run (fixed, not hidden)

| # | Defect | Why it mattered | Fix |
|---|---|---|---|
| 1 | A competition returning **zero** matches reported `outcome: "success"` (observed on `wm2026`) | A false-healthy signal: the dashboard would show "success" for a competition that delivered nothing | New distinct outcome `empty` with an explicit reason; `success` now implies matches were stored |
| 2 | `buildSnapshotContentHash` hashed `lastUpdatedAt`/`ingestedAt` | Every run produced a new hash for unchanged football data, so the hash could not detect a real change — the only thing it exists for | Volatile keys excluded; two new regression tests (unchanged timestamps hash identically, a real result change hashes differently) |

Both were found by running the system, not by reading it. Both are covered by tests.

---

## 7. Restart / crash recovery

Partially demonstrated:

- Every run is an independent process that connects, runs one tick, and disconnects. The repeat runs in
  §5 are therefore separate processes against the same database, and no duplicate or corrupted state
  resulted — **process restart does not duplicate ingestion**.
- Lease expiry and crash recovery of the scheduler lock are covered by the durable-store tests on
  `feat/m06-ops-quota` (including a real-Mongo integration test), not by a killed-process test here.

**Not verified:** killing a process mid-tick and observing the lock being recovered. That is covered by
unit/integration tests and is stated as such rather than claimed as an end-to-end observation.

---

## 8. Live match verification

**`LIVE_VERIFICATION_PENDING`.**

No approved fixture was in play during this session. Bundesliga match `83234`
(Hamburger SV v Borussia Mönchengladbach) kicks off **2026-11-06T19:30Z / 20:30 local**, which is after
the moment of writing. No mocked live data was substituted, and no live state is claimed.

Two consequences for the product, both unchanged from M05: OpenLigaDB publishes **no live minute**, and
its `matchIsFinished` flag is the only status signal — so "live" is at best "kicked off and not yet
finished", never a completed live tracker.

---

## 9. Summary against the real-ingestion acceptance bar

| Requirement | Status | Evidence |
|---|---|---|
| Authorised source | **PASS** | OpenLigaDB, ODbL, anonymous |
| Real current-season data | **PASS** | 1,444 snapshots, 2026/27 |
| Verified actual endpoint responses | **PASS** | probe JSON + stored source timestamps |
| Automatic ingestion | **PASS** | scheduled loop + CLI; adaptive interval |
| Validated normalisation | **PASS** | adapter suite 24/24, absent fields stay absent |
| Database persistence | **PASS** | real MongoDB 7, counts above |
| Correct API output | **Pending** | covered by the integration step, not this task |
| Recovery and error handling | **PARTIAL** | restart clean; mid-tick kill not observed |
| Live behaviour | **PENDING** | no live window during the run |
