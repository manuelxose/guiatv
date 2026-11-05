# M14 editorial recovery: initial evidence

Status: **incomplete; do not deploy as a recovery release**. Observation on 2026-11-05, approximately 02:02 UTC. Production was inspected read-only.

## Production baseline

- The API, SSR and MongoDB services were active. The deployed release directory was `20261105022104`; the artifact deployment workflow had succeeded. The Windows `GuiaTV\\EditorialCycle` task was disabled. Server cron invokes the API runner start every three hours; a missing process between cycles is expected.
- The API process supplies the runner with an Anthropic base URL pointing to a loopback gateway with no listener. Logs show repeated discovery connection failures. External network reachability does not establish that configured credentials work with the direct API. A durable provider configuration and a real provider test are still required.
- The MongoDB generation-request collection was empty. The discovered-topic snapshot held eight entries: seven rejected and one held, not eight pending. Six recent cycles were recorded as `no-eligible-topics` despite discovery errors. The latest policy approval ledger entry was 2026-10-28 10:40:24 UTC; this is not independent proof of the public page or sitemap.
- Generation was enabled, the schedule was three hours, one topic per cycle, and policy was not paused with limit 10. A three-hour cadence is structurally limited to eight cycle slots per 24 hours at one topic per cycle.

## Verified code defects and local corrections

- A discovery request was finished even when its claim failed, allowing one runner to complete another runner's request. The runner now finishes only requests it successfully claimed; a process test covers a competing claim.
- Manual backlog counts were derived from only the latest 50 records. Counts now query all queued and running requests. A MongoDB regression exercises more than 50 records.
- Discovery failures were represented as no eligible topics and a successful process exit. The runner changes report discovery errors; see the associated tests for the actual covered cases.

## Outstanding blockers

- Manual requests have no durable owner lease or publication fencing. Do not automatically requeue running requests until stale workers are prevented from completing or publishing and successful publication can be reconciled.
- Production MongoDB is standalone: `hello` reports no replica set, and a read inside a transaction failed with `IllegalOperation` (20). A transaction-based recovery design requires a separately validated topology migration. A lease check before publication alone cannot fence a worker whose lease expires before the post is saved.
- The local runner lock is not distributed and its age-based recovery may steal a live process's lock. PID existence is insufficient proof of ownership or health.
- The owner requires subscription OAuth, not API billing. An isolated Claude Code subscription login and a minimal text response succeeded without gateway credentials; this does not establish an equivalent editorial adapter, web-research controls, provenance, or unattended reliability. The existing pipeline uses the Messages SDK. No production provider configuration was changed.
- No end-to-end editorial publication, crash recovery, concurrent cap proof, deploy handover or sustained operating window has been verified. No production queues were purged or modified.
- Deploy only through the established artifact workflow after reviewing and validating a complete recovery design. Roll back using the existing release procedure in `RUNBOOK.md`; do not delete queue records as a rollback.

## Validation

- Editorial cycle process tests and the MongoDB-backed Admin regression were run locally; the latter used a disposable isolated MongoDB container.
- Frontend: 444 tests passed. Full backend: 873 passed, 5 failed, 46 skipped on Windows; failures include runner test cleanup permissions, GeoIP fixtures and owner-key file permissions. Full operations: 34 passed, 8 failed because Bash scripts received Windows paths. These full suites are not green and require production-compatible verification.
