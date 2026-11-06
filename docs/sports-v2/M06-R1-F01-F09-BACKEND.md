# M06-R1 F01+F09 — Contrato backend (autorización + estados de disponibilidad)

Propietario: **admin-api** (equipo `m06-r1-recovery`, tarea `t1`).
Consumidor: implementador Angular del console admin (fuera de esta tarea).
Alcance backend: `apps/backend/src/application/sports/dto/FootballAdminDTO.ts`,
`apps/backend/src/application/sports/services/FootballAdminService.ts`,
`apps/backend/src/presentation/middlewares/adminAccessGuard.ts`,
`apps/backend/src/presentation/routes/{football,football-admin}.routes.ts` y `routes/index.ts`.

Los identificadores de campos, tipos y estados se escriben en inglés porque son
identificadores de código; la narrativa está en español.

---

## 1. Contrato de autorización (F01)

### 1.1 Una única frontera compartida

Hay **una sola** frontera de autorización admin:

- `createAdminAccessGuard(authService?)` — `apps/backend/src/presentation/middlewares/adminAccessGuard.ts`.

La usan **ambas** superficies:

- rutas legacy `/v2/admin/*` (ya la usaban; ahora con comparación en tiempo constante), y
- rutas nuevas `/v2/sports/football/admin/*` y los endpoints de override de broadcast
  (`POST|DELETE /v2/sports/football/broadcasts/override`).

Se eliminó el guard duplicado `analyticsAdminGuard` (que solo aceptaba la clave
compartida) para que no pueda volver a divergir el contrato.

### 1.2 Credenciales aceptadas (en este orden)

1. **Clave compartida `ANALYTICS_ADMIN_KEY`** — por cabecera `x-admin-key` **o** por
   `Authorization: Bearer <clave>`, comparada en **tiempo constante**
   (`timingSafeEqual`, M06/LOW-05). Un fallo de longitud o de contenido solo revela
   la longitud, nunca el contenido.
2. **Sesión autenticada con rol `admin`** — `Authorization: Bearer <JWT>`, validada por
   `authService.getSession(token)`; se admite solo si `user.role === 'admin'`.

Todo lo demás se rechaza. Si una cabecera `x-admin-key` incorrecta acompaña a un
`Bearer <JWT>` de admin válido, la sesión se verifica y se admite (la clave errónea no
bloquea una sesión válida).

### 1.3 Cierre a prueba de fallos (fail-closed)

- Sin `ANALYTICS_ADMIN_KEY` configurada **y** sin `Bearer` → `401 UnauthorizedError`
  (`Authorization token missing`).
- Con `Bearer` pero sin `authService` utilizable (`getSession` ausente) → `403 ForbiddenError`
  (`Admin authorization is not configured`). Nunca se admite una petición sin verificar.
- Sesión con rol distinto de `admin` → `403 ForbiddenError` (`Admin access required`).
- `getSession` que lanza (token inválido/expirado) → se propaga como `401`.

El guard es una fábrica inyectable: las rutas se pueden probar con un `authService` falso,
sin MongoDB vivo.

### 1.4 Archivos

| Archivo | Cambio |
|---|---|
| `presentation/middlewares/adminAccessGuard.ts` | frontera compartida (clave en tiempo constante O sesión admin) |
| `presentation/middlewares/analyticsAdminGuard.ts` | **eliminado** |
| `presentation/routes/football-admin.routes.ts` | usa `createAdminAccessGuard(authService)` |
| `presentation/routes/football.routes.ts` | usa `createAdminAccessGuard(authService)` en los overrides |
| `presentation/routes/index.ts` | inyecta `authService` en las dos fábricas football |

---

## 2. Estados de disponibilidad (F09)

### 2.1 Tipo

```ts
export type AvailabilityState =
  | 'observed'      // valor real medido; 0 es un cero real observado
  | 'empty'         // la lectura/ejecución tuvo éxito pero sin filas/registros
  | 'missing'       // el campo no existe en el modelo almacenado (no soportado)
  | 'unavailable'   // no se pudo medir: sin base de datos o proveedor inaccesible
  | 'not_covered'   // ningún proveedor elegible cubre esta competición/entidad
  | 'not_measured'  // la medición todavía no se ha realizado
  | 'stale';        // medido, pero más antiguo que el umbral de frescura
```

### 2.2 Regla de oro

Cuando el estado **no** es `observed` ni `empty`, el campo de valor asociado es
`null`/`undefined` — **nunca un cero fabricado**. Los campos numéricos que mantienen su
valor llevan un campo hermano `<campo>State` (forma pública no rota: el campo antiguo
se conserva y el estado se añade al lado).

### 2.3 Semántica de cada estado

