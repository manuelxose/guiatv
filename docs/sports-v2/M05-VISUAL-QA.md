# M05 — QA visual

- Escudos: `Team.crestUrl` (solo https, sin credenciales en URL) → `<img>` lazy con fallback a monograma si falta o falla (`team-identity.ts`; cubre todas las vistas que usan este componente).
- Logos: `Competition.logoUrl` → `Sv2CompetitionLogoComponent` con fallback a trofeo (tarjeta y cabecera de competición).
- **No realizado**: capturas 390/768/1440/1920, antes/después, medición de cobertura real de escudos, revisión CSP/`img-src` (no se halló configuración CSP en el repo), icon inventory, Match Center ampliado, Live Tracker/sidebar/búsqueda verificados individualmente.
