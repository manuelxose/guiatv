# F01 — Root cause reproduced against a real backend and a real MongoDB

Captured 2026-11-06 by the captain **before** any recovery change, on branch
`feat/m06-r1-recovery` at `f020ea82` (the independent-review HEAD).

## Environment actually used

| Item | Value |
|---|---|
| Backend | `node apps/backend/dist/server/index.js` from a clean build |
| MongoDB | real `mongod` 8.2.6, `--dbpath <temp>`, `127.0.0.1:27018`, verified with a driver `ping: 1` |
| Database | `guiatv_m06r1` (isolated; indexes created at boot) |
| Admin credential | `ANALYTICS_ADMIN_KEY` supplied as the `x-admin-key` header |
| Public API prefix | `/v2` (there is **no** `/api` prefix — `/api/v2/...` correctly returns 404) |

MongoDB was made available by extracting the real `mongod` binary and running it detached; it is
**not** an in-memory fake and not a mock.

## The new `t7` admin API works

All fifteen mounted routes answered `200` with real stored data (1 444 snapshots ingested from
OpenLigaDB, 8 quota requests recorded for the day):

| Endpoint | Status | Observed data |
|---|---|---|
| `GET /v2/sports/football/admin/dashboard` | 200 | `snapshots: 1444`, `staleSnapshots: 1444`, `lastSyncAt` set |
| `GET /v2/sports/football/admin/providers` | 200 | `openligadb`, `health: ok`, `quotaConsumedToday: 8` |
| `GET /v2/sports/football/admin/coverage` | 200 | catalog rows incl. `laliga → competition_not_covered` |
| `GET /v2/sports/football/admin/matches` | 200 | `page 1`, `limit 25`, `total 1444`, real fixtures |
| `GET /v2/sports/football/admin/entity-mappings` | 200 | `total: 0` (no per-entity mappings stored) |
| `GET /v2/sports/football/admin/broadcasts` | 200 | `total: 0` |
| `GET /v2/sports/football/admin/ingestion/status` | 200 | providers + quota block |
| `GET /v2/sports/football/admin/quality-issues` | 200 | `stale-snapshots: 1444 snapshots older than 6h` |
| `GET /v2/sports/football/admin/audit` | 200 | `total: 0` |
| `GET /v2/sports/football/admin/diagnostics` | 200 | `quotaRemaining: 1492`, `quotaReserveRemaining: 300` |
| `POST /v2/sports/football/admin/ingestion/sync` | (not fired in this probe — mutating) | — |

Unauthenticated access is rejected, fail-closed:

```
GET /v2/sports/football/admin/dashboard            (no key) → 403 {"code":"FORBIDDEN","message":"Invalid admin key"}
```

## The reason the console still fails: it never calls these routes

`apps/frontend/src/app/features/football/admin-data/football-admin-data.service.ts` does not call
`/v2/sports/football/admin/*` at all. It goes through `AdminOperationsService`, which calls the
legacy endpoints:

```
GET  /v2/admin/football/overview
GET  /v2/admin/football/competitions
GET  /v2/admin/football/teams
GET  /v2/admin/football/fixtures
GET  /v2/admin/jobs
POST /v2/admin/football/refresh
```

Those are guarded by `createAdminAccessGuard`, which accepts **either** `x-admin-key` **or** an admin
session JWT. The browser sends only `Authorization: Bearer <localStorage gtv_id_token>`:

| Request as the browser actually issues it | Status | Body |
|---|---|---|
| `GET /v2/admin/football/overview` with no credentials | **401** | `Authorization token missing` |
| same with a bogus bearer token | **401** | `Invalid or expired token` |

So the console's failure is an **authorization-contract mismatch**, and the independent review's
recorded `500` is a separate symptom of the same wiring (the saved `browser-pass.json` records
`"500 /v2/admin/football/overview"`; reproduced here as 401 because no session exists in this probe).

## Second defect found while reproducing F01 (new, not in the review)

The two guards accept **different** credentials:

- legacy `createAdminAccessGuard` → `x-admin-key` **or** admin JWT;
- `t7` `analyticsAdminGuard` → `x-admin-key` **only**.

A normal admin session (JWT, role `admin`) is therefore **forbidden from the new admin API**, even
though it is allowed on the legacy one. Wiring the console to `t7` without fixing this would trade
one failure for another. The recovery must give both surfaces one coherent authorization contract,
and keep it fail-closed when no credential is configured.

## Consequences for the recovery plan

1. F01 is a **frontend-contract + authorization** defect, not a backend-availability defect. The new
   API is sound and returns real data.
2. The Angular client must be rewritten as one strongly typed client over `t7`, and every screen must
   map a *truthful* state: success-with-data, success-empty, unauthorized, unavailable.
3. The `t7` guard must accept an authenticated admin session (same rule as the legacy guard) **and**
   the shared key, still rejecting anything else.
