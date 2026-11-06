# M06-R1 — Informe de remediación y verificación

> **Estado global: NO es un PASS de producción.** La recuperación de ingeniería está hecha y verificada
> con ejecución real; tres puertas de verificación (Karma, build SSR de producción y aceptación en
> navegador real) **no pudieron ejecutarse** en este entorno y así se declaran. Ver §8 y
> `M06-R1-VERIFICATION-ENVIRONMENT.md`.

| Campo | Valor |
|---|---|
| Rama | `feat/m06-r1-recovery` |
| Base | `f020ea82` (HEAD de `feat/sports-v2-m06-integration`, el commit que revisó el revisor independiente) |
| HEAD final auditado | `fe78c2f92bbac5abfbf81b6f13ad857e0163e5f1` |
| Commits | 13 (`f020ea82..fe78c2f9`), 84 ficheros, +6812/−1579 |
| Fecha | 2026-11-06 |
| Merge a `main` | **NO realizado** (prohibido en la misión) |
| Despliegue | **NO realizado** |
| Revisor de implementación | capitán (DeepSeek v4-pro) + 3 miembros AgentTeams (`admin-api`, `admin-ui`, `data-integrity`) |
| Revisor independiente | `independent-reviewer` (rol separado, sin autoría del código) |

---

## 1. Tabla hallazgo por hallazgo

