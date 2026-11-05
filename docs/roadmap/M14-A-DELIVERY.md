# M14-A — Production AI gateway recovery

Status: **PASS for M14-A** (a production worker completes real model calls without the owner's PC).
Status of the dependent publication milestone (M14-G): **BLOCKED** — see §6.

Verified on 2026-11-05 between 14:02 and 16:03 UTC. Production release
`/var/www/guiatv/releases/20261105163903` (commit `e3239974`).

## 1. Incident and root cause (proven)

- Production `/etc/guiatv/api.env` had `ANTHROPIC_BASE_URL=http://127.0.0.1:20128` and a
  subscription gateway token. Nothing listened on `127.0.0.1:20128`
  (`ss -ltnp`; `curl` → connection refused).
- The old runner constructed `AnthropicEditorialModel` unconditionally, so the SDK used that
  token and URL. Every cycle failed with the generic `Connection error.`
  `spend/cycles.jsonl` records this at 08:11, 11:11 and 13:44 UTC; the runner log repeats
  `descubrimiento fallido: Connection error.`
- `DEEPSEEK_API_KEY` was already present on the server but no provider class existed.

## 2. Repair

Commits (main): `14baa03d`, `04e7db93`, `bfa7edcb`, `f1bfa4e5`, `6c5397fe`, `c7ab9dc8`,
`e3239974`.

- `DeepSeekEditorialModel` over DeepSeek's official Anthropic-compatible endpoint
  (`https://api.deepseek.com/anthropic`), server credential only.
- `authToken: null` prevents the stale gateway token from being sent as a second auth header.
- Research uses `web_search` only (DeepSeek rejects `web_fetch_20260209`); source pages are
  still fetched and verified by the pipeline's own deterministic `fetchSource`.
- Prompt-mode JSON for DeepSeek (`output_config.format` is unsupported), with fenced/bare
  JSON parsing and a local draft-shape check that retries with the missing fields.
- Hard bounds: 5-minute request timeout, 8 MiB stream cap, 2 server searches per research call,
  64k output, thinking disabled for the writer/SEO roles.
- Prices: `deepseek-flash` peak `$0.30/$1.20` per 1M tokens, `deepseek-v4-pro` peak
  `$1.32/$3.96` (official price page, 2026-11-05); search `$0.00075` per request.
  These are estimates (peak upper bound), never an invoice.
- Admin: `GET /v2/admin/editorial/providers` (read-only, 60 s cache) and a
  “Proveedores de modelos” panel in Operaciones IA → Configuración. It returns only
  environment-variable names, hosts, states and model ids.
- Production routes persisted in `editorial_settings.generation.routes`:
  research/evidence/critic = `deepseek-v4-pro`; editorial = `deepseek-v4-pro`;
  seo = `deepseek-flash`.

## 3. Verification evidence

- Provider health:
  `deepseek connected api.deepseek.com [deepseek-flash, deepseek-v4-pro]`;
  `anthropic unreachable 127.0.0.1:20128`; `openai not-configured`.
- Real adapter call on production, with the stale `ANTHROPIC_AUTH_TOKEN` still in the
  environment:
  `ADAPTER_OK {"verdict":"pass"} {"input_tokens":99,"output_tokens":36}`.
- Real discovery cycle (14:21–14:27 UTC): 8 topics proposed by `deepseek-v4-pro`,
  0 queued, 8 rejected by the deterministic source gate, cost `$0.076093`.
  This proves model execution, structured output and web search on the server.
- Queue recovery after a forced stop: `lock huérfano recuperado` and
  `interrumpido → queued` were observed, and the next cycle claimed the topic again.
- `npm run build` backend and frontend green; CI run `42056817905` deployed the final commit.
  Focused tests: DeepSeek adapter (4), provider health (2), pipeline/routing (36) green.

## 4. Dependency on the owner's PC

Removed. The runner uses `DEEPSEEK_API_KEY` from `/etc/guiatv/api.env`; the dead
`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL` values are inert and can be deleted.

## 5. Release / rollback

- Release: `/var/www/guiatv/releases/20261105163903` → commit `e3239974`.
- Env backup from the change: `/etc/guiatv/api.env.bak-m14a-20261105T135329Z`.
- Rollback: repoint `current` to the previous release and restart `guiatv-api`/`guiatv-ssr`;
  restore the env backup and `systemctl restart guiatv-api`. Do not delete queue records.

## 6. Remaining blockers (M14-B/M14-G)

1. **Writer output quality/latency on DeepSeek.** A full article cycle at 15:40 UTC streamed
   ~18 MB over 22 minutes without finishing and was stopped with SIGTERM. Earlier attempts
   failed with `answer truncated at max_tokens` and with valid JSON missing required draft
   fields. The validation/retry and 64k/non-thinking writer are deployed but no article has
   yet passed all gates.
2. **No job-level deadline or stage telemetry.** The 5-minute per-call timeout is not a
   per-article deadline; the UI cannot show which stage is spending 20 minutes. Needed:
   a persisted job/stage record, heartbeat, stage timeouts and a total-job deadline.
3. **Cancellation is not reconciled.** The API stops the runner with SIGTERM; the queue is
   recovered on the next cycle, but there is no durable lease/fencing and no provider-abort
   confirmation.
4. **Search Console returns no rows.** Last run `ok`, `inspected: 0`, `skipped: 14`,
   `pageRows: 0`, `queryRows: 0`. This is not evidence of deindexation; the skip/quota/data
   path needs diagnosis before M14-E can be called PASS.
5. **Secret hygiene incident.** During diagnosis, two production credential values were
   printed to this session's local tool output (not to the public site). Rotate
   `DEEPSEEK_API_KEY` and `EDITORIAL_POLICY_KEY` and update `/etc/guiatv/api.env`; never
   print values, only names.

## 7. Next concrete step

Do not retry the same 1,400-word article through the current unbounded loop. First add the
per-article deadline and stage ledger (M14-B), then run one short, source-verified topic with
`deepseek-flash` for research/evidence and a capped writer, and only then re-enable the
scheduled cycle.
