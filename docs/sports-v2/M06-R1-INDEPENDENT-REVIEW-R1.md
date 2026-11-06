# M06-R1 — Revisión independiente R1 (revisor adversarial, familia distinta a los implementadores)

- **Commit revisado (nombrado por el capitán):** `fe78c2f92bbac5abfbf81b6f13ad857e0163e5f1`
- **Worktree:** `C:\Users\Admin\Documents\workspace\guiatv\.m06-r1` — rama `feat/m06-r1-recovery`
- **Rango de cambios:** `git diff f020ea82..fe78c2f9` (84 ficheros, +6812/−1579)
- **Autor de la revisión:** independent-reviewer (DeepSeek V4 Pro). No soy autor de ninguno de los commits revisados.
- **Fecha:** 2026-11-06

> Este documento es una revisión de código, no una re-ejecución de suites. Los comandos y exit codes citados son los que el **capitán** ejecutó y dejó registrados; no los he vuelto a ejecutar yo.

---

## 1. Alcance y qué pude verificar

Leí el código exacto en el árbol de `fe78c2f9` (y lo comparé con la evidencia del capitán en `docs/sports-v2/` y `artifacts/m06-r1/evidence/`). No ejecuté el test suite, no arranqué/paré servidores y no modifiqué código de producto. Únicamente escribo este fichero.

Verifiqué por lectura directa:

- **Autorización (F01/F09):** `presentation/middlewares/adminAccessGuard.ts`, `presentation/routes/{admin,football,football-admin,analytics,blog,admin-*}.routes.ts`, y confirmé la eliminación de `analyticsAdminGuard` (0 referencias restantes).
- **Elegibilidad (F05):** `infrastructure/sports/providers/openLigaDb/OpenLigaDbClient.ts`, `eligibility/providerEligibilityRegistry.ts`, `jobs/football/factory.ts`, y busqué todos los `new OpenLigaDbClient` (solo en factory + tests).
- **Identidad (F04):** `application/sports/ingestion/snapshots.ts`, `OpenLigaDbAdapter.ts`, `persistence/FootballIngestionRepository.ts`, `persistence/models.ts`, `SnapshotFootballDataProvider.ts`.
- **Empty veraz (F03):** `application/sports/ingestion/FootballIngestionService.ts` (rama `onlyEmpty`), `ingestion/types.ts`.
- **Ciclo de vida (F06) y cuota durable (F07):** `database/models/AdminOperation.model.ts`, `application/sports/services/FootballAdminService.ts`, `presentation/controllers/FootballOpsController.ts`, `jobs/football/factory.ts`.
- **Consultas acotadas (F08):** `FootballAdminService.ts` (`listEntityMappings` con `$facet`), `dto/FootballAdminDTO.ts` (parsers), índices en `models.ts` / `FootballTeam.model.ts` / `FootballCompetition.model.ts`.
- **Frontend (F01/F09) y atribución (F02):** `features/football/admin-data/*`, las 8 secciones de `pages/admin/sections/football/*`, `sports-v2/ui/odbl-attribution.ts`, `sports-v2/shell/app-shell.{ts,html}`, `sports-v2/sports-v2.routes.ts`.
- **Evidencia del capitán:** `M06-R1-VERIFICATION-ENVIRONMENT.md`, `M06-R1-F01-ROOT-CAUSE.md`, `M06-R1-F02-ODBL-ATTRIBUTION.md`, y los JSON de `artifacts/m06-r1/evidence/final-integration/*` y `baseline/*`.

**Deriva de evidencia detectada (a registrar, no es defecto de código):** el capitán nombró `fe78c2f9`, pero el HEAD del worktree es `bedd6bd2` (un commit de documentación posterior: "finding-by-finding remediation report") y existe un fichero sin trackear `docs/sports-v2/M06-R1-TEST-EVIDENCE.md`. Todos los commits entre `fe78c2f9` y `bedd6bd2` son solo documentación, por lo que el **código** que revisé es idéntico al que ejecutó las suites en `f28c89ef`; aun así, la revisión quedó ligada al árbol `fe78c2f9` con un worktree sucio (fichero untracked), lo que debe anotarse para la puerta de entrega (ENGINE-04).