| Hallazgo | Severidad | Causa raíz | Corrección | Pruebas | Verificación independiente | Estado final |
|---|---|---|---|---|---|---|
| **F01** Admin cableado a endpoints obsoletos | **P0 Blocker** | El servicio Angular llamaba a `/v2/admin/football/*` (guard legacy con `x-admin-key` **o** JWT de admin) mientras la API `t7` nueva vive en `/v2/sports/football/admin/*` con un guard que sólo aceptaba la clave compartida. Resultado: el panel recibía 401/500 y nunca veía datos reales. | Cliente Angular único y tipado (`football-admin-data.service.ts`) sobre `t7`; las 8 secciones recableadas; **una sola frontera de autorización** (`createAdminAccessGuard`) compartida por ambas superficies que acepta clave compartida (comparación en tiempo constante) **o** sesión de admin, y falla cerrado si no hay ni una ni otra. `analyticsAdminGuard` eliminado. | 13/13 pruebas de auth y rutas; las 8 secciones ejercitadas contra servidor real: **10 endpoints `200` con datos reales**, sin credencial **401**, query inválida **400** | Revisión del código del guard por el capitán; ejecución real en vivo | **Corregido (backend y cableado). La aceptación en navegador real NO se ejecutó → no se declara PASS visual** |
| **F02** Atribución ODbL | **P0 Blocker legal** | No se capturó el texto exacto de atribución; no había aviso en las páginas públicas. | Aviso exacto de ODbL 4.3 con DATABASE NAME = OpenLigaDB y enlace a la licencia, en un `<footer role="contentinfo">` del shell que envuelve todas las rutas públicas; componente compartido + specs. | Specs de texto exacto/`contentinfo`/ambos `href`; typecheck app y spec exit 0 | Fuentes autoritativas: openligadb.de declara ODbL; texto de la licencia en opendatacommons.org §4.3 | **Corregido. Proveedor permanece habilitado (no se requiere desactivarlo). Nota legal residual en el documento** |
| **F03** Vacío contado como éxito | High | `anySuccess` se fijaba antes de la rama de vacío; además el esquema de run **no admitía `empty`**, así que un run todo-vacío se persistía como `partial`. | El run admite `empty`; un run todo-vacío persiste `empty`, **no avanza `lastSuccessAt`** y no reporta healthy; una mezcla es `partial`. | Pruebas adversariales del capitán: F03 básico pasa; **F03b/F03c fallaban en el HEAD original** y pasan ahora (49/49 en el subconjunto de ingesta) | Re-ejecutado por el capitán sobre el código integrado | **Reverificado y corregido del todo (incluido el residuo del esquema)** |
| **F04** Identidad de snapshot inestable | High | La identidad se derivaba del slug mutable y se desambiguaba con un `Set` local del lote → dependía del orden y composición del lote. | `canonicalKey = providerId:providerMatchId` (función pura del id externo estable). Slug = sólo presentación. Índice único `{providerId, matchId}`; upsert por esa pareja → reconciliación aditiva de registros legacy. | Pruebas del capitán (que **fallaban antes**): lote invertido, lote único vs múltiple; **E2E con Mongo real**: rename + reprogramación → **1 documento**; partido distinto → **2 documentos**; registro legacy reconcilia en su sitio y la URL pública sigue resolviendo | Ejecución real del capitán contra MongoDB 8.2.6 | **Corregido y verificado** |
| **F05** Bypass de elegibilidad | High | `assertEligible` sólo se ejecutaba dentro de la factoría y **después** de construir el cliente; cualquier otra construcción del adaptador lo evitaba. | Frontera única en el **constructor** de `OpenLigaDbClient`, antes de retener `fetch`: construir un cliente sin pasar la puerta es imposible. Assert redundante retirado de la factoría. | Pruebas de registro de elegibilidad + factoría; proveedor bloqueado no puede emitir petición ni escribir | Re-ejecutado sobre el código integrado | **Reverificado y reforzado** |
| **F06** Sincronización manual informa completado falso | High | `enqueueSync` marcaba el job `completed` independientemente del resultado del tick; la idempotencia era read-then-create. | Ciclo de vida explícito `queued/running/succeeded/empty/skipped/throttled/failed`; mapeo veraz por resultado; idempotencia atómica con índice único parcial; `recordsFetched` ahora es una **medición** (`matchesFetched`) y `null`/`not_measured` cuando no se midió; historial expuesto por `GET /ingestion/sync`. | Pruebas F06 nuevas; **evidencia en vivo**: tick omitido → `skipped` + `skipReason: lock_held` (no completado), tick real → `succeeded` + `recordsFetched: 1444`; misma clave → mismo id de operación | Ejecución real del capitán contra servidor + Mongo | **Corregido y verificado en vivo** |
| **F07** Cuota durable no fail-closed | High | El fallback a presupuesto proceso-local era silencioso si Mongo no estaba listo. | Falla cerrado si la autoridad durable no está disponible; sólo `FOOTBALL_DURABLE_QUOTA='0'` explícito activa modo local (documentado como mono-proceso); prueba de concurrencia con dos contendientes sobre el mismo store. | Pruebas F07; concurrencia contra Mongo real: nunca ambos ganan | Re-ejecutado sobre el código integrado | **Reverificado** |
| **F08** Consultas de entidades sin límite | Medium | `listEntityMappings` cargaba **ambas colecciones completas**, concatenaba, ordenaba en memoria y luego cortaba. | Paginación en la base (`$unionWith` + `$facet` + `$sort` + `$skip` + `$limit`), orden total determinista, lista blanca de campos de ordenación, validación de filtros, `limit` acotado, índices nuevos, regex escapada. | 6/6 pruebas con 5.050 entidades generadas en Mongo real | Ejecutado por el capitán; pipeline leído (sólo salen `limit` documentos) | **Corregido y verificado** |
| **F09** Dato no disponible mostrado como cero | Medium | Valores ausentes se convertían en `0` (`?? 0`, `{consumed:0}` sin base de datos). | `AvailabilityState` explícito (`observed/empty/missing/unavailable/not_covered/not_measured/stale`) con campos compañeros y valores `null`; los contadores, cuota, cobertura y detalle de partido lo usan; la UI no muestra número salvo `observed/empty`. | Pruebas de DTO/validadores + UI; en vivo la operación encolada devuelve `recordsFetched: null` con `not_measured` | Ejecutado por el capitán | **Corregido (backend y UI). La medición visual no se ejecutó** |
| **F10** El merge dispara despliegue automático | High (proceso) | `deploy-artifact.yml` despliega producción automáticamente cuando CI pasa en `main`. | **No se ha fusionado ni desplegado.** Se documenta la dependencia y el plan de rollback; la puerta de release separada es decisión del propietario (§9). | No aplica (proceso) | Inspección del workflow por el capitán | **Contenido por ausencia de merge. El riesgo de despliegue automático sigue existiendo en `main` y debe decidirse antes de fusionar** |

---

## 2. Lo que el capitán ejecutó realmente (no informes de terceros)

