# M05 — Independent review record

Reviewer: AgentTeams member `qa`, route `openrouter / z-ai/glm-5.3-flash` — a different model
family from every implementer (`deepseek-official / deepseek-v4-pro`). The reviewer wrote none of
the code under review, verified fixes in the shipped bytes on `feat/sports-v2-m05-integration` at
`HEAD b8f00c8c`, was restricted to the read-only tool policy, and ran no commands (inspection-only,
as its contract permits).

Verdict: **PASS**, 12 findings all LOW, **no medium/high/blocker** open.

---

## 1. Dimensions reviewed (each with an explicit negative)

| Dimension | Outcome |
|---|---|
| Fabrication | No fabricated scores/minutes/zero-defaults. `minute` is provider-given and live-only, never derived from kickoff; `mapScore` is both-or-nothing; unknown status → `scheduled`; a real `0` stays `0`. |
| Legal / eligibility | Frozen registry, `assertEligible` is the sole admission gate, prototype unreachable via the orchestrator, no scraping, no adapter file for blocked providers. |
| Secrets | Environment-variable names only, no values or keyed URLs; diagnostics redaction verified. No leak found. |
| Correctness | Deterministic selector; dedupe `type|minute|player` ±1 min; TokenBucket; half-open probe limit 1; `Retry-After` wins and 401/403 are never retried; 10-bucket scheduler; budget denial → throttle; SingleFlight; MongoLock released in `finally`; idempotent upsert + unique index + contentHash. |
| Identity | 2 h / 72 h windows, name-only refusal, ambiguity quarantined, reschedule = MOVE with audit. |
| Regression | Interface changes additive; no `package.json`/`tsconfig` edits; legacy compatibility preserved. |
| Honesty | Last-good snapshots, `n/d` rendering, honest `requestsUsed`, demo disclaimer, "probable" vs confirmed distinct. |
| Scope | Worktree isolation respected; integration bytes only. |

## 2. The two attacks the reviewer was asked to run

1. **Fabrication:** traced adapter defaults → `FootballNormalizer` → mapper branches →
   scheduler/budget → frontend fallbacks. Outcome: the shipped code never fabricates.
2. **Unapproved-provider reachability:** traced route → orchestrator → adapter. Outcome: no
   reachable path; `assertEligible` is the only gate, the selector is deterministic, a prototype is
   constructible only directly in tests, and blocked providers have no adapter at all.

## 3. Findings and resolution

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | low | `@for track` used non-unique player/stat names → duplicate Angular keys | **FIXED** (`707178f4`) |
| F-2 | low | mapper dropped side-less events, hiding VAR/disallowed goals | **FIXED** (`707178f4`) |
| LOW-01 | low | dormant prototype placeholder defaults in `FootballDataOrgAdapter` — unreachable today, must be stripped before activation | open, accepted (documented; adapter stays `prototype`) |
| LOW-02 | low | OpenLigaDB wrote `''` for absent scorer/team id | **FIXED** (`f163cb21`) |
| LOW-03 | low | `conflictResolution` representative-provider provenance / `emptyMatch` fallback | open, documented |
| LOW-04 | low | silent skipped-goal counter missing | open |
| LOW-05 | low | admin guard uses `!==` rather than a constant-time compare; fail-closed order is correct | open, accepted (defence-in-depth) |
| LOW-06 | low | boot logs `String(error)`, flattening detail | open |
| LOW-07 | low | snapshot suffix order-dependent → possible canonicalKey/contentHash churn | open, documented, conflicts counted |
| LOW-08 | low | `availability` treats unknown `updatedAt` as `fresh` (lenient by design) | open, documented |
| LOW-09 | low | `match-details` hardcodes `hasApprovedProvider: true` | open, documented — this is why `competition_not_covered` is unreachable in the UI |
| LOW-10 | low | editorial kicker/author label hardcoding in the mapper | open |
| LOW-11 | low | CLI references an npm script that does not exist (`package.json` edits were out of scope) | open |
| LOW-12 | low | `FootballIngestionService.getSnapshot` is dead code | open |

## 4. Captain cross-check of the reviewer's conclusion

The captain did not accept the PASS on narrative alone and independently re-ran, on the integrated
branch: backend suite **1079/1027 pass** (4–5 pre-existing failures), frontend **662/662**,
`tsc --noEmit` exit 0, the sports-v2 isolation check, a diff scan proving **no** guard or redaction
line was removed in `presentation/**` or `config/**`, a secret-shaped-pattern scan across the new
code (clean), and a direct read of the eligibility path confirming `ProviderSelector` defaults to
`assertEligible`.

One correction to the reviewer's method is recorded for accuracy: its finding LOW-05 concerns a
defence-in-depth comparison, and its LOW-09 finding is the documented reason the
`competition_not_covered` state cannot yet be reached from the live page. Neither is presented as
fixed.

## 5. Known limits of this review

- The reviewer inspected rather than executed; all runtime numbers above are the **captain's**
  measurements, labelled as such everywhere.
- Reviewer and captain read the same repository and share the same blind spots a fresh clone would
  not fix; the strongest evidence remains the executed suites and the real provider probe.
- 12 LOW findings remain open. None blocks integration; all blocks release sign-off from being
  "complete" — the delivery verifies this explicitly.
