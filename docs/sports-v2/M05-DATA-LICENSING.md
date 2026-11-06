# M05 — Data licensing and rights register

Verification date: **2026-11-06**. This document separates three things that are routinely
confused, because conflating them is how sites end up republishing data they have no right to:

1. the **software licence** of an open-source scraper or client,
2. the **data licence** of the provider that supplies the numbers,
3. the **right to publish derived data on a commercial public website**.

A permissive software licence says nothing about item 3.

---

## 1. Per-provider rights state

| Provider | Auth | Free tier | Recurring or trial? | Publish derived data commercially? | Attribution | Images/crests | Verdict |
|---|---|---|---|---|---|---|---|
| **OpenLigaDB** | none | free community project, no published limit | recurring (no trial) | **Yes** under ODbL: attribution required, share-alike applies to derived *databases* | required (ODbL) | not covered | **approved** |
| football-data.org | `X-Auth-Token` | 10 req/min free plan; anonymous blocked from standings/matches | recurring | **NOT FOUND** — terms silent | FAQ asks for "Data provided by football-data.org" | not found | **prototype** |
| API-Football | `x-apisports-key` | 100 req/day, resets 00:00 UTC | recurring | **No** — terms explicitly do not license publication | not found | not found | not wired |
| TheSportsDB | shared key | 30 req/min | recurring | restricted: "development projects"; app-store needs paid | paid tier only | 3rd-party logos "as is", no trademark grant | not wired |
| Sportmonks | token | free plan exists | one-time 14-day trial with card | **No** raw redistribution without written approval | not found | not found | not wired |
| Highlightly | `x-rapidapi-key` | free/basic restricted | one-time plan purchase | not found | not found | not found | not wired |
| SportScore | none | ~10,000 req/24h per IP | recurring | **Yes with mandatory badge** | exact dofollow badge required | not found | not wired |
| OpenFootball | none | n/a | n/a | public domain | none required | not applicable | reference only |
| StatsBomb Open Data | none | free | n/a | **No** — research framing | StatsBomb + logo | must use their logo | not wired |
| **Google** | — | — | — | **no official football API** | — | — | **blocked** |
| **SerpApi Google Sports** | api_key | 250 searches/month | recurring | **No** — resale/reproduction forbidden | — | — | **blocked** |
| **Flashscore** | — | — | — | **no permission located** | — | — | **blocked** |

## 2. Repository obligations created by this milestone

- **ODbL (OpenLigaDB).** The ingested football data is a *derived database*. Attribution to
  OpenLigaDB is required wherever the data is shown, and share-alike attaches to the database,
  not to GuíaTV's application code. **Action for the owner:** confirm the attribution text/place
  you want on `guiaprogramaciontv.com` before the first production ingest. This is a content
  decision, not a technical one, so the milestone does not add an unrequested site-wide link.
- **No new outbound SEO obligations** were introduced (no provider link is embedded in public pages).
- **football-data.org** — do not enable its adapter in production until the republication question
  in §1 is settled by the owner.

## 3. What was explicitly NOT done

- No Google or Flashscore scraping in any environment, production or prototype.
- No CAPTCHA circumvention, proxy rotation, fingerprint evasion or rate-limit evasion.
- No account creation, subscription or paid plan.
- No team crests or third-party artwork imported.
- No provider API keys committed, logged, or embedded in the Angular bundle; the only
  key reference is the environment-variable **name** `FOOTBALL_DATA_API_KEY`.

## 4. Credentials policy in code

- `apps/backend/src/config/container.ts` reads `process.env.FOOTBALL_DATA_API_KEY` and passes it
  to the adapter only when defined.
- The ingestion diagnostics endpoint runs its output through a redaction step, and a test asserts
  credentials and keyed URLs never appear in the response.
- OpenLigaDB needs no credential at all, which is why it is the only provider approved today.
