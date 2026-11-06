# M06-R1 — Revisión independiente R1 (re-review tras reparación) — revisor adversarial

- **SHA juzgado en esta re-revisión:** `4337361c0afd54c5208dc4f6f7d126cb8313b917` — rama `feat/m06-r1-recovery`
- **SHA de la revisión anterior:** `fe78c2f9` (rango de reparación a revisar: `git diff fe78c2f9..4337361c`)
- **Autor:** independent-reviewer (DeepSeek V4 Pro, familia distinta a los implementadores). No soy autor de los commits revisados.
- **Fecha:** 2026-11-06

> Re-revisión de código (no re-ejecución de suites). Los exit codes citados son los que el **capitán** ejecutó y registró; no los he re-ejecutado yo. Verifiqué cada reparación leyendo los bytes exactos del diff `fe78c2f9..4337361c`.

---

## 1. Alcance y qué verifiqué en esta re-revisión

Revisé el diff de reparación `fe78c2f9..4337361c` (13 ficheros; los de **código** son 7 y los de documentación/evidencia 6). Confirmé que el commit de código `4337361c` toca exactamente los ficheros esperados:

- `apps/backend/src/application/sports/ingestion/FootballIngestionService.ts` (+21) — R1-3
- `apps/backend/src/application/sports/services/FootballAdminService.ts` (+24) — R1-2, R1-6
- `apps/backend/src/application/sports/ingestion/M06R1ReviewFindings.test.ts` (+105) — regresión R1-3/R1-6
- `apps/frontend/src/app/features/football/admin-data/football-admin-data.service.ts` (+9) — R1-5
- `apps/frontend/src/app/features/football/admin-data/football-admin.models.ts` (+58) — R1-1
- `apps/frontend/src/app/pages/admin/sections/football/sincronizacion/admin-football-sync.component.{ts,html}` (+72/+26) — R1-1, R1-5
- `apps/frontend/src/app/sports-v2/shell/app-shell.html` (+6) — R1-4

No ejecuté el suite ni arranqué servidores; no modifiqué código de producto. Solo reescribo este fichero.

---

## 2. Veredicto por hallazgo R1-1…R1-6 (reparación)

| ID | Severidad | Estado tras reparación | Evidencia concreta verificada en el diff |
|---|---|---|---|
| **R1-1** | High | **CORREGIDO** | `football-admin.models.ts`: `FootballSyncStatus` ahora es la unión de 7 estados (`queued|running|succeeded|empty|skipped|throttled|failed`); `SYNC_STATUS_LABELS` con las 7 etiquetas; `SYNC_TERMINAL_STATUSES` + `isSyncTerminal()`; `FootballSyncResultDTO` replica el DTO del backend. `admin-football-sync.component.ts:155+`: `pollSync` usa `isSyncTerminal()` y emite un mensaje DISTINTO por estado (`succeeded`→"completada", `empty`→"no devolvió partidos", `skipped`→"omitida"+motivo, `throttled`→"limitada por cuota", `failed`→"falló"). El camino de etiqueta `undefined` desaparece (las 7 claves tienen etiqueta). |
| **R1-2** | Medium | **CORREGIDO** | `FootballAdminService.ts` `mapTickToOperation`: `skipped` y `throttled` devuelven `recordsFetched: null`; solo `empty` conserva el 0 medido. Evidencia viva `final-integration/r1-2-verified-not-zero.json`: fila nueva `{status:skipped, recordsFetched:null, recordsFetchedState:not_measured, skipReason:lock_held}` frente a fila antigua `{recordsFetched:0, observed}` — el contraste demuestra la corrección. |
| **R1-3** | Low | **CORREGIDO** | `FootballIngestionService.ts:341-361`: rama nueva — si `perCompetition.some(outcome==='failed')` es falso, se registra `empty` (nunca `failed`), no dispara el circuit breaker y no avanza `lastSuccessAt`. Test de regresión `M06R1ReviewFindings.test.ts` (R1-3) cubre empty+skipped sin fallo. |
| **R1-4** | Low | **CORREGIDO** | `app-shell.html:43-47`: la atribución ODbL queda dentro de `@if (!store.isDemo)`. |
| **R1-5** | Low | **CORREGIDO** | `football-admin-data.service.ts`: nuevo `getSyncOperations()`; `admin-football-sync.component.ts`: `loadHistory()` + tabla "Historial de sincronizaciones" con badge veraz, `recordsFetched` con su estado de disponibilidad, `skipReason`, y línea de error propia que no vacía la sección. |
| **R1-6** | Low | **CORREGIDO** | `FootballAdminService.ts`: nueva `providerHealth()` — `consecutiveFailures == null` → `unknown` (nunca `ok`), `circuitState==='open'` → `down`, `>0` → `degraded`, si no `ok`. Aplicada en `listProviders` y `providerDetail`. Test de regresión R1-6 (dependiente de Mongo) lo cubre. |