---

## 2. Tabla de hallazgos

### 2.1 Veredicto por hallazgo original F01–F10

| ID | Severidad original | ¿Corregido en el código? | Evidencia concreta (fichero:línea) |
|---|---|---|---|
| F01 | P0 | **Sí** | Un único `createAdminAccessGuard` (acepta `ANALYTICS_ADMIN_KEY` en `x-admin-key`/`Bearer` en tiempo constante **o** sesión admin JWT). Aplicado a `/v2/admin/*` (`admin.routes.ts:20-22` `router.use`), `/v2/sports/football/admin/*` (`football-admin.routes.ts:26`), broadcast overrides (`football.routes.ts:9,26,33`), analytics/blog/admin-* (`analytics.routes.ts`, `blog.routes.ts`, etc.). `analyticsAdminGuard` eliminado (0 referencias). El cliente Angular (`football-admin-data.service.ts`) llama al API t7 y envía `Bearer gtv_id_token`; la clave nunca va al bundle. |
| F02 | P1 | **Sí** | `odbl-attribution.ts` renderiza en `<footer role="contentinfo">` el texto exacto de ODbL 4.3(a) con anclas correctas: "OpenLigaDB" → `openligadb.de`; "Open Database License (ODbL)" → `opendatacommons.org/licenses/odbl/1-0/`. Montado en el shell (`app-shell.html:43`), que envuelve **todas** las rutas públicas (`sports-v2.routes.ts`). |
| F03 | P0 | **Sí** | `IngestionRunOutcome` admite `empty`; rama todo-vacío (`FootballIngestionService.ts:324-339`) persiste `empty`, no avanza `lastSuccessAt` y `health='degraded'`; mixto → `partial` y sí avanza (`:364`). |
| F04 | P0 | **Sí** | `canonicalKey = providerId:matchId` puro (`snapshots.ts:97-104`), nunca el slug; `match.id = String(matchID)` estable (`OpenLigaDbAdapter.ts:206`); upsert por `{providerId, matchId}` con reconciliación aditiva (`FootballIngestionRepository.ts:50-63`); índice único `idx_football_snapshot_provider_match` (`models.ts:90-93`). Evidencia E2E `f04-identity-e2e.json`: rename+reschedule→1 doc, distinto→2 docs, resuelve por slug actual/proveedor/slug viejo. |
| F05 | P0 | **Sí** | `assertEligible('openligadb')` en el constructor de `OpenLigaDbClient` **antes** de retener `fetchImpl` (`OpenLigaDbClient.ts:59-70`); el registro lanza para todo lo que no sea `approved`; no existe otra vía de construcción en producción. |
| F06 | P0 | **Parcial — defecto en frontend** | Backend correcto (estados veraces `queued|running|succeeded|empty|skipped|throttled|failed`, `AdminOperation.model.ts:11-19`; `mapTickToOperation` `FootballAdminService.ts:95-131`). El frontend NO fue actualizado al vocabulario nuevo: ver **R1-1**. |
| F07 | P0 | **Sí** | `factory.ts:109-116`: solo `FOOTBALL_DURABLE_QUOTA='0'` opta por modo local; cualquier otro valor pide durable y **lanza** si no hay Mongo listo (no hay downgrade silencioso). |
| F08 | P1 | **Sí** | `listEntityMappings` pagina en BD (`$unionWith`+`$facet`+`$sort`+`$skip`+`$limit`, `FootballAdminService.ts:288-333`); `sort`/`order`/`kind` con allow-list y 400 antes de tocar BD (`FootballAdminDTO.ts:106-141`); `limit` ≤100; `q` ≤120; regex escapada (`escapeRegex`); índices `idx_football_team_updated_slug` / `idx_football_competition_updated_slug`. Las demás listas ya paginan en servidor. |
| F09 | P0 | **Sí (backend y UI), salvo R1-2** | `AvailabilityState` explícito + campos `<field>State` en DTOs; `durableQuota()` sin BD devuelve `{consumed:null, disabled:null, state:'unavailable'}` (`FootballAdminService.ts:81-93`); UI renderiza "No disponible" salvo estado `observed` (p. ej. `admin-football-matches.component.ts:154-192`, `admin-football-providers.component.ts:115-118`). |
| F10 | High (proceso) | **Contenido por ausencia de merge** | `deploy-artifact.yml` sigue desplegando en `main` tras CI. No se ha fusionado ni desplegado (objetivo del milestone). El riesgo persiste y queda como decisión del propietario antes de fusionar (`M06-R1-REMEDIATION.md:35`). **No es un defecto de código del cambio; es una puerta de release pendiente.** |

