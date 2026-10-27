# Branch protection for `main` (proposal, not applied)

State on 2026-10-22: no rulesets, no classic protection; the authenticated account has `admin` on the repository, so the owner can apply it. **Applying it needs the owner's explicit go.**

`docs/ops/main-ruleset.json` is a ruleset that: blocks deletion and force-push of `main`, requires a pull request (0 approvals: a single-owner repository cannot self-approve), requires the `verify` check. The bypass actor is the repository **Admin** role in `pull_request` mode, so an emergency fix still goes through a PR the admin can merge past a red check; nothing allows a direct push.

Apply (owner): `gh api -X POST repos/manuelxose/guiatv-frontend/rulesets --input docs/ops/main-ruleset.json`. Remove: `gh api -X DELETE repos/manuelxose/guiatv-frontend/rulesets/<id>`. Check first with `gh api repos/manuelxose/guiatv-frontend/rulesets`.

Why only `verify` is required: `ssr-resilience` (`seo-regression.yml`) is path-filtered (`apps/frontend/**`, `apps/backend/src/**`, `scripts/seo-*.mjs`). A required check that never runs on a docs-only PR stays "Expected" and blocks the merge (PR #53 had no `ssr-resilience` run). To require it too, first remove the `paths:` filter from `seo-regression.yml` (costs one ~5 min job per PR), then add `{ "context": "ssr-resilience" }`. Until then its result is checked by hand on PRs that trigger it.

Deployments are untouched: `deploy.yml` and `deploy-artifact.yml` stay `workflow_dispatch`-only; `scripts/workflows.test.mjs` fails CI if either gains a push, pull_request, schedule or workflow_run trigger, or if any other workflow uses the `DEPLOY_SSH_*` secrets.

`verify` is an aggregator (2026-10-27). `changes` decides whether code changed; `backend` (lint, tests with Mongo, deploy and ops tests) and `frontend` (lint, Karma, production build with budgets) run in parallel; `verify` is green only if both passed, or both were skipped because the change only touched `docs/`, `artifacts/` or `*.md`. It always reports, so the required context never stays "Expected". A newer push to a PR cancels the older PR run; runs on main are never cancelled.
