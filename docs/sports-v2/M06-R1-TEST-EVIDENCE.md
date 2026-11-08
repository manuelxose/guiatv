# M06-R1 — Evidencia de pruebas

Todas las cifras de este documento salen de **ejecuciones reales** con sus códigos de salida. Donde algo
no se pudo ejecutar, se dice. Los datos de máquina están en `artifacts/m06-r1/evidence/`.

## 1. Entorno de ejecución y por qué hacía falta arreglarlo

El revisor independiente no pudo ejecutar una sola prueba: `node --test` abortaba los 198 ficheros al
crear el worker con `spawn EPERM`. Causa medida por el capitán:

| Hecho medido | Evidencia |
|---|---|
| Un hijo con `stdio:'pipe'` falla con `EPERM` | `artifacts/m06-r1/evidence/baseline/spawn-matrix.json` |
| `node --test` por defecto lanza un worker por fichero sobre un pipe | 198/198 abortan |
| `--test-isolation=none` ejecuta todo en el proceso del runner | sin workers, sin pipes |
| El reporter `junit` sí escribe un fichero estructurado | recuentos parseados de `junit.xml` |

Solución: `scripts/m06-r1-run-backend-suite.mjs` (aislamiento `none`, reporter JUnit, **guarda de
cero-pruebas**, salida no cero ante cualquier fallo). **No se relaja ninguna aserción.**

## 2. Línea base y prueba de no-regresión

| Condición | Pruebas | Pasan | Fallan | Omitidas | Exit |
|---|---:|---:|---:|---:|---:|
| Baseline `f020ea82`, sin Mongo | 1118 | 1058 | 11 | 49 | 1 |
| Baseline `f020ea82`, **con Mongo** | 1198 | 1163 | 29 | 6 | 1 |
| **Final `fe78c2f9`, sin Mongo** | 1150 | **1084** | **11** | 55 | 1 |
| **Final `fe78c2f9`, con Mongo** | 1230 | **1195** | **29** | 6 | 1 |
| Diferencia por identidad de nombre | — | +32 | **0 nuevas** | — | — |

Conclusión: **0 regresiones nuevas**, 32 pruebas añadidas, 32 más pasando. Los mismos tests fallan
antes y después; los 11 (sin Mongo) y 26–29 (con Mongo) son de content-identity, sitemap, editorial,
content-canary y content-certify, todos ajenos a fútbol/deportes/admin.

## 3. Pruebas por hallazgo

| Hallazgo | Prueba ejecutada | Resultado |
|---|---|---|
| F01/F09 auth | `adminAccessGuard*`, `football-admin.routes*` | **13 / 13** |
| F02 | specs de `odbl-attribution` y `app-shell` (texto exacto, `contentinfo`, 2 `href`) | escritas; **Karma no ejecutable** aquí |
| F03 | `M06R1CaptainVerify` F03/F03b/F03c | **pasan** (F03b/F03c fallaban en el HEAD original) |
| F04 | `M06R1CaptainVerify` F04/F04b + `snapshots` + repositorio | **pasan** (F04/F04b fallaban antes) |
| F05 | `providerEligibilityRegistry*`, `factory*` | **pasan** |
| F06/F07 | `FootballAdminService.f06`, `FootballQuotaCoordination.f07` | **pasan** |
| F08 | `FootballAdminService.f08` (5.050 entidades reales) | **6 / 6** |
| Ingesta completa | subconjunto ingesta + repositorio + factoría | **49 / 49** |

Captura del fallo original (para contraste): `artifacts/m06-r1/evidence/captain-verify/f03-f04-at-review-head.log`
mostraba `an all-empty run must persist outcome "empty", got "partial"` y
`identity must not change because another fixture was in the batch`.

## 4. Pruebas de propiedad/integridad de identidad (F04) contra MongoDB real

Ejecutadas por el capitán con `mongod` 8.2.6 real en `127.0.0.1:27018`
(`artifacts/m06-r1/evidence/final-integration/f04-identity-e2e.json`):

| Escenario | Esperado | Obtenido |
|---|---|---|
| mismo partido: sync inicial + rename de equipo + reprogramación | 1 documento | **1** |
| partido distinto (mismos equipos, mismo día, id distinto) | 2 documentos | **2** |
| resolver por slug actual / por id de proveedor / por slug antiguo | los tres resuelven | **los tres** |
| registro **legacy** (canonicalKey = slug) + sync nuevo | colapsa en su sitio, sin duplicado | **1 documento, clave `openligadb:555`** |
| URL pública legacy antes y después de reconciliar | sigue resolviendo | **sí / sí** |

## 5. Integración en vivo (servidor real + MongoDB real)

Commit `fe78c2f9`, base `guiatv_m06r1_final`. Evidencia:
`artifacts/m06-r1/evidence/final-integration/admin-api-and-sync-lifecycle.json`.

| Endpoint | Sin credencial | Con credencial |
|---|---|---|
| `/v2/sports/football/admin/dashboard` | **401** | 200 |
| `/providers` · `/coverage` · `/matches` · `/entity-mappings` · `/broadcasts` · `/ingestion/status` · `/quality-issues` · `/audit` · `/diagnostics` | — | **200** (10/10) |
| `POST /ingestion/sync` | — | **202** `status: queued`, `recordsFetched: null`, `recordsFetchedState: not_measured` |
| misma `idempotencyKey` dos veces | — | **mismo `id` de operación** |
| `?limit=99999&sort=evil` | — | **400** |
| historial `GET /ingestion/sync` | — | `skipped` + `skipReason: lock_held` · `succeeded` + `recordsFetched: 1444` |

El caso `skipped/lock_held` es la prueba de F06: un tick omitido **ya no aparece como completado**, y un
tick real informa la medición verdadera.

## 6. Cobertura real de fútbol

`artifacts/m06-r1/evidence/final-integration/real-coverage.json` — 1.444 snapshots con timestamps reales
procedentes de OpenLigaDB, cubriendo **UCL, UEL, UECL, Premier League, Bundesliga, Bundesliga 2 y
DFB-Pokal**. No se han fabricado minutos, alineaciones, árbitros ni estadísticas.

## 7. Puertas que NO se ejecutaron (declaradas, no contabilizadas como éxito)

| Puerta | Estado | Causa exacta |
|---|---|---|
| Karma (Angular) | **NO EJECUTADA** | `spawn EPERM` al lanzar ChromeHeadless |
| Build SSR de producción | **NO EJECUTADO** | esbuild lanzado por pipe → `spawn EPERM`; después, `builders.json` ausente en el paquete instalado del checkout |
| Playwright (desktop/tablet/mobile) | **BLOQUEADO** | depende del build SSR anterior |
| Typecheck frontend (re-ejecución final) | **DEGRADADO** | `apps/frontend/node_modules` quedó bloqueado por ACL durante la depuración; el backend no está afectado y el frontend typecheckeó limpio antes |

Ninguna de estas cuatro puertas se declara PASS en ningún documento de entrega.