Los 6 hallazgos están **realmente corregidos en el código** del SHA `4337361c`. No confié en las afirmaciones del capitán: verifiqué el diff fichero a fichero.

---

## 3. Hallazgos residuales nuevos (todos Low, no bloqueantes)

| ID | Severidad | Fichero:línea | Problema | Corrección sugerida |
|---|---|---|---|---|
| **R1-7** | Low | `apps/backend/src/application/sports/services/FootballAdminService.ts:100-106` y `dto/FootballAdminDTO.ts` (`health: 'ok'|'degraded'|'down'`) | `providerHealth()` puede devolver `'unknown'`, pero el tipo DTO (backend y frontend) sigue declarando `health` como `'ok'|'degraded'|'down'`; el `as FootballProviderSummaryDTO['health']` esconde el valor fuera de la unión. El frontend lo tolera por los `default` de `healthLabel`/`healthStatus`, pero el contrato tipado quedó inexacto. | Ampliar la unión a `'ok'|'degraded'|'down'|'unknown'` en backend y frontend, y quitar el cast. |
| **R1-8** | Low | `apps/frontend/src/app/features/football/admin-data/football-admin.models.ts` (`finishedAt?: string`) vs backend `FootballAdminDTO.ts` (`completedAt?: string`) | El DTO frontend de la operación usa `finishedAt` pero el backend emite `completedAt`; el campo no se consume hoy (durmiente), y los campos `*State` frontend están tipados como `string` en vez de `AvailabilityState`. | Alinear el nombre a `completedAt` y tipar los campos de estado como `AvailabilityState`. |
| **R1-9** | Low | `apps/backend/src/application/sports/ingestion/FootballIngestionService.ts:316-319` (preexistente) | El caso "todas las competiciones omitidas por presupuesto" (`budgetRefused && requestsUsed===0`) sigue grabando el **run de ingesta** con `outcome:'failed'` y error `budget_exhausted`, mientras el tick devuelve `skipped` (la operación admin se muestra `throttled`). Discrepancia interna preexistente (run de ingesta vs operación admin); no la introdujo R1-3. | Grabar ese run con un outcome no-`failed` (p. ej. `skipped`) para no contarlo como "quality issue" en el dashboard. |
| *(nota)* | — | `FootballAdminService.ts` `toSyncOperationDTO` (`status: d.status` sin validar) | Un documento `football.sync` legacy con `status:'completed'` (el enum del modelo conserva `completed`) renderizaría `SYNC_STATUS_LABELS['completed'] === undefined` en el historial. En la práctica inalcanzable: el tipo `football.sync` nació ya con el esquema de 7 estados (t5), así que no existen filas `football.sync` con `completed`. | Opcional: filtrar/normalizar `completed`→`succeeded` al leer el historial, por robustez. |

Ninguno es bloqueante (todos Low y/o preexistentes); no cambian el veredicto de la reparación.

---

## 4. Veredicto por dimensión

