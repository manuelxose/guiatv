# ADR 0001: Editorial AI providers, image generation, and the Auctorio boundary

Status: accepted, 2026-10-27. Scope: M11-B and later. Supersedes nothing.

## Context

M11-B shipped an AI editorial pipeline (PRs #90, #91, M11-B 3/3). It has five roles: research, evidence, editorial, SEO and critic. Each role is a prompt on one injectable `EditorialModel`. Plain code decides everything that matters:
- quote verification,
- corroboration,
- every gate,
- the cost ledger,
- signing,
- CMS approval.

Two things are coming next. Auctorio (`workspace/auctorio`) is meant to become the content-production engine. GuíaTV must also not depend permanently on Anthropic.

Auctorio was read on 2026-10-27 at `d39fe01`. It has:
- a `/v1` API: `POST /v1/topics`, `/v1/topics/:id/facts`, `/v1/topics/:id/generate-text`, `/v1/topics/:id/generate-image`, and the matching `GET` results routes, with an `Idempotency-Key` header and a tenant `CostPolicy` (daily and monthly USD);
- BullMQ text and image workers;
- one text provider chosen by environment (`TEXT_PROVIDER`, an OpenAI-compatible chat API, or `mock`);
- one image provider (`IMAGE_PROVIDER`, an OpenAI-compatible images API with submit, poll and generate). Results carry `provider` and `model`, and bytes are checked against image signatures with a 25 MB cap.

Auctorio has **no** verbatim-quote evidence verification, no independent critic, no signed provenance and no per-role routing.

## Decision 1: Multi-provider model routing

**Contract.** `EditorialModel { provider; call(ModelCall) → { json, usage, searches } }`. A `ModelCall` carries:
- `role` and `provider`;
- `model` and `effort`;
- `system` and `prompt`;
- `schema`, a JSON schema the answer must match;
- `webSearches`, for research only.

Each provider gets one adapter, which translates this into its own API: structured output, web tools, usage counters.

**Routing.** `ROLE_MODELS` maps each role to `{provider, model, effort}`.
- An adapter refuses a call routed to another provider. A misroute fails loudly; it is never answered by whichever model happens to be wired.
- Requirements per role:

  | Role | Needs |
  |---|---|
  | research | server-side or tool-driven web search and fetch |
  | evidence, critic | strong reasoning plus schema-valid JSON |
  | editorial | strong Spanish prose |
  | SEO | anything cheap that returns schema-valid JSON |

- The critic should stay on a different model from the writer when a second provider exists. That makes the review more independent; today both run on Opus 5.5 in separate contexts.

**Provenance.** The recorded `backend` is the adapter's own `provider`, so it is no longer a default string. Policy approval accepts signed provenance only from providers in `LIVE_PROVIDERS`, meaning the providers the route table actually uses. `replay` and test models always need a named reviewer.

**Cost.**
- `CostLedger` prices every call from `MODEL_PRICES` and refuses any model without a price. A new provider therefore cannot run until its prices are entered.
- Per-article, daily and concurrency caps stay provider-independent.

**Fallbacks** (not implemented yet). The rules:
1. Choose the route once, at the start of a job. Never switch provider in the middle of a job: a refusal or truncation holds the job, as it does today.
2. A fallback route must meet the role's requirements. A research fallback without web retrieval is not a fallback; the job holds.
3. A fallback never lowers a gate. Evidence rules, critic pass, freshness and signing are code and do not depend on the provider.
4. The fallback used is recorded per call in the ledger and as `backend` in the provenance.

**Before writing any new adapter** (OpenAI, DeepSeek, Kimi, …), check against that provider's current API documentation and terms:
- structured-output support;
- web tools, or whether we must supply retrieval ourselves;
- usage reporting;
- prices;
- commercial API access, which is separate from a chat or CLI subscription.

Nothing here assumes those capabilities.

## Decision 2: AI image generation

The rule: **generate only when the image adds editorial value, and never depict something as real when it is not.**

**Allowed**
- Original illustrations and abstract covers.
- Comparison graphics drawn from the article's own verified table.
- Social crops.

**Never**
- Imitation movie or series posters, key art or logos.
- "Screenshots".
- Photo-real people or events presented as evidence.

Official artwork comes only from licensed sources that GuíaTV already uses, with their own rights metadata.

**Pipeline (contract)**: brief → prompt → provider → checks → derivatives → CMS asset.
- **Brief.** It derives from the approved article (title, verified claims, category) plus a house style preset. That keeps style consistent and leaves the prompt reviewable.
- **Provider.** Any `ImageModel` adapter. Auctorio's `ImageProvider` already has the right shape: `{submit, poll, generate}` returning `{bytes, provider, model, contentType}`. Providers without image support simply have no image adapter.
- **Checks** (code):
  - image byte signature and size cap;
  - dimensions match the requested aspect ratio (16:9 cover, 1:1 and 4:5 social, 1200×630 OG);
  - no text rendering for logos or brands in the prompt.
  - A human or critic-model look also rejects any trademarked or person likeness.
- **Asset record**:
  - `{assetId, purpose, prompt, provider, model, seed, createdAt, sha256, width, height, costUsd}`;
  - `rights`: `ai-generated, owned by GuíaTV, no third-party marks`;
  - `altText`, written from the article, never from the image model's own caption;
  - `reviewedBy`.
- **Delivery.** Store the original. Generate AVIF/WebP derivatives at fixed widths, served through the existing static/CDN path with `srcset`. Image cost goes into the same per-article ledger and caps.

## Decision 3: Local now, Auctorio later

GuíaTV keeps sole authority over:
- CMS writes;
- public URLs and slugs;
- canonicals, indexation and robots;
- approval, and policy publishing with its switch, daily cap and ledger.

Auctorio produces packages and never publishes to GuíaTV directly.

**Editorial job contract** (`guiatv.editorial-job/v1`), carried as JSON over a file or HTTP:

```ts
interface EditorialJobPackage {
  schema: 'guiatv.editorial-job/v1';
  jobId: string;
  idempotencyKey: string;                  // slug + UTC day today; Auctorio's Idempotency-Key later
  producer: { system: 'guiatv-local' | 'auctorio'; version: string; pipelineVersion: string };
  brief: EditorialTopic;                   // topic, intent, volatility, internal sources, seed URLs
  status: 'queued' | 'running' | 'blocked' | 'verified' | 'failed';
  failure?: { stage: string; message: string; retryable: boolean; attempts: number };
  evidence: EvidenceBundle;                // sources with retrieval times, verbatim quotes, claims with status
  draft: CmsDraft;                         // text, metadata, AI byline
  draftMarkdown: string;                   // with [[cN]] markers
  review: CriticReview;                    // independent review bound to bundle and draft hashes
  images: ImageAsset[];                    // Decision 2, may be empty
  cost: CostSummary;                       // per call: role, model, tokens, searches, USD (+ provider in v1)
  hashes: { bundle: string; draft: string };
  backend: string;                         // provider(s) that answered
  signature?: string;                      // HMAC by the producer; absent = named reviewer only
}
```

**Today.** The local adapter is `scripts/editorial-agents.mjs run`. Its `EditorialRun` file already holds the content of `brief`, `evidence`, `draft`, `review`, `cost`, `hashes`, `backend` and `signature` (inside `provenance`), so v1 is a re-shaping of it, not new data.

**Later: the Auctorio adapter.**
1. Submit the brief to Auctorio with the idempotency key.
2. Poll for the package.
3. Run `save-draft` exactly as today.

The receiving side does not change. `approve` and `approve-by-policy` re-run every gate on the stored package. Auctorio output therefore gets no shortcut: it publishes by policy only if Auctorio signs with a key GuíaTV trusts **and** its bundle passes the GuíaTV evidence gate. Until Auctorio verifies quotes and runs an independent critic, its packages are drafts for a named reviewer.

**Shared code.** No package is shared between the repos. The JSON schema is the boundary, versioned by its `schema` field.

## Decision 4: GuíaTV Admin responsibilities

The Admin (`/admin`, blog section) stays the only place where a person acts on editorial content. In order of priority:

1. **Queue and preview**: jobs by status, and rendered article previews with claim markers resolved to their sources. Validation failures are listed by gate code.
2. **Approve / reject / rollback**: buttons for the existing API endpoints. A named reviewer is required.
3. **Emergency stop**: today this is the `EDITORIAL_POLICY_PUBLISHING` environment variable (unset = off). Later it should be a DB flag the Admin can switch off instantly, without a deploy. Switching it off also stops scheduled jobs.
4. **Budgets**: per-article and daily USD, with spend so far taken from the ledgers.
5. **Provider and model selection** per role, only among adapters that exist and are priced.
6. **Scheduling, published history, maintenance**: the `maintain` due list and regeneration.
7. **Image previews** with rights and provenance metadata.

## Implemented now vs future contracts

| Component | State |
|---|---|
| Evidence contract, gates, agent pipeline, critic, cost ledger, signed provenance | **Implemented** (M11-B 1/3, 2/3) |
| CMS provenance, gated approval, policy approval (off), revisions, rollback, CLI | **Implemented** (M11-B 3/3) |
| Provider-neutral `EditorialModel` with `provider`; per-role routes; adapter refuses misroutes; `backend` taken from the adapter; policy accepts only routed live providers | **Implemented** (this ADR's PR) |
| Claude adapter behind that contract | **Implemented**. Not yet exercised against the live API: no key in the development environment |
| Fallback routing | Contract (Decision 1 rules) |
| OpenAI / DeepSeek / Kimi / other adapters | Future. Each needs verification of capabilities, prices and commercial access first |
| Image pipeline and `ImageAsset` | Contract (Decision 2) |
| `guiatv.editorial-job/v1` package and Auctorio adapter | Contract (Decision 3). Local runs already produce the equivalent data |
| Admin queue, preview, approve buttons, budgets, emergency-stop flag | Plan (Decision 4). Approval is API/CLI today |
| Autonomous production publishing | **Not activated.** Needs owner approval, `/politica-editorial` updated, and a live-model signed run |
