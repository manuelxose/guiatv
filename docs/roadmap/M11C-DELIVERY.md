# M11-C delivery: AI editorial operations and controlled activation readiness

Status: **PASS (engineering)**, 2026-10-27. Automatic policy publishing remains **off**.

## Released
- PRs: #94 `4ebdf49` (backend: operations API, routing/fallback, daily USD ceiling, cover pipeline) and #95 `dad7c7c` (Admin "Operaciones IA", `/politica-editorial`, cover alt text). Both were squash-merged after an independent review and green CI.
- Deploy: `deploy-artifact.yml` run 40505813153. Live release **`20261027134338`**, `gitSha dad7c7c`, verified from `release.json`. All SSR warm-up routes returned 200. The previous release `20261027112406` (`bbaf491`) is the rollback target.
- Public checks: `/politica-editorial` returns 200, keeps the same canonical and serves the new text. Without credentials `/v2/admin/editorial/overview` returns 401.

## What exists now
| Area | State |
|---|---|
| Admin supervision | Policy state, caps, spend, routes, job list with hold reasons and costs, AI posts, and a detail view (preview, evidence, critic, findings, policy blockers, cover provenance, revisions). Emergency stop for any admin; resume needs the **human** review key. Audit collection `editorial_audit` |
| Providers | The Anthropic adapter is the only working one. Ordered routes and fallbacks are chosen once per job; OpenAI/DeepSeek/Kimi are planned only (capabilities, prices and terms not verified). No live API call was made in this milestone |
| Cost | Per-article cap, daily article cap, a **new** daily USD ceiling (`EDITORIAL_MAX_DAILY_USD`, default 10), and image cost in the same ledger |
| Images | Pipeline tested end to end with the **mock** provider only. The mock is blocked from publication on every path, and no real image provider is trusted (`LIVE_IMAGE_PROVIDERS` is empty). No live image generation was performed |
| Auctorio | Receiving surface and migration plan in ADR 0001. Auctorio is unchanged (`d39fe01`) and still has no quote verification or critic |
| Policy page | Describes AI writing, code-verified quotes, the independent AI review, today's named-person approval, and that automatic publication is off |

## Activation prerequisites (not done; each is an owner action)
1. Set `EDITORIAL_PIPELINE_SIGNING_KEY` in the runner environment, `EDITORIAL_REVIEW_KEY` on the server and in the runner, and `ANTHROPIC_API_KEY` in the runner only. Never put them in Git.
2. Make one live-model signed run: `node scripts/editorial-agents.mjs run topics.json --report <api> --confirm-production-write`. A named reviewer reads the Admin detail view and approves through `approve`, not by policy.
3. Update `/politica-editorial` (the "Está desactivada" paragraph) in the same release that turns publishing on.
4. Set `EDITORIAL_POLICY_PUBLISHING=enabled` and `EDITORIAL_POLICY_DAILY_LIMIT=1` for the first week, then restart the API. The Admin stop is available at once if anything looks wrong.
5. Run `publish` for at most one article per day. Check the Admin job list, spend and the public page after each one.

## Known limits
- The CLI writes `spend.jsonl` after the batch, so a crash mid-batch can under-count that day.
- Covers of unpublished drafts are public at unguessable content-addressed URLs.
- The cover URL scheme assumes the local storage adapter (`/storage`).
- The policy page text is static.
- On Windows, `content-certify` fails a POSIX file-mode test; it passes on Linux CI.
