# M05 — Captain defect log (transparency record)

Owner: M05 captain. Purpose: every defect the captain introduced during this milestone, the
evidence that exposed it, and the fix. This record exists because two of these failures looked
like *passing* results at first glance.

Environment: Windows 10 host, Node 24.18.0, repository `C:\Users\Admin\Documents\workspace\guiatv`.

---

## D-01 — Confined gate used a nonexistent command path `apps/backend/node_modules/npm`

- **Introduced:** commit `4c2f0654` (`scripts/test.mjs`).
- **Observed:** `exec node scripts/test.mjs` → `Cannot find module '...\node_modules\npm\bin\npm-cli.js'`.
- **Cause:** npm is not installed inside the repo tree; no `npm` package exists under `node_modules`.
- **Fix:** `f9cd3346` — call `tsc` directly and run `node --test` from `apps/backend`.
- **Quality of detection:** good — the command exited non-zero.

## D-02 — Confined gate reached into the wrong working directory

- **Introduced:** `f9cd3346`.
- **Observed:** `Cannot find module './test-setup.cjs'`.
- **Cause:** `spawnSync` inherited the repo root while the preload path is relative to `apps/backend`.
- **Fix:** `9ec33f31` — pass `cwd` explicitly.
- **Quality of detection:** good.

## D-03 — Gate target passed as an argument was refused by the allow-list

- **Introduced:** `9ec33f31`.
- **Observed:** `Error: command is not allow-listed: node scripts/test.mjs backend`.
- **Cause:** the confined tool matches the whole command against `/^node scripts\/test\.mjs$/u`;
  arguments are never accepted.
- **Fix:** `5be89c85` — select the target with the `M05_GATE_TARGET` environment variable.
- **Quality of detection:** good.

## D-04 — **FALSE RED**: the 968-test backend suite appeared to fail under confinement

- **Observed:** `ℹ tests 167 / pass 0 / fail 167`, every file `Error: spawn EPERM`.
- **Cause:** `node --test` spawns one child process per file; the sandbox's
  `WRITE_RESTRICTED` + Low-integrity token refuses those spawns.
- **Interpretation risk:** could have been reported as "the suite is broken". It is not.
- **Fix:** `3b2c1eff` / `7e794692` — confined semantics narrowed; the authoritative run is
  `npm test -w apps/backend` run **unconfined** by the captain, which yields 968 tests / 916 pass /
  5 pre-existing failures (see D-06).
- **Quality of detection:** good (loud failure, correct diagnosis).

## D-05 — **NEAR-FALSE GREEN**: in-process test loading would have reported success with 0 tests

- **Introduced:** `3b2c1eff` — attempted to run test files as repository tests
  (`node --test <file> ...`) to keep them in one process.
- **Observed:** unconfined, the command exited **0**. Under confinement it exited 1 with
  `Error: spawn EPERM` for each file.
- **Why it is a near-false green:** treating `dist/*.test.js` as repository test files means Node
  *loads* them as ordinary modules. The `test(...)` registrations never reach the runner, so the run
  reported nothing useful. Only the confined EPERM masked it. An exit code of 0 from a test command
  that executed zero test cases is not evidence.
- **Fix:** `882c9037` — the confined gate now **refuses** to run tests (exit 3,
  `REFUSED: unit tests are not executed here`) instead of returning a green. Gated stages are
  limited to build and typecheck, which the sandbox can measure honestly.
- **Quality of detection:** this one was caught only by cross-checking the confined and unconfined
  runs against each other. Recorded as the milestone's most dangerous defect.

## D-06 — Baseline failures are environmental, not milestones regressions

`npm test -w apps/backend` in a clean checkout (commit `4a4c9103`, before any M05 module existed):

| Count | Value |
|---|---|
| tests | 968 |
| pass | 916 |
| fail | 5 |

The five failures, all pre-existing and unrelated to football:

1. `dist/application/services/EditorialRunnerService.test.js` — `EPERM` deleting a temp directory.
2. `dist/infrastructure/analytics/analyticsGeo.test.js` (3 cases) — GeoIP fixture files absent.
3. `dist/scripts/content-certify.cli.test.js` — private-key file mode `54 !== 0` (Windows ACL mode).

Rule applied for this milestone: these five may remain the only failures. Any additional failure in
an M05 branch is a real regression.

## D-07 — `node --test dist/**/*.test.js` relies on shell glob expansion

- **Observed:** `scripts/suite.mjs` passed the literal glob when spawned without a shell, so the
  suite was pointed at a single nonexistent file.
- **Cause:** the npm script works only because `cmd.exe` expands the glob first.
- **Disposition:** the helper was removed (`882c9037`); the authoritative command remains
  `npm test -w apps/backend`, whose shell expansion is the behaviour CI already depends on.

---

## Lessons carried into the delegation

- A check that cannot execute must exit non-zero and say so; it must never exit 0.
- Confined and unconfined results are compared, not trusted individually.
- A test count of 0 with a zero exit code is treated as a failure, never a pass.
