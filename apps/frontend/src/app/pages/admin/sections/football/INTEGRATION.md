# Futbol admin group — integration note

This note is the exact wiring the captain needs to expose the new top-level
**Futbol** group. The shared integration files (`admin.component.ts`,
`admin.types.ts`, `admin-sidebar`, routes) are captain-owned and were **not**
edited here; the eight sections and the data facade below are ready to wire.

## What was delivered

- `features/football/admin-data/` — `FootballAdminDataService` + typed models and
  derivation helpers (nine-value coverage state, provider eligibility/rights,
  broadcast availability, capability matrix).
- `pages/admin/sections/football/` — `AdminFootballSectionComponent` (group shell)
  plus eight standalone section components:
  `centro-de-control`, `proveedores`, `cobertura`, `partidos`, `entidades`,
  `retransmisiones`, `sincronizacion`, `calidad`.

## Wiring required (captain-owned files)

1. **`admin.types.ts`** — add `'futbol'` to `AdminGroupId`.

2. **`admin.component.ts`** — add one nav group:

   ```ts
   {
     id: 'futbol',
     label: 'Futbol',
     icon: 'M3 21V3l9 5 9-5v18', // stroke-based SVG path (viewBox 0 0 24 24)
     items: [
       { id: 'centro-de-control', label: 'Centro de control', description: 'Salud del proveedor y resumen' },
       { id: 'proveedores', label: 'Proveedores', description: 'Estado del proveedor de datos' },
       { id: 'cobertura', label: 'Cobertura', description: 'Cobertura por competición' },
       { id: 'partidos', label: 'Partidos', description: 'Partidos e inspector' },
       { id: 'entidades', label: 'Entidades', description: 'Competiciones y equipos' },
       { id: 'retransmisiones', label: 'Retransmisiones', description: 'Canales y disponibilidad' },
       { id: 'sincronizacion', label: 'Sincronización', description: 'Trabajos y última sincronización' },
       { id: 'calidad', label: 'Calidad', description: 'Datos desactualizados y sin mapear' },
     ],
   },
   ```

3. **`admin.component.ts`** — import `AdminFootballSectionComponent` and render it:

   ```html
   <app-admin-football-section
     *ngIf="activeGroup === 'futbol'"
     [activeItem]="activeItem"
     (lastUpdatedChange)="onLastUpdated($event)"
   ></app-admin-football-section>
   ```

4. **`selectSection`** — include `'futbol'` in the `keepsUpdated` set so the header
   keeps the "last updated" timestamp.

5. Remove the old `{ id: 'football', label: 'Football operations', … }` item from
   the `operations` group once the Futbol group is live (the features were moved,
   not duplicated).

## Honest states (do not weaken these)

Coverage uses the full nine-value vocabulary (`available`, `partial`, `missing`,
`not-supported`, `not-covered`, `stale`, `temporarily-unavailable`,
`legally-blocked`, `not-yet-measured`), each with a distinct Spanish label.

- A competition with no approved provider renders **`Competicion sin cobertura`**
  (`not-covered`); it never renders `no hay partidos hoy`.
- An empty match list renders **`no hay partidos hoy`** (partidos section).
- A missing provider renders **`Proveedor no disponible`** (partidos) or
  **`No hay ningún proveedor aprobado`** (cobertura) — distinct from an empty list.
- A configured-but-legally-blocked provider renders **`Bloqueado legalmente`**
  (`legally-blocked`), never `available`: `hasApprovedProvider` requires BOTH
  `provider.configured` AND a non-blocked rights/eligibility verdict.
- An unmeasured eligibility renders **`Aún no medido`** (`not-yet-measured`) and
  can never read as `available`.
- `hasApprovedProvider` is derived (eligibility + a non-empty `providerIds`
  mapping); it is never hardcoded to `true`.