### 2.2 Hallazgos nuevos de esta revisión (R1-*)

| ID | Severidad | Fichero:línea | Problema | Corrección requerida y verificación |
|---|---|---|---|---|
| **R1-1** | **High** | `apps/frontend/src/app/features/football/admin-data/football-admin.models.ts:264` y `apps/frontend/src/app/pages/admin/sections/football/sincronizacion/admin-football-sync.component.ts:133,137` | El frontend conserva el vocabulario **legacy** `FootballSyncStatus = 'queued'|'running'|'completed'|'failed'` (4 estados), mientras el backend expone 7 (`succeeded|empty|skipped|throttled` incluidos, sin `completed`). `SYNC_STATUS_LABELS` (models.ts:272-277) no tiene etiquetas para los 4 estados nuevos; `FootballSyncResultDTO` (models.ts:266-270) solo declara `{id,status,correlationId}` (pierde `outcome`, `recordsFetched*`, `skipReason`, `quotaOutcome`). `pollSync` solo trata `completed`/`failed` como terminales. **Consecuencia:** una sincronización exitosa llega con `status:'succeeded'`, no coincide con `completed`, sondea 8×2.5s y acaba mostrando "Operación X sigue **undefined**. Revisa el estado más adelante." — el resultado veraz jamás se muestra y una operación correcta se presenta como "en curso". Es exactamente lo que la aceptación en navegador (no ejecutada) habría detectado. | Alinear `FootballSyncStatus`/`SYNC_STATUS_LABELS`/`FootballSyncResultDTO` con el DTO del backend (`FootballAdminDTO.ts:359-399`) y hacer que `pollSync` trate `succeeded|empty|skipped|throttled|failed` como terminales con mensajes correctos. Verificación: test unitario del componente con `status:'succeeded'` (debe mostrar "completada", no "en curso"), y aceptación en navegador real de la sección Sincronización. |
| **R1-2** | **Medium** | `apps/backend/src/application/sports/services/FootballAdminService.ts:125-129` y `:533-534` | `mapTickToOperation` fija `recordsFetched: 0` para `skipped` y `throttled`; `toSyncOperationDTO` lo etiqueta `observed` porque `0` es número. Un run omitido (lock_held / circuit_open / emergency_disabled) **no midió** registros. Confirmado en la evidencia viva: `admin-api-and-sync-lifecycle.json` `syncHistory[0] = {status:"skipped", recordsFetched:0, skipReason:"lock_held"}`. Es el anti-patrón "no-disponible-como-cero" que F09 quiere eliminar. | Para `skipped`/`throttled` devolver `recordsFetched: null` (estado `not_measured`); reservar `0+observed` solo para `empty` (cero medido). Verificación: test unitario de `mapTickToOperation` + DTO que compruebe `recordsFetchedState === 'not_measured'` en skip. |
| **R1-3** | **Low** | `apps/backend/src/application/sports/ingestion/FootballIngestionService.ts:315-341` | Un run mixto "empty + skipped(presupuesto)" (sin fallo de proveedor) cae en la rama `failed` con razón `'no competitions ingested'` (`:341`), etiquetando como "fallo" algo que no tuvo error de fetch. No avanza `lastSuccessAt` (correcto), pero la etiqueta es imprecisa. | Distinguir "empty parcial + skipped" de "failed" (p. ej. `partial` sin éxito, o un outcome propio). Verificación: test con una competición `empty` y otra `skipped` esperando un outcome no-`failed` cuando no hubo error de proveedor. |
| **R1-4** | **Low** | `apps/frontend/src/app/sports-v2/shell/app-shell.html:10-12` vs `:43` | Cuando `store.isDemo` es true se muestra un banner "Datos de demostración… ficticios", pero la atribución ODbL ("Contiene información de OpenLigaDB") sigue renderizándose — una afirmación falsa para datos ficticios. | Condicionar la atribución a `!store.isDemo`, o aceptar el texto como boilerplate y documentarlo. Verificación: página demo no debe mostrar la atribución ODbL. |
| **R1-5** | **Low** | `football-admin-data.service.ts` (sin método) vs `football-admin.routes.ts:42` | El backend expone `GET /ingestion/sync` (modelo de lectura de historial F06) pero ningún componente/servicio frontend lo consume. El historial de operaciones veraces queda sin superficie en la UI. | Añadir `getSyncOperations()` al cliente y mostrarlo en la sección Sincronización (o declarar explícitamente que no se expone). Verificación: la sección muestra el historial con estados veraces. |
| **R1-6** | **Low** | `apps/backend/src/application/sports/services/FootballAdminService.ts:183,200` | `health` se deriva con `d.consecutiveFailures > 0 ? 'degraded' : … : 'ok'`; un documento con `consecutiveFailures` ausente (null) se reporta `health:'ok'` aunque el dato no esté medido. Solo alcanzable con documentos legacy/malformados. | Derivar `health` teniendo en cuenta `consecutiveFailuresState === 'missing'` (p. ej. `unknown`/`degraded`), no `ok`. Verificación: test con doc sin `consecutiveFailures`. |

