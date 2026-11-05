# Sports v2: Architecture (M01)

## Constraints found in the repository

| Fact | Evidence |
|---|---|
| Angular 20.3 standalone, `@angular-devkit/build-angular:application` builder with SSR (`server.ts`, `ng build --configuration production --ssr`) | `apps/frontend/angular.json`, `package.json` |
| zone.js change detection, `provideClientHydration` with event replay | `app.config.ts` |
| Routes are an array in `app.routes.ts`; per-route `data.layout` selects a shell in `AppComponent`; `data.robots` is applied as a robots meta tag | `app.component.ts` (`resolveCurrentLayout`, `applyRobotsMeta`) |
| `layout: 'minimal-shell'` renders a bare `<router-outlet>` and hides the legacy mobile nav and chatbot | `app.component.html`, `shouldShowMobileNavigation` |
| Production football lives at `/deportes/futbol/**` (`features/football`) | `app.routes.ts` |
| Tailwind 3 exists but the legacy UI mixes it with SCSS; Karma + Jasmine for tests; ESLint 9 | `package.json` |
| Production SSR serves every non-listed route with `RenderMode.Server` | `app.routes.server.ts` |

## Decisions

1. **One folder, one route.** All new code is in `apps/frontend/src/app/sports-v2/`. The only edit to legacy files is one lazy route in `app.routes.ts` (`laboratorio/futbol`, noindex). `scripts/check-sports-v2-isolation.mjs` (`npm run check:sports-v2`) fails the build if sports-v2 imports anything but `@angular/*`, `rxjs` or itself, or if any legacy file references sports-v2 other than that route.
2. **Plain CSS custom properties, no Tailwind.** Tokens are declared on the shell host (`styles/_tokens.scss`) so nothing leaks to the legacy app. Tailwind was not justified: the legacy `tailwind.config.js` carries the old design tokens, which this rebuild must not inherit.
3. **Layers.** `domain/` (pure types and helpers) → `data/` (port `FootballData` + demo adapter) → `state/` (`SportsStore`, signals) → `ui/` (presentational, inputs/outputs only) → `shell/` and `pages/` (feature components). UI primitives never inject the store; `pages/match-grid` is the only bridge.
4. **Data port.** `FootballData` is an abstract class used as a DI token. M01 provides `DemoFootballData` (fictional fixtures, `data/demo-fixtures.ts`) at the route level. M02 swaps in an HTTP adapter against the existing public API without touching UI.
5. **Store scope.** `SportsStore` is provided on the lazy route, so state is created and destroyed with the shell. It is an app-level concern only for one browsing session in M01 (no persistence).
6. **Signals + OnPush everywhere.** Inputs use `input()`/`output()`; derived data uses `computed`. The one reused-component hazard (`/equipos/a` → `/equipos/b`) is handled by reading the route param as a signal.
7. **SSR.** No `window`/`document` access in sports-v2 code. Data loads in `ngOnInit` through a resolved promise, so server rendering waits for it and the page is hydrated with content.
8. **Responsive model.** Pure CSS grid; breakpoints at 768 and 1200 (see DESIGN.md). Match Center is a fixed drawer below 1200 and a grid column above; hidden drawer uses `visibility: hidden` so it is out of the tab order.

## Component inventory

Primitives (`ui/`): `Sv2IconComponent`, `Sv2StatusIndicatorComponent`, `Sv2TeamIdentityComponent`, `Sv2ScoreDisplayComponent`, `Sv2MatchCardComponent`, `Sv2CompetitionCardComponent`, `Sv2SectionHeaderComponent`, `Sv2EmptyStateComponent`, `Sv2ErrorStateComponent`, `Sv2LoadingSkeletonComponent`.

Shell (`shell/`): `Sv2AppShellComponent`, `Sv2TopNavigationComponent`, `Sv2SidebarNavigationComponent`, `Sv2ContextPanelComponent` (Match Center), `Sv2LiveTrackerShellComponent`.

Pages (`pages/`): `Sv2HomePageComponent`, `Sv2SectionPageComponent` (live, fixtures, results, competitions, news, following, competition, team, match), `Sv2MatchGridComponent`, `Sv2NewsListComponent`.

## Known limits (deliberate, tracked for later milestones)

- Demo data only; no network calls.
- Monogram badges instead of crests until image licensing is confirmed.
- Followed teams and favourites are in-memory defaults; persistence and auth wiring are M02+.
- News items are not links yet (no article route).
- The account button links to the legacy `/perfil`; there is no v2 account surface.
