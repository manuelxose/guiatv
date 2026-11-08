# M05-A NOTES — provider core (worktree m05-a)

Implementation notes for the provider-core module. Authoritative requirements live in
`M05-A-CONTRACT.md`; this file records implementation decisions and the capability gaps.

## Design decisions

- **Capability contracts, not a monolith.** `provider-types.ts` defines
  `ProviderFixtureSource` / `ProviderLiveSource` / `ProviderEventSource` /
  `ProviderStandingSource` / `ProviderTeamSource` so an adapter implements only what
  its provider supplies. The existing `FootballDataProvider` (types.ts) is untouched:
  `FootballMatch` already carried optional `events`/`statistics`/`lineups`, so existing
  call sites keep compiling without any edit to `types.ts`.
- **Eligibility is a hard gate.** `assertEligible` throws for every non-approved entry.
  `openligadb` is the only approved external provider; `football-data-org` is a
  prototype (API-key gated, tier-restricted), and `google-search`/`flashscore` are
  blocked with no adapter. The `ProviderSelector` uses `assertEligible` first, so a
  prototype provider is unreachable through ordinary fallback.
- **Precedence, never last-wins.** Field resolution ranks candidates by capability tier,
  then `sourceTimestamp`, then confidence, then provider id (deterministic). Disagreements
  are recorded in `conflicts[]` and the chosen field is flagged `conflict: true`.
- **Reschedule vs duplicate.** `IdentityReconciler` clusters by competition + season +
  gender + teams, then by kickoff. A kickoff move within the reschedule window (72h) is a
  MOVE with `movedFromKickoffs`; a chain whose span exceeds the window is quarantined as
  ambiguous; two legs weeks apart stay separate.
- **No downgrade.** The orchestrator keeps the previous `EnrichedMatch[]` snapshot and
  merges new records against it, so a fixtures-only source never overwrites a rich
  live_score/results value that was already on the platform record.

## Capability gaps — capabilities no free approved provider currently supplies

With only `openligadb` approved:

- `live_score` and `live_minute` are not supplied (OpenLigaDB has no live minute field;
  live score only by polling goal events during a live match, not a dedicated live feed).
- `lineups`, `statistics` and `standings` are not supplied by OpenLigaDB.
- `referee` is not supplied by OpenLigaDB.
- Multi-competition coverage beyond German leagues (`bl1`/`bl2`/`bl3`) is not verified;
  Spanish/other leagues have no approved free provider yet.

These gaps mean the platform cannot yet show real-time minute-by-minute updates,
line-ups, advanced statistics, tables, or non-German-league fixtures from an approved
provider; those fields stay absent rather than being fabricated.

## Verification

- `node scripts/run-tsc.mjs` — backend `tsc --noEmit`, must exit 0.
- `node scripts/test.mjs` — exits 3 on purpose inside the ACL sandbox (REFUSED); unit
  tests are run by the captain unconfined after sealing.