---

## 3. Veredicto por dimensión

| Dimensión | Veredicto | Razón |
|---|---|---|
| Engineering | **PASS** | Backend `tsc --noEmit` exit 0; suite sin Mongo 1150/1084/11/55 y con Mongo 1230/1195/29/6, idéntica a la línea base (0 regresiones nuevas; los 11/29 fallos preexistentes están fuera de fútbol: CatalogService, ContentCanary, EditorialRunner, ClaudeCode, Sitemap, content-certify). F08 acotado con índices. |
| Admin functionality | **PARTIAL** | Backend correcto y probado en vivo (200 con datos reales, 401 sin credencial). Pero **R1-1** rompe la sección Sincronización en la UI (el estado veraz de F06 no se muestra) y **R1-5** deja el historial sin consumir. Además, la aceptación en navegador real **no se ejecutó**. |
| Data honesty | **PARTIAL** | F03/F06/F09 correctos en backend salvo **R1-2** (skip→`recordsFetched:0` observado en vez de `not_measured`) y **R1-3** (empty+skip etiquetado `failed`). |
| Data integrity | **PASS** | F04: identidad pura `providerId:matchId`, reconciliación aditiva sin borrado, índice único, E2E real verificado. |
| Provider acquisition | **PASS** | F05: frontera única de elegibilidad en el constructor, fails-closed; único proveedor `approved`. |
| Real ingestion | **PASS** (con nota) | 1444 snapshots reales de OpenLigaDB cubriendo UCL(144), UEL(144), UECL(108), PL(380), BL(306), BL2(306), DFB(56). **Nota:** la disponibilidad por campo y por competición en `real-coverage.json` es una **muestra de 100 docs** (`pageSample:100`), no una cobertura por competición; la disponibilidad de líneas de gol por competición no está documentada en la evidencia final (el adapter sí mapea `goals` y el registro declara capacidad `events`, pero el artefacto R1 no lo demuestra por competición). |
| Security | **PASS** | F01: un solo límite de autorización, `timingSafeEqual` (longitud comprobada primero), fails-closed sin clave ni authService, rol `admin` exigido, sin bypass encontrado. La ambigüedad `Bearer` (misma cabecera para clave y sesión) es por diseño y documentada; no es un bypass. Nota: la sesión JWT se probó por unidad (no en vivo contra t7; la prueba viva usó `x-admin-key`). |
| Legal eligibility | **PASS** | F02: texto ODbL 4.3(a) exacto con anclas e hiperenlaces correctos, en todas las páginas públicas; F05 con notas legales y `rightsState` por proveedor; doc F02 cita fuentes autoritativas y declara honestamente "no es asesoramiento legal". |
| Performance | **PASS** | F08: paginación en BD, allow-lists, `limit` capado, regex escapada, índices nombrados; sin scans no acotados en el dashboard. |
| Independent review | **Realizada** | Revisión adversarial de código a nivel de SHA, familia de modelo distinta de los implementadores. |
| Deployment readiness | **PARTIAL** | **R1-1** (High) abierto, SSR build/Karma/browser **no ejecutados**, y deriva de evidencia (HEAD `bedd6bd2` vs `fe78c2f9` + fichero untracked). No se fusiona/despliega (correcto), pero no está listo para entrega sin resolver R1-1 y cerrar las puertas no ejecutadas. |
| Production verification | **UNVERIFIED (FAIL en la puerta)** | Karma (`ng test`), SSR build de producción y aceptación Playwright **no se pudieron ejecutar** (`spawn EPERM` / builders ausentes; `M06-R1-VERIFICATION-ENVIRONMENT.md:34-46`). No pueden declararse PASS. R1-1 es la prueba de que esta ausencia importa. |

