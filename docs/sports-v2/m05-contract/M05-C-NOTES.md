# M05-C NOTES — Sports V2 Match Center (round 1)

Delivery notes for the Match Center work in worktree `m05-c` (branch `feat/m05-c-matchcenter`).
Companion to `M05-C-CONTRACT.md`.

## What changed

- `apps/frontend/src/app/sports-v2/domain/models.ts` — additive, backwards-compatible types:
  - `MatchPhase`, `injuryTime`, `venue`, `referee`, `phase` on `Match`.
  - Widened `MatchEventType` (`own_goal`, `penalty`, `penalty_missed`, `goal_disallowed`, `var`, `second_yellow`, `substitution`, `assist`; `sub` kept as a legacy alias for demo data).
  - `MatchEvent` now carries `addedMinute`, `teamSlug`, `playerName`, `assistName`, `scoreAfter`, `detail`.
  - `Lineup`/`LineupPlayer` with `formation?`, `coach?`, `starters?`, `bench?` (and legacy `players?`).
  - `MatchStat.home/away` are now optional so an absent value is `undefined`, never `0`.
  - `Match.events`/`Match.stats`/`Match.lineups` are optional and stay `undefined` when the provider sent nothing.
- `apps/frontend/src/app/sports-v2/data/football-mapper.ts` — the core fix:
  - `mapMatch` now carries `events`, `stats`, `lineups`, `venue`, `referee`, `minute`, `phase`, `injuryTime` when the API supplies them and `undefined` when it does not. The hardcoded `events: []` / `stats: []` is gone.
  - Events sort by minute (+stoppage), dedupe on `(type, minute, player)`, ignore unknown types, tolerate `type` synonyms, and never let a disallowed goal change the score.
  - Statistics accept an array of rows or a keyed object; a real `0` stays `0`, a missing side stays `undefined`.
  - Lineups map coach, formation, starters and bench from `home`/`away` (or `homeTeam`/`awayTeam`) shapes.
  - No live minute is ever derived from the kickoff timestamp.
- `apps/frontend/src/app/sports-v2/data/availability.ts` (+ spec) — pure, deterministic state machine.
- `apps/frontend/src/app/sports-v2/pages/match-details.ts` — tabs now delegate to the new components; broadcasts, context and related content are unchanged.
- `apps/frontend/src/app/sports-v2/ui/match-data-status.ts`, `match-events-timeline.ts`, `match-statistics.ts`, `match-lineups.ts` — new standalone, OnPush, signal-input components.
- `apps/frontend/src/app/sports-v2/ui/match-components.spec.ts` — new component specs.

## Availability states and what each renders

`resolveAvailability` returns exactly one of (fixed precedence):

| State | Meaning | Match Center rendering |
|---|---|---|
| `loading` | a fetch is in flight | `Cargando datos — Actualizando la información del partido.` |
| `fresh` | data present and inside the freshness window | the data itself; no status message. |
| `stale` | data present but older than `DEFAULT_STALE_AFTER_MS` (2 min) | the data plus `Datos desactualizados — No se han podido actualizar; se muestran los últimos datos recibidos.` |
| `provider_unavailable` | the fetch failed | `Proveedor no disponible — No se ha podido contactar con el proveedor de datos. Inténtalo de nuevo más tarde.` |
| `unavailable` | provider approved but no data for that field | `No hay <eventos/estadísticas/alineaciones> disponibles — El proveedor no ofrece … para este partido.` |
| `competition_not_covered` | no approved provider for the competition | `Competición sin cobertura — No hay un proveedor de datos aprobado para esta competición.` |

Scheduled/postponed matches keep their existing Spanish copy ("El partido aún no ha empezado", "Estadísticas aún no disponibles", "Alineaciones pendientes", "Partido aplazado") — those are status copy, not availability copy.

## New test cases

- Mapper (`football-mapper.spec.ts`): events/stats/lineups preserved; absent stays `undefined`; event type synonyms and unknown-type dropping; ordering and `(type, minute, player)` dedupe; disallowed goal does not alter score; stoppage time mapping; venue/referee presence and absence; phase derivation; no minute derived from kickoff; statistics absent vs a real 0; keyed statistics object; lineups coach/formation/starters/bench.
- Availability (`availability.spec.ts`): every state plus each transition (`loading→fresh`, `fresh→stale`, fetch error→`provider_unavailable`, empty competition→`unavailable`, retry→`fresh`, data arriving→`fresh`), unknown `updatedAt` counts as fresh, fixed precedence.
- Components (`match-components.spec.ts`): every availability state message; absent statistic renders `n/d` (never `0`) while a real `0` stays; events render in order with `+N` injury time and own/disallowed goals distinguished; lineups render coach/formation/starters/bench.

## What the backend cannot yet supply

- **Live minute / injury time**: only mapped when the BFF actually returns `minute`/`injuryTime`; the frontend never computes either from the kickoff. The free provider's live endpoint may not include them.
- **Statistics and lineups**: carried when `statistics`/`lineups` are present in the BFF response, but the current free provider tier is not guaranteed to include them.
- **Referee**: `ApiMatch.referee` is mapped but `FootballMatch` has no `referee` field yet, so it stays `undefined` until the backend adds it.
- **Per-competition provider coverage**: the frontend store exposes no signal for "this competition has an approved provider", so the Match Center currently resolves `hasApprovedProvider: true` for both the demo and live adapters. The `competition_not_covered` state is fully implemented and tested in the state machine but is not yet reachable from the live UI until that signal exists.
- **Substitution linkage**: lineup players are marked `substitutedOut` only when the provider reports it; no marking is invented.

## Constraints honoured

No npm dependencies, no `window`/`document` at module scope, no polling added outside the existing adaptive `LivePoller`, broadcasts untouched, existing routes/SEO/design preserved, and the global score-change announcement (`aria-live="polite"` in `app-shell.html`) is left as the single score announcer.