| Estado | Significado | Ejemplo |
|---|---|---|
| `observed` | medición real de lo almacenado; 0 es un cero genuino | `snapshots: 1444`, `snapshotCount: 0` en una competición cubierta sin partidos |
| `empty` | lectura/ejecución con éxito y sin resultados | una ejecución de ingesta sin fixtures; `provider_supported_no_fixtures` |
| `missing` | el campo no está en el modelo almacenado | `consecutiveFailures` ausente del doc de provider |
| `unavailable` | no medible (sin DB / proveedor inaccesible) | `durableQuota` sin `mongoose.connection.db` |
| `not_covered` | sin proveedor elegible | `competition_not_covered` en la matriz de cobertura |
| `not_measured` | aún no medido | dashboard sin ninguna ejecución de ingesta (`lastSyncState`) |
| `stale` | medido pero fuera del umbral de frescura (6 h) | `lastSyncAt` más antiguo que el umbral |

---

## 3. Contrato por endpoint (campo · tipo · estados · semántica)

`GET /v2/sports/football/admin/dashboard`

| Campo | Tipo | Estados | Semántica |
|---|---|---|---|
| `competitions`, `teams`, `snapshots`, `providers`, `broadcastMappings`, `staleSnapshots`, `openQualityIssues` | `number` | implícito `observed` (agregado en `countsState`) | contadores reales de las colecciones almacenadas; 0 es un cero real |
| `countsState` | `AvailabilityState` | `observed` | todos los contadores comparten una lectura de DB; si la DB falla el endpoint devuelve error (nunca un cero falso) |
| `lastSyncAt` | `string?` | — | ISO del inicio de la última ejecución |
| `lastSyncOutcome` | `'success' \| 'partial' \| 'failed' \| 'skipped' \| 'empty'` | — | resultado de la última ejecución (`empty` es forward-compatible con F03) |
| `lastSyncState` | `AvailabilityState` | `not_measured` (sin ejecución) · `observed` (reciente) · `stale` (más de 6 h) | frescura del último sync |

`GET /v2/sports/football/admin/providers` y `/providers/:provider`

| Campo | Tipo | Estados | Semántica |
|---|---|---|---|
| `consecutiveFailures` | `number \| null` | `observed` · `missing` | fallos consecutivos reales, o `null` si el doc no los registra |
| `consecutiveFailuresState` | `AvailabilityState` | `observed` · `missing` | hermano de arriba |
| `quotaConsumedToday` | `number \| null` | `observed` · `missing` | cuota consumida hoy real, o `null` si ausente |
| `quotaConsumedTodayState` | `AvailabilityState` | `observed` · `missing` | hermano de arriba |
| `health` | `'ok' \| 'degraded' \| 'down'` | — | derivado de `consecutiveFailures` y `circuitState` |
| `lastRuns[].requestsUsed` | `number \| null` | `observed` · `missing` | peticiones de cada ejecución, o `null` si ausente |
| `lastRuns[].requestsUsedState` | `AvailabilityState` | `observed` · `missing` | hermano de arriba |

`GET /v2/sports/football/admin/coverage`

| Campo | Tipo | Estados | Semántica |
|---|---|---|---|
| `coverageState` | `'competition_not_covered' \| 'provider_supported' \| 'provider_supported_no_fixtures' \| 'provider_unavailable'` | — | soporte estático del proveedor (sin cambios) |
| `snapshotCount` | `number \| null` | — | snapshots observados almacenados, o `null` si no aplica |
| `snapshotCountState` | `AvailabilityState` | `not_covered` · `unavailable` · `empty` · `observed` | deriva de `coverageState` (tabla abajo) |

Correspondencia `coverageState → snapshotCountState`:

| `coverageState` | `snapshotCountState` | `snapshotCount` |
|---|---|---|
| `competition_not_covered` | `not_covered` | `null` |
| `provider_unavailable` | `unavailable` | `null` |
| `provider_supported_no_fixtures` | `empty` | `0` |
| `provider_supported` | `observed` | recuento real (0 incluido) |

`GET /v2/sports/football/admin/matches` y `/matches/:idOrSlug`

| Campo | Tipo | Estados | Semántica |
|---|---|---|---|
| `kickoffAt`, `status`, `homeTeam`, `awayTeam` | `string?` | `observed` · `missing` (hermano `*State`) | presentes si la snapshot los lleva; `undefined` si no |
| `score` | `{home: number \| null; away: number \| null}?` | — | puntuación |
| `scoreState` | `AvailabilityState` | `observed` · `missing` | `observed` solo si hay al menos un valor numérico (0-0 incluido); `missing` si no hay score |
| `kickoffState`, `statusState`, `homeTeamState`, `awayTeamState` | `AvailabilityState` | `observed` · `missing` | hermanos de los campos opcionales |