**Veredicto global: `needs_revision`.** El backend F01–F09 queda sustancialmente bien corregido y verificado, pero **R1-1 (High)** —la superficie de administración no muestra el ciclo de vida veraz de F06— y las puertas de frontend no ejecutadas impiden dar el milestone por entregable.

---

## 4. Lo que NO pude verificar y por qué

1. **Aceptación en navegador real (Playwright) en desktop/tablet/mobile:** no ejecutada en este entorno (depende del SSR build, bloqueado por `spawn EPERM` y builders ausentes). No la he re-ejecutado yo (mi rol es leer y juzgar, no re-ejecutar suites). Por eso "Admin functionality" y "Production verification" no pueden ser PASS.
2. **Karma (`ng test`) y SSR build de producción Angular:** registrados como NO EJECUTADOS por el capitán. El typecheck/lint frontend sí pasaron antes del incidente de `node_modules` (§3 del doc de verificación), pero el re-run post-incidente está degradado (34 TS2307 por `@angular/forms` no resoluble).
3. **Sesión JWT de administrador contra el API t7 en vivo:** la prueba de integración viva usó `x-admin-key`; el camino de sesión quedó cubierto por tests unitarios del guard, no por una prueba E2E en vivo. Lo anoto como brecha de evidencia, no como fallo de código.
4. **Disponibilidad de líneas de gol reales por competición:** no documentada en `final-integration/real-coverage.json` (solo score/kickoff sobre una muestra de 100). El adapter y el registro de elegibilidad la declaran, pero no hay artefacto R1 que la demuestre por competición.
5. **F10 (auto-deploy en `main`):** es una decisión de proceso del propietario, fuera del alcance de esta revisión de código; queda abierta y documentada.
6. **6 de las 8 secciones frontend** (cobertura, entidades, retransmisiones, calidad, y los detalles de sus HTML) las revisé por el patrón compartido del cliente tipado y los helpers de estado; verifiqué en profundidad Sincronización y Centro de control y Partidos/Proveedores. El defecto R1-1 está en Sincronización, que sí revisé a fondo.