| Dimensión | Veredicto | Razón |
|---|---|---|
| Engineering | **PASS** | Suite completa del backend 1152 tests / 1086 pass / 11 fail con **0 regresiones nuevas** (comparación por identidad de tests fallidos contra la línea base); backend build/tsc exit 0; 2/2 tests de regresión R1 nuevos. |
| Admin functionality | **PASS (código) / UNVERIFIED (navegador)** | R1-1 y R1-5 corregidos y verificados por lectura de código; los 8 endpoints ya estaban correctos. **Pero** R1-1 solo está probado por inspección de código + tests, NO por navegador real — la aceptación Playwright no se ejecutó. Lo declaro explícitamente, no lo marco como verificado. |
| Data honesty | **PASS** | R1-2 y R1-3 corregidos (skip→`not_measured`, empty+skip→`empty`); verificado por código + evidencia viva + test de regresión. |
| Data integrity | **PASS** | F04 intacto (identidad estable, reconciliación aditiva), sin cambios en la reparación. |
| Provider acquisition | **PASS** | F05 intacto (frontera de elegibilidad en el constructor). |
| Real ingestion | **PASS** (con nota) | Cobertura real previa (1444 snapshots, 7 competiciones) sigue vigente. La nota de muestra de 100 docs sobre disponibilidad por campo/líneas de gol sigue aplicando. |
| Security | **PASS** | F01 intacto (un solo límite fails-closed, tiempo constante). |
| Legal eligibility | **PASS** | F02 + R1-4 (la atribución ODbL ya no se muestra en datos demo). |
| Performance | **PASS** | F08 intacto; la reparación no añade consultas no acotadas (el historial usa `limit:10`). |
| Independent review | **Realizada** | Re-revisión adversarial a nivel de SHA, familia distinta. |
| Deployment readiness | **PARTIAL** | Código listo salvo 3 hallazgos Low; **Karma, SSR build y Playwright siguen SIN ejecutarse** y deben correr en un runner de CI limpio antes de fusionar. |
| Production verification | **UNVERIFIED (BLOCKED por entorno)** | Karma (`spawn EPERM`), SSR build de producción (`@angular/build`/builders) y aceptación Playwright no ejecutables en este sandbox (`M06-R1-VERIFICATION-ENVIRONMENT.md` §3). No pueden declararse PASS. |

---

## 5. Lo que NO pude verificar y por qué

1. **R1-1 en un navegador real:** la corrección está verificada por inspección de código y por el contrato de tipos, pero la aceptación Playwright (8 secciones en desktop/tablet/mobile, estados éxito/vacío/no-autorizado/error/no-disponible) **no se ejecutó**. La declaro UNVERIFIED, no PASS.
2. **Karma (`ng test`) y SSR build de producción Angular:** no ejecutables en este sandbox (documentado por el capitán). El re-run del typecheck frontend sigue degradado por un problema de `node_modules` (ACL) ajeno al código.
3. **La sesión JWT admin contra el API t7 en vivo:** sigue cubierta solo por tests unitarios del guard (la prueba viva usa `x-admin-key`). Brecha de evidencia, no defecto de código.
4. **Disponibilidad de líneas de gol reales por competición:** no documentada por competición en la evidencia final (solo score/kickoff sobre una muestra de 100 docs).
5. **F10 (auto-deploy en `main`):** decisión de proceso del propietario; no es defecto de código de este cambio.

---

## 6. Veredicto global

**`pass`** sobre el **código** del SHA `4337361c`: los hallazgos F01–F10 y R1-1…R1-6 están realmente corregidos (verificado leyendo los bytes exactos del diff y la evidencia/tests del capitán), y no queda ningún hallazgo bloqueante o de severidad alta/media. Quedan 3 hallazgos **Low** no bloqueantes (R1-7, R1-8, R1-9).

**Condición de entrega (NO la marco como cumplida aquí):** la aceptación en navegador real (Karma, SSR build, Playwright) sigue **sin ejecutarse** y la "verificación end-to-end en navegador real" del objetivo del milestone permanece **pendiente en un runner de CI limpio**. Eso es una puerta de verificación, no una revisión de código pendiente; no la subo a PASS.