Nota: los recuentos de goles/eventos y las tablas de clasificación (`standings`) viven en
los tipos de dominio públicos (`domain/sports/football/types`, `FootballDTO.ts`), que son
propiedad de data-integrity y **no** se modifican aquí. Cuando el detalle admin los exponga,
deberán llevar el mismo patrón `<campo>State`.

`GET /v2/sports/football/admin/ingestion/status`

| Campo | Tipo | Estados | Semántica |
|---|---|---|---|
| `enabled` | `boolean` | — | flag (no es medición): `false` = ingesta deshabilitada |
| `quota.consumed` | `number \| null` | — | cuota consumida durable, o `null` |
| `quota.disabled` | `boolean \| null` | — | si la cuota está deshabilitada, o `null` |
| `quota.state` | `AvailabilityState` | `observed` · `unavailable` | `unavailable` cuando no hay `mongoose.connection.db`; nunca `consumed:0` falso |
| `lastRun.requestsUsed` | `number \| null` | `observed` · `missing` (hermano `requestsUsedState`) | peticiones de la última ejecución, o `null` |

Endpoints paginados (`matches`, `entity-mappings`, `broadcasts`, `quality-issues`, `audit`):
`total` es siempre un recuento real (`observed`, 0 = conjunto vacío genuino) cuando el
endpoint responde 200; `items: []` es un "éxito vacío". No se añaden campos `*State` a
`total` porque nunca se devuelve con un valor falso.

`GET /v2/sports/football/admin/diagnostics`: los campos `quotaRemaining`,
`quotaReserveRemaining`, `consecutiveFailures`, `fieldCoverage`, etc. los produce el
servicio de ingesta (`ingestion/types.ts`, `FootballDiagnosticsReport`) y son de
data-integrity; este contrato solo los re-documenta, no los re-tipa.

---

## 4. Reglas de consumo para el implementador Angular

1. **Nunca** renderices un número sin mirar su `<campo>State` (o el estado agregado).
2. `missing` / `unavailable` / `not_measured` / `not_covered` → UI de "no disponible /
   sin datos", **no** "0".
3. `empty` → "sin datos (éxito)".
4. `stale` → "datos desactualizados" (más de 6 h).
5. `observed` → muestra el valor tal cual (0 es un cero real).
6. Los campos `number | null` son `null` exactamente cuando el estado no es
   `observed`/`empty`.

---

## 5. Lo que NO cambia (formas públicas)

- `FootballDTO.ts` y `domain/sports/football/types` (formas públicas Sports V2) no se
  tocan.
- Los endpoints públicos `/v2/sports/football/*` (home, matches, competitions, teams,
  news, search) conservan su forma; solo sus dos overrides de broadcast pasan a usar la
  frontera admin compartida.
- Los campos numéricos antiguos del admin se conservan; el estado se añade al lado.

---

## 6. Paginación de entity-mappings (F08)

`GET /v2/sports/football/admin/entity-mappings` ahora pagina **en la base de datos**
(`$unionWith` + `$facet` + `$sort` + `$skip` + `$limit`): solo `limit` documentos salen
de Mongo, nunca las dos colecciones completas a memoria.

| Parámetro | Tipo | Valores permitidos | Por defecto |
|---|---|---|---|
| `page` | entero ≥ 1 | — | `1` |
| `limit` | entero 1..100 | se recorta a `MAX_PAGE_SIZE` (100) | `25` |
| `q` | texto ≤ 120 chars | búsqueda escapada (regex literal) sobre `name`/`slug` | — |
| `kind` | enum | `team` · `competition` (ausente = ambos) | ambos |
| `sort` | enum (allow-list) | `lastUpdatedAt` · `name` · `slug` | `lastUpdatedAt` |
| `order` | enum | `asc` · `desc` | `desc` |

Un `sort`/`order`/`kind`/`page` fuera de la allow-list se rechaza con `400
INVALID_PARAMS` **antes** de tocar la base de datos.

**Orden total determinista** (páginas estables): `<sort> <order>`, luego `slug` asc, luego
`_id` asc. Aunque dos entidades compartan el mismo valor de orden, el desempate por
`slug` + `_id` garantiza un orden total sin duplicados ni saltos entre páginas.

Índices añadidos (creados en el arranque vía `model.createIndexes()`, convención
`idx_football_*`):
- `football_teams`: `{ lastUpdatedAt: -1, slug: 1 }` → `idx_football_team_updated_slug`
- `football_competitions`: `{ lastUpdatedAt: -1, slug: 1 }` → `idx_football_competition_updated_slug`
