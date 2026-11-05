# Sports v2: performance (M04)

All numbers are measured, with the scripts in `apps/frontend/scripts/` (`sv2-perf.mjs`, `sv2-cls.mjs`, `sv2-dom.mjs`, `sv2-m04-qa.mjs`). Chromium via Playwright, mobile profile (390x844, touch), CPU throttled 4x. **v2 runs against a local production build (`ssr-server.mjs`) with the real production API as backend; the legacy baseline runs on the live site over the internet.** Bytes, request counts, CLS and layout are comparable; TTFB and LCP are **not** comparable between the two columns (localhost vs network) and are shown only as raw values.

## 1. The defect found and fixed: full-page re-render after hydration

Before this milestone every Sports v2 page (and, measured the same way, the legacy pages on production) replaced the whole server-rendered DOM once the client booted.

- Cause: the root component picks its layout shell from the active route in its constructor. On the client the router had not finished the initial navigation yet, so it rendered the default `public-shell`, then swapped to the real layout after `NavigationEnd`. For Sports v2 (`minimal-shell`) that destroyed `app-sv2-app-shell` and created it again ~230 ms later (a `MutationObserver` log shows `added APP-SV2-APP-SHELL` / `removed APP-PUBLIC-LAYOUT-SHELL` at 682 ms).
- Effect: CLS 1.25 (desktop) / 1.0-2.0 (mobile, tablet) on every v2 route; the same two 0.625 shifts reproduce on the live `/`, `/programacion-tv/en-directo` and `/plataformas`.
- Fix (one line, `app.config.ts`): `provideRouter(routes, withEnabledBlockingInitialNavigation())`. The initial navigation completes before the root component is created, which is what the constructor's own comment already assumed. It is the documented setup for SSR + hydration.

| Page (desktop 1440, same build/API) | CLS before | CLS after |
|---|---|---|
| `/deportes/futbol/partidos` | 1.25 | 0.006 |
| `/` (legacy home) | 0.628 | 0.003 |
| `/programacion-tv/en-directo` | 0.626 | 0.001 |

After the fix, across 13 routes x 4 viewports (52 page loads, `evidence/m04/qa.json`): **CLS 0.000-0.018, max 0.018**. Lab numbers; no field (CrUX/RUM) data exists for the new pages.

Residual: the DOM log still shows the shell instance being created twice inside the same frame before first paint (no visible shift, CLS ~0). Not investigated further; it costs one extra component creation on load. Recorded as a non-blocking limitation.

This change is global (it also affects legacy pages). Legacy pages measured better after it (table above) and no test regressed (625/625); it should still be watched in the post-deploy smoke.

## 2. Page cost, mobile profile

| Page | HTML KB | JS KB (transfer) | CSS KB | Fonts KB | Images KB | Requests | API calls after SSR | LCP ms | CLS | Tap latency ms |
|---|---|---|---|---|---|---|---|---|---|---|
| **v2 home** | 133.8 | 341 | 44 | 48 | 0 | 56 | 0 | 652 | 0 | n/a |
| **v2 fixtures** | 122.9 | 339 | 44 | 48 | 0 | 56 | 0 | 332 | 0 | n/a |
| **v2 match** (tab tap) | 102.3 | 330 | 44 | 48 | 0 | 51 | 0 | 308 | 0 | 32 |
| **v2 standings** | 185.2 | 332 | 44 | 48 | 0 | 52 | 0 | 392 | 0 | n/a |
| legacy `/deportes/futbol/partidos-hoy` (live site) | 136.4 | 305 | 49 | 48 | 62 | 58 | 1 | 7892* | 0 | n/a |
| legacy `/deportes/futbol` (live site) | 194.4 | 326 | 49 | 48 | 272 | 85 | 1 | 740 | 0.033 | n/a |

\* one run over the network; not stable, not comparable. Do not read it as "v2 is 20x faster".

Reading: v2 ships ~5-10 % more JavaScript than the legacy football pages (330-341 vs 305-326 KB) and no images (monogram badges; crest licensing is unresolved), with the same fonts and 51-56 requests (legacy 58-85). Data is not refetched after SSR (transfer cache): **0 API calls on all four v2 pages**. "n/a" tap latency = no interaction was performed in that run. The 32 ms is the one interaction measured (a tab tap on 4x throttled CPU); this is one sample, not a p75 INP.

Initial bundle (`npm run build:ssr`, Angular budgets passed): 1.19 MB raw / 272.82 kB transferred, versus 273.81 kB before the cutover commit (legacy football is no longer routed). Sports v2 is route-level lazy: shell chunk 34 kB raw / 7.9 kB transferred, each page its own chunk.

## 3. Server

- SSR response, `ssr-server.mjs` with the SSR cache (5 runs, median): 8-16 ms TTFB, 102-185 KB HTML. The cold render was not re-measured in M04 (M03 recorded ~160 ms warm renderer).
- Provider outage: a SSR render whose fixtures load fails now answers **503 + Retry-After + noindex** (fixed in this milestone; it returned a 200 error shell before). The SSR server never caches it.
- API load: the poller is adaptive (30 s only while a match is live or within +-20 min of kickoff, 5 min when one is due within 3 h, stopped otherwise, paused when the tab is hidden, exponential backoff, stops after 5 failures). Measured in the browser: 1 poll in 31 s near kickoff, 0 polls in 120 s hidden, 4 extra calls in 30 min of continuous failure. The BFF already caches live responses 8 s fresh / 45 s stale and handles provider rate limits, so N open tabs cost at most one provider call per window.

## 4. Not optimised, with reason

- No JS-size reduction attempted: the v2 pages' cost is dominated by the shared Angular/framework chunks (the portal-wide initial bundle), not by v2 code. No evidence justified a change.
- No image work: v2 serves no images yet.
- Channel icons: the football pages request 5 `/storage/channel_icons/*.webp` at ~2.8 s from legacy app-level code (aborted/503 on my local server, which has no `/storage`; fine behind nginx on production). Not v2 code; left alone.
- INP/LCP in the field: not measured (no RUM, and the brief forbids adding frontend tracking).
