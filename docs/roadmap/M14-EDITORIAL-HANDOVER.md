# M14 editorial handover: design blocked pending exclusive ownership

Status: **not safe to deploy as an autonomous handover**. This describes the required implementation; it does not claim that migration or recovery is in place.

The runner's default `--out` is relative to its working directory. In production that directory is the active release, which changes on deployment and can be pruned. `EDITORIAL_SPEND_DIR` holds the runner lock, queue and spend journal but does not set `--out`. A release switch can therefore make published-run evidence invisible to maintenance, and later pruning can delete it. The current production configuration has no explicit `--out`. Six JSON files were observed in a separate historical pilot directory; their identity and relation to published drafts have not been established, so they must not be merged automatically.

## Required handover

1. Establish one authoritative runner owner and one durable state directory shared by every eligible execution path. Verify the Windows task remains disabled and account for the server cron, the Admin start control, in-flight child processes and any other hosts. A lock on one filesystem does not protect a runner using another.
2. Stop new starts and obtain a durable, ownership-checked exclusive barrier before any deployment, release pruning or evidence copy. Wait for in-flight work to terminate or reach a safe checkpoint. Refuse the handover if ownership or quiescence cannot be proven.
3. Inventory existing run files and media in each retained release, the checkout and documented historical locations. Preserve files in place during migration; map each published draft to its exact provenance and draft hash. Treat unknown, malformed, symlinked and conflicting paths as explicit blockers, not as empty data.
4. Copy verified evidence into a directory outside releases. Publish each copy atomically on the destination filesystem, never overwrite different existing bytes, verify hashes and durability, and retain the source until the complete manifest has been checked. Interrupted copies must be safely retryable and never appear as complete evidence.
5. Set the runner output to that durable directory, restart under the same barrier, verify that maintenance finds old published drafts and that new runs are recorded there, then release the barrier. Only after verified handover may release pruning resume. Keep the prior release and source evidence available for rollback.

The current `run.lock` is not this barrier: a lock older than six hours is treated as stale even if its PID is alive, and process exit unlinks by path without verifying that it still owns that lock. A replacement must handle interrupted lock creation, process death, PID reuse, ownership fencing and multiple contenders. It must not permit an old owner to delete a newer owner's lock. The deploy and every worker entrypoint must use the same verified protocol; a helper or a PID check alone is insufficient.

## Required verification before activation

- Two simultaneous runners and a deploy cannot both own the barrier; a live owner remains protected beyond the old timeout.
- Kill a worker or migrator at each lock and copy boundary; the next attempt either safely resumes or fails with an actionable reason, without deleting or presenting partial evidence.
- Test PID reuse, malformed and orphaned locks, ownership changes, stale cleanup and a non-cooperating runner on another host.
- Exercise different files with the same name, identical duplicates, symlinks, missing files, permissions errors, full disk and interrupted writes. Check original bytes and destination hashes after each failure.
- Run a deployment simulation with an active runner and aggressive release retention. Verify the release cannot switch or prune until the barrier is held, and verify published provenance is readable before and after switch and rollback.
- Test actual service configuration and multiple unattended production cycles before declaring recovery. Do not count a green build, a live PID or a successful cron invocation as proof of progress.
