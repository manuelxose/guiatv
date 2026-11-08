# M06 — Provider eligibility

Date: **2026-11-06**. Author: captain. Supersedes the M05 eligibility notes where they conflict.

This document is the **authority** for which provider may be selected. The enforcement lives in
`providerEligibilityRegistry` (`assertEligible` is the only admission gate); this file explains the
verdicts behind each entry.

---

## 1. Classification vocabulary

| Class | Meaning |
|---|---|
| `APPROVED_AND_VERIFIED` | rights documented, current-season data probed, full required capability set demonstrated |
| `APPROVED_LIMITED_COVERAGE` | rights documented, current-season data probed, **partial** capability set |
| `RESEARCH_ONLY` | data obtainable but not suitable for current publication |
| `REQUIRES_CREDENTIALS` | needs a key/plan that does not exist in this environment |
| `LEGAL_REVIEW_REQUIRED` | rights genuinely undetermined; must not be enabled |
| `BLOCKED` | terms prohibit the intended use |
| `UNAVAILABLE` | no usable endpoint |

Only `APPROVED_AND_VERIFIED` and `APPROVED_LIMITED_COVERAGE` may be selected by the production
orchestration system.

---

## 2. Current verdicts

### 2.1 OpenLigaDB — `APPROVED_LIMITED_COVERAGE`

- **Rights:** ODbL (Open Database License), stated on `openligadb.de` with links to `/lizenz` and
  `/nutzungsbedingungen`. ODbL permits reuse including commercially, **with attribution**.
- **Auth / cost:** none / none.
- **Competitions verified 2026/27:** `bl1`, `bl2`, `pl` (Premier League), `ucl`, `uel2026`,
  `uecl2026`, `wm2026`, `dfb`.
- **Capabilities verified:** fixtures, results, goal timelines (scorer, minute, penalty, own goal),
  rounds, venue where supplied, team ids/names, update timestamps.
- **Capabilities absent:** live minute, lineups, statistics, standings, referee.
- **Attribution requirement:** must display an OpenLigaDB/ODbL credit on the public site.
  **The exact wording is still uncaptured** — see the open blocker below.

**Why not `APPROVED_AND_VERIFIED`:** the capability set is materially incomplete (no live minute,
line-ups, statistics, standings, referee) and the attribution text is not yet in hand.

### 2.2 football-data.org — `REQUIRES_CREDENTIALS`

No `FOOTBALL_DATA_API_KEY` exists; the matches endpoint returns 403 anonymously. Commercial
republication rights have been unresolved since M05. The adapter remains a **prototype**, unreachable
through the orchestrator. Must not be activated until both the key and the rights decision exist.

### 2.3 TheSportsDB — `BLOCKED`

Only a public demo key is available; it returns truncated responses and is explicitly not for
production. No redistribution entitlement.

### 2.4 API-Football, Sportmonks — `BLOCKED`

Free/paid plans exclude the required commercial redistribution. Enabling them would require a paid
licence, which the zero-recurring-cost objective forbids.

### 2.5 StatsBomb open data — `RESEARCH_ONLY`

Historical event data for analysis; not a current-season live production feed.

### 2.6 OpenFootball — `RESEARCH_ONLY`

Data is present but the 2026/27 Spain file stops at matchday 7 (2026-09-20) with no goal events.
Publishing it as current would be misleading.

### 2.7 Google Sports, Flashscore — `BLOCKED`

No licence to reuse; extraction is prohibited by their terms. No adapter exists or will exist.

### 2.8 ScrapingBee, SerpApi — `LEGAL_REVIEW_REQUIRED`

Extraction services convey no rights to the underlying sports data. Never enableable on the basis of
a paid key alone.

### 2.9 EPG (existing GuíaTV EPG) — not a football provider

The EPG supplies programme listings, not verified results. A match *found* in the EPG is **not** a
result-bearing football match. The two must never be conflated in the API or the UI.

---

## 3. Competitions the system must report as uncovered

No approved provider supplies these for 2026/27:

`laliga`, `laliga-hypermotion`, `copa-del-rey`, `serie-a`, `ligue-1`, `primeira-liga`,
`eredivisie`, `seleccion-espanola`, `eurocopa`, `nations-league`.

For these the API must emit `competition_not_covered` — never an empty match list, which would read
as "no matches today".

---

## 4. Open blockers

1. **ODbL attribution text not captured** (`LEGAL_EVIDENCE_PARTIAL`). Must be obtained with a real
   browser and displayed publicly before release.
2. **LaLiga gap** — no free current-season source. Accept and report; do not weaken criteria.
3. **football-data.org** — key absent and rights unresolved.

None of these may be closed by inference. Each requires the stated evidence.