| Puerta | Comando | Resultado real |
|---|---|---|
| Typecheck backend | `tsc -p apps/backend/tsconfig.json --noEmit` | **exit 0** |
| Suite backend (sin Mongo) | `node scripts/m06-r1-run-backend-suite.mjs` | 1150 pruebas / **1084 pasan** / 11 fallan / 55 omitidas |
| Suite backend (con Mongo real) | ídem con `TEST_MONGO_URI=…27018` | 1230 / **1195 pasan** / 29 fallan / 6 omitidas |
| Baseline `f020ea82` con Mongo | mismo runner sobre el HEAD original | 1198 / 1163 pasan / **29 fallan** |
| **Diferencia de fallos** | comparación por identidad de nombre | **0 regresiones nuevas**, +32 pruebas, +32 pasan |
| Aislamiento Sports V2 | `check-sports-v2-isolation.mjs` | **exit 0** — 88 ficheros, 0 imports legacy |
| Lint frontend | `eslint src/**/*.ts src/**/*.html` | 6 errores, **todos en ficheros no tocados** por M06-R1; 0 errores en ficheros de M06-R1 |
| Typecheck frontend (app/spec/server) | `tsc -p …` | **exit 0** (antes del incidente de entorno de §8.3) |
| API en vivo + ciclo de sync | integración con servidor + MongoDB reales | 10 endpoints `200`, 401 sin credencial, 400 en query inválida, sync veraz, idempotencia efectiva |
| Cobertura real | `GET /matches` + `/coverage` | **UCL, UEL, UECL, Premier League, Bundesliga, Bundesliga 2, DFB-Pokal** con 1.444 snapshots |

