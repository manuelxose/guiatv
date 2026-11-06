# M05-C CONTRACT v1 — Sports V2 Match Center: typed data, events, availability, live UX

MODULE_ASSIGNMENT
class: L2 (UI/UX + accessibility)
primary: deepseek-official/deepseek-v4-pro
escalation: Claude Sonnet 5.5 only for WCAG-critical rework
reason: typed frontend mapping plus accessible live presentation; must not regress SSR/SEO.

## The defect to fix
`apps/frontend/src/app/sports-v2/data/football-mapper.ts` lines ~102-103 hardcode
`events: []` and `stats: []`, discarding any events/statistics the backend sends.
`apps/frontend/src/app/sports-v2/domain/models.ts` already has `MatchEvent` (`goal|yellow|red|sub`) and `MatchStat`.
The backend domain (`apps/backend/src/domain/sports/football/types.ts`) already carries `minute`, `venue`, `events`, `statistics`, `lineups`.

## Files you OWN (create/modify ONLY these)
- `apps/frontend/src/app/sports-v2/domain/models.ts`
- `apps/frontend/src/app/sports-v2/data/football-mapper.ts` and `football-mapper.spec.ts`
- `apps/frontend/src/app/sports-v2/data/availability.ts` (+ `availability.spec.ts`, new)
- `apps/frontend/src/app/sports-v2/pages/match-details.ts`
- `apps/frontend/src/app/sports-v2/ui/match-*.ts` (new components you create)
- `apps/frontend/src/app/sports-v2/**/*.spec.ts` for the files above only
- `docs/sports-v2/m05-contract/M05-C-NOTES.md`

Do NOT touch `apps/backend/**`, other pages, routing, SEO services or the design system primitives.

## Deliverables
### D1 Typed models (additive, backwards compatible)
Extend `models.ts` without breaking existing usages:
- `MatchStatus` already covers live/finished/scheduled/postponed. Add explicit `MatchPhase` (`scheduled|first_half|halftime|second_half|extra_time|penalties|finished`) and `injuryTime?: number`.
- `MatchEventType` widened: `goal | own_goal | penalty | penalty_missed | goal_disallowed | var | yellow | second_yellow | red | substitution | assist`.
  Each event: `minute`, optional `addedMinute`, `teamSlug`, `playerName?`, `assistName?`, `scoreAfter?: {home,away}`, `detail?`.
- `Lineup`: `formation?`, `coach?`, `starters[]`, `bench[]`, each player `{number?, name, position?}`.
- `MatchStat`: keep `{label, home, away}` but allow `unit?: '%'` and make ABSENT stats distinguishable from a real 0.
- Keep `revision`/`updatedAt` so the UI can tell "updated" from "stale".

### D2 Mapper (the core fix)
- `mapMatch` must carry real `events`, `stats`, `lineups`, `venue`, `referee`, `minute` from the API when present, and `undefined` when absent. Never default to `[]` for something the API did not send, and never coerce a missing number to 0.
- Map the backend's canonical event shapes robustly (accept `type` synonyms, ignore unknown types instead of crashing), sort by minute, dedupe identical `(type, minute, player)`.
- Disallowed goals / VAR: keep the event with its type so the UI can show it, and do not let it change the score.
- Unknown/absent `minute` for a live match: `undefined` (never compute from kickoff).

### D3 Availability model (`availability.ts`)
Pure helper that turns a fetch outcome into exactly one state:
`loading | fresh | stale | provider_unavailable | unavailable | competition_not_covered`.
Rules: an empty-but-successful array is `unavailable` only when the provider is approved but has no data for that field; a failed fetch is `provider_unavailable`; data older than a freshness threshold is `stale`; a competition with no approved provider is `competition_not_covered`. Unit-test every transition.

### D4 Match Center UI
- New components: `match-events-timeline`, `match-lineups`, `match-statistics`, `match-data-status`. Small, standalone, signal inputs, OnPush.
- Show the correct message per availability state (already existing Spanish copy style — read `pages/match-details.ts` first).
- NEVER render "0" for a statistic that is absent; render the unavailability message instead.
- Goals/cards/subs timeline with minute (and `+N` injury time), own goals, penalties, disallowed goals and VAR clearly distinguished.
- Lineups: starting XI, bench, formation, coach, substituted players marked.
- Statistics: only the rows the provider actually supplied, with a possession-style bar where both values exist.
- Accessibility: the timeline is an ordered list with meaningful text; live score changes are announced via an `aria-live="polite"` region that updates text without stealing focus. Keyboard and screen-reader usable.
- Do NOT break SSR: no `window`/`document` access at module scope, no `setInterval` in constructors; reuse the existing adaptive polling in the page component.
- Do NOT reorder unrelated components or reset scroll position when new data arrives (patch state in place; keep identity/keys stable).
- Keep broadcasts rendering exactly as today, independent from score/event data.

### D5 Tests (`*.spec.ts`, must pass under `npm run test -w apps/frontend`)
Mapper: events/stats/lineups preserved; absent stays undefined; unknown event type ignored; dedupe; ordering; disallowed goal does not alter score; no minute derived from kickoff.
Availability: every state transition (loading→fresh, fresh→stale, fetch error→provider_unavailable, empty competition→competition_not_covered).
Component: absent stats render the message and never a 0; events render in order with injury time; lineups render coach/formation.
## Shared rules (identical for every M05 worktree)
- FREE-FIRST, ZERO SPEND. No paid API, no signup, no subscription, no code path that can incur cost.
- NO FABRICATED DATA. A field the provider does not supply stays absent/undefined — never 0, never '', never a guess. Never derive a live minute from the kickoff time. Never show empty statistics as if they were zeros.
- No scraping of Google/Flashscore or any site whose reuse rights are unverified.
- Credentials: reference environment variable NAMES only; never read, print, log or commit a credential value.
- Do NOT add npm dependencies. Do NOT modify package.json, package-lock.json or tsconfig files.
- Do NOT touch production (`main`), do NOT run git write commands, do NOT access the network in tests.
- Preserve SSR, SEO metadata, existing routes, EPG reconciliation, caching and Sports V2 visual design. Public URLs never expose provider IDs.

## Verification you must run (from the worktree root)
Because the Angular test runner needs a browser, the ACL-confined exec allow-list cannot run it.
Build your changes and rely on the captain's unconfined run:
- `cd apps/frontend && npm run test` is executed by the captain after seal (Karma, ChromeHeadlessNoSandbox).
- You may run `node scripts/run-tsc.mjs`-equivalent only for the backend; for the frontend, ensure the code
  type-checks by inspection against the existing models and specs you update.
- `node scripts/test.mjs` exits 3 on purpose (`REFUSED`) inside confinement: that is not a test result.
- The frontend suite is currently 630/630 green. Do not add a spec that cannot pass; every existing spec must keep passing.
## Definition of done
D1-D5 complete; final report lists changed files, what each new state renders, and any capability the backend cannot supply yet (live minute, lineups, statistics from a free approved provider).
