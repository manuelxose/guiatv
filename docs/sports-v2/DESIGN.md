# Sports v2: Design system

Original system. The Spotify reference was used for layout metaphor only (three rounded panels, left library, right context, bottom bar). No Spotify code, colour values, type or assets were copied; the accent is a pitch lime, not green.

## Principles

1. Football first: scores, status and time are the heaviest elements; chrome recedes.
2. Dense but calm: 4px grid, four surface layers, hairline borders, one soft shadow (drawers only).
3. Status is never colour alone: each status has a glyph and a Spanish label.
4. Quiet by default: the tracker and Match Center hide or collapse when unused.

## Tokens (`sports-v2/styles/_tokens.scss`)

| Group | Tokens |
|---|---|
| Surfaces | `--sv2-bg #0a0c0f`, `surface-1 #12151a`, `surface-2 #181c22`, `surface-3 #20252d` |
| Borders | `--sv2-border` 8% white, `--sv2-border-strong` 16% white |
| Text | `--sv2-text #f1f3f6`, `text-muted #a4adba`, `text-faint #7f8997` |
| Accent | `--sv2-accent #c6f25a`, ink `#11160a`, focus `#ffffff` |
| Status | live `#ff6b6b`, finished `#aab4c3`, scheduled `#6bb4ff`, postponed `#f6c453` |
| Type | Inter / system stack; xs .75, sm .8125, md .9375, lg 1.125, xl 1.5, score 2.25 rem |
| Space | 4, 8, 12, 16, 24, 32 px |
| Radius | 8, 12, 16 px; pills 999px |
| Motion | 160 ms `cubic-bezier(.2,0,0,1)`; disabled under `prefers-reduced-motion` |

Scores use `font-variant-numeric: tabular-nums` so digits do not jitter while live.

## Status semantics

| Status | Colour | Glyph | Label | Clock slot |
|---|---|---|---|---|
| LIVE | coral | ● (pulses, static if reduced motion) | En vivo | minute, e.g. `72'` |
| FINISHED | slate | ✓ | Finalizado | `FIN` |
| SCHEDULED | sky | ◷ | Programado | kickoff HH:mm (Madrid) |
| POSTPONED | amber | ⏸ | Aplazado | `Aplazado` |

## Layout

| Viewport | Layout |
|---|---|
| < 768 | Top bar, one column, bottom tab bar (5 destinations), tracker above tabs, Match Center full-width drawer |
| 768-1199 | Icon-only sidebar rail (72px), main, Match Center drawer opened from the top bar or by selecting a match |
| ≥ 1200 | Sidebar 264px (collapsible to 72px), main, Match Center 360px, tracker across the bottom |

## Components

`MatchCard` (selectable body + sibling track toggle, no nested interactives), `CompetitionCard`, `TeamIdentity` (monogram badge; real crests only when licensed), `ScoreDisplay`, `StatusIndicator`, `SectionHeader`, `EmptyState`, `ErrorState` (`role=alert`, retry), `LoadingSkeleton` (`role=status`), `ContextPanel` (tabs: Resumen, Estadísticas, Alineaciones, Dónde verlo), `LiveTrackerShell`.

## Accessibility (WCAG 2.2 AA target)

- Contrast on `surface-1`: text 15.8:1, muted 7.6:1, faint 5.0:1; accent ink on accent 14:1.
- Skip link, landmarks (`header`, `nav`, `aside`, `main`), `aria-current="page"` on active links.
- Every interactive control is ≥ 40px; icon-only controls carry `aria-label`.
- Visible 2px white focus ring everywhere; Escape closes the Match Center drawer.
- Match Center tabs follow the tablist pattern with arrow-key navigation.
- Closed drawer is `visibility: hidden` (not focusable).
- Reduced motion removes pulse, shimmer, drawer slide and hover transitions.

## Reference review (screenshots provided)

| Reference trait | Result |
|---|---|
| Three rounded panels, dark layered surfaces | Implemented |
| Left library with collapse | Implemented, "Mi fútbol" with followed teams and favourite competitions |
| Right context panel with hero + secondary cards | Implemented as Match Center |
| Bottom player bar | Replaced by Live Tracker, hidden until a match is tracked |
| Filter chips above main content | Implemented (Para ti, En vivo, Noticias) |
| Horizontal discovery rows | Implemented for live, upcoming and results |
| GuíaTV concept mock (score hero, stats bar, "Dónde verlo") | Implemented in Match Center |