**Aviso de honestidad:** la cifra declarada antes de esta recuperación ("1119 pruebas, 1069 pasando, un
fallo conocido de modo de archivo de Windows") **no era exacta**. La línea base medida en un build
limpio es **1118 ejecutadas / 1058 pasan / 11 fallan**, y los 11 fallos están todos fuera de fútbol
(sitemap, editorial, content-certify, content-canary). Detalle en `artifacts/m06-r1/evidence/BASELINE.md`.

## 3. Motivo por el que el revisor independiente no pudo probar nada

El entorno **deniega a un proceso hijo abrir un pipe** (`spawn EPERM`). `node --test` en su modo por
defecto crea un worker por fichero sobre un pipe, así que **todas** las pruebas abortaban al crear el
worker. Eso explica el "198 test-file launches, 0 passed" del informe original. Solución verificada por
el capitán: `--test-isolation=none` + reporter JUnit, envuelto en
`scripts/m06-r1-run-backend-suite.mjs`, con guarda de cero-pruebas y **sin relajar ninguna aserción**.

## 4. F02 — atribución implementada, texto exacto y base

Texto renderizado (verificado en el componente y en sus specs):

> Contiene información de **[OpenLigaDB](https://www.openligadb.de/)**, disponible aquí bajo la
> **[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/)**.

Base autoritativa: openligadb.de declara que los datos se ofrecen bajo ODbL; el texto de la licencia en
opendatacommons.org §4.3 da el aviso de ejemplo y exige que DATABASE NAME enlace a la base de datos y
que "Open Database License" enlace al texto de la licencia. Se aplica a **todas** las presentaciones
públicas de datos ingeridos (shell de Sports V2, incluido Match Center a pantalla completa). Compartir
igual (§4.4) **no** se activa mientras se publiquen "Produced Works", porque §4.5(b) lo excluye. Detalle
completo en `M06-R1-F02-ODBL-ATTRIBUTION.md`.

## 5. Cobertura real de fútbol (evidencia: `artifacts/m06-r1/evidence/final-integration/real-coverage.json`)

| Competición | Snapshots | Con marcador | Con kickoff |
|---|---:|---:|---:|
| Champions League | 144 | sí (muestra) | sí |
| Europa League | 144 | sí (muestra) | sí |
| Conference League | 108 | sí (muestra) | sí |
| Premier League | 380 | sí (muestra) | sí |
| Bundesliga | 306 | sí en la muestra del proveedor | sí |
| Bundesliga 2 | 306 | sí en la muestra del proveedor | sí |
| DFB-Pokal | 56 | — | sí |

Los conteos por competición que aparecen como "0 con marcador" en una página concreta corresponden a
partidos **aún no jugados** en esa página, no a un dato ausente: el estado se modela con
`AvailabilityState` en lugar de un cero. Sin datos fabricados: no se inventan minutos, alineaciones,
árbitros ni estadísticas.

## 6. Cuota y concurrencia (F07)

- Sólo `FOOTBALL_DURABLE_QUOTA='0'` **explícito** activa el modo local; sin definir, `'1'`, `'true'`,
  `'false'`, `''` o `'no'` solicitan autoridad durable y **fallan cerrado** sin Mongo.
- Prueba de concurrencia contra MongoDB real: dos trabajadores contendientes sobre el mismo store
  durable nunca ganan los dos — el número de concesiones es exactamente el presupuesto disponible.
- Implicación del modo local declarada: únicamente seguro con **un solo proceso**.

## 7. Git, PRs y dependencias de merge

- Rama lista para revisión: **`feat/m06-r1-recovery`** @ `fe78c2f9` (13 commits sobre `f020ea82`).
- **No se ha abierto PR todavía**: el encadenado de PRs no está resuelto. Verificado hoy: M06 **no** está
  integrado en `main` (`git merge-base --is-ancestor 05142eca origin/main` → distinto de 0) y los PRs
  abiertos son **#191** (`feat/sports-v2-m04-release` → `main`) y **#190** (`docs/m14-final-report`), así
  que M04 tampoco está en `main`.
- Orden de dependencias correcto para publicar: **(1)** M04 (#191) → `main`; **(2)** abrir PR de
  `feat/sports-v2-m05-integration` → base de M04; **(3)** abrir PR de `feat/m06-r1-recovery` → base de
  M05. **Ninguno debe fusionarse sin autorización explícita del propietario**, porque fusionar a `main`
  puede despliegue automático (F10).

## 8. Fallos conocidos y limitaciones (declarados, no ocultos)

1. **11 fallos preexistentes** sin Mongo y **26–29** con Mongo, idénticos en el HEAD original. Módulos:
   content-identity, sitemap, editorial, content-canary, content-certify. Nada de fútbol.
2. Dos de ellos son realmente del entorno (`spawnSync … EPERM`); el resto depende de un **replica set**
   (mi `mongod` local es *standalone*, `setName: null`, sin transacciones).
3. **NO ejecutados** en este entorno (y por tanto **no** declarados PASS):
   - **Karma**: no puede lanzar ChromeHeadless (`spawn EPERM`).
   - **Build SSR de producción**: `@angular/build` lanza esbuild por pipe → `spawn EPERM`.
   - **Aceptación en navegador real (Playwright, 3 viewports)**: depende del build anterior.
   - Tras un cambio de layout de dependencias durante la depuración, el typecheck del frontend quedó
     degradado en este worktree (`apps/frontend/node_modules` bloqueado por ACL); **el backend no está
     afectado** y el frontend typecheckeó limpio antes de ese cambio.

## 9. Plan de rollback

1. No hay nada desplegado: rollback de producción no aplica.
2. En la rama: `git revert <sha>` por commit (los cambios están separados por hallazgo, así que revertir
   F04 o F06 es independiente).
3. Migración de identidad F04: es **aditiva**. Para volver atrás no hay que borrar nada; los documentos
   legacy siguen resolviendo por `match.slug` y por `matchId`. El índice único `{providerId, matchId}`
   puede eliminarse sin pérdida de datos.
4. Si se fusiona y se necesita volver: `main` vuelve al commit anterior; el despliegue por artefacto
   redespliega ese commit (sigue el procedimiento existente del repositorio).

## 10. Veredictos (ver §11 para la revisión independiente)

| Dimensión | Veredicto | Motivo |
|---|---|---|
| Ingeniería | **PARTIAL** | Defectos F01–F09 corregidos y probados en backend; 3 puertas de frontend no ejecutables aquí |
| Funcionalidad del panel | **PARTIAL** | Cliente tipado correcto y endpoints verificados en vivo; **no** verificado en navegador real |
| Honestidad de datos | **PASS (backend)** | `empty`, `skipped`, `throttled`, `failed`, `not_measured` existen y se prueban; sin cero fabricado |
| Integridad de datos | **PASS** | Identidad pura por id de proveedor, probada contra Mongo real (rename/reprogramación/legacy) |
| Adquisición de proveedor | **PASS** | Frontera única en el constructor; proveedor bloqueado no puede llamar ni escribir |
| Ingesta real | **PASS** | 1.444 snapshots reales de 7 competiciones con timestamps reales |
| Seguridad | **PARTIAL** | Guard fail-closed y en tiempo constante, 401 genérico; el sandbox que impide `spawn` es una limitación del entorno (**ENGINE-04: SECURITY PARTIAL por diseño**) |
| Elegibilidad legal | **PASS (con nota)** | Atribución ODbL 4.3 implementada y documentada; nota de derechos sobre Contenidos para el propietario |
| Rendimiento | **PARTIAL** | Consultas acotadas e indexadas, pero sin medición de carga en navegador |
| Revisión independiente | pendiente | ver §11 |
| Preparación de despliegue | **BLOCKED** | Puertas de navegador no ejecutadas + despliegue automático al fusionar |
| Verificación en producción | **NO REALIZADA** | No se ha desplegado ni accedido a producción |

## 11. Revisión independiente

**Veredicto: `pass` sobre el código en `4337361c`** (re-revisión del intento de reparación 1 de 2).
Informe completo: `M06-R1-INDEPENDENT-REVIEW-R1.md`.

Historial honesto de la revisión, sin suavizar:

1. **Primera revisión → `needs_revision`.** Sobre `fe78c2f9` el revisor encontró **R1-1 (High,
   bloqueante)**: el backend exponía el ciclo veraz de siete estados, pero la sección Sincronización
   del frontend conservaba el vocabulario viejo (`completed`/`failed`), así que una sincronización
   **correcta** se mostraba como "en curso" con etiqueta `undefined`. **El hallazgo era correcto** y es
   exactamente lo que la aceptación en navegador (no ejecutada) habría detectado.
2. **Reparación** en `4337361c`: R1-1 a R1-6 corregidos (estados veraces en la UI, `skipped` sin cero
   fabricado, vacío+omitido sin etiqueta de fallo, atribución ODbL fuera de los datos de demostración,
   historial de operaciones expuesto, health nunca `ok` sin medir) + pruebas de regresión.
3. **Re-revisión → `pass`**, con tres residuos **Low no bloqueantes**.
4. **Segunda reparación** en `631ba623`: R1-7 (`unknown` dentro del tipo y renderizado, en las dos
   pantallas) y R1-8 (`completedAt` en vez de `finishedAt`) corregidos. **R1-9 se deja abierta** y
   declarada: es preexistente y no afecta a la operación admin (que sí informa `throttled`).

**Lo que el revisor NO elevó a PASS, y por qué:** Karma, build SSR y Playwright siguen sin ejecutarse, así
que *Production verification* y *Admin functionality (navegador)* quedan **UNVERIFIED**. R1-1 está probado
por inspección de código y pruebas, **no** en navegador real. El revisor lo dice explícitamente en su
informe, y este documento lo mantiene.

## 12. Residuos abiertos (declarados)

| Id | Severidad | Descripción | Estado |
|---|---|---|---|
| R1-9 | Low (preexistente) | Un run con **todas** las competiciones omitidas por presupuesto graba el *ingestion run* como `failed` mientras la operación admin informa `throttled` con veracidad. No afecta a la UI ni a `lastSuccessAt`. | **Abierto y declarado.** No se toca para no ampliar el alcance sin revisión. |
| — | — | Karma / SSR / Playwright no ejecutados en este entorno. | **Abierto.** Debe ejecutarse en un runner CI limpio antes de fusionar. |

## 13. Resultados de la suite tras cada reparación

| Momento | Pruebas | Pasan | Fallan | Regresiones nuevas |
|---|---:|---:|---:|---:|
| Base `f020ea82` (sin Mongo) | 1118 | 1058 | 11 | — |
| Tras F01–F09 (`fe78c2f9`, sin Mongo) | 1150 | 1084 | 11 | **0** |
| Tras R1-1..R1-6 (`4337361c`, sin Mongo) | 1152 | 1086 | 11 | **0** |
| Tras R1-7/R1-8 (`631ba623`, sin Mongo) | 1152 | 1086 | 11 | **0** |

Nota sobre la ejecución **con** Mongo: el runner in-process (`--test-isolation=none`) comparte una única
conexión de Mongoose entre ficheros, así que dos ficheros que se conectan/desconectan pueden interferir
y producir 2 fallos adicionales que **pasan en aislamiento** (verificado: `FootballAdminService.f06`
2/2 en solitario). Por eso la comparación de no-regresión se hace sobre el modo sin Mongo, que es
determinista y en el que ambas líneas base son comparables.

