# M14-R7 · Verificación backend (T4) — control de preexistentes

Verificador: `verifier`. Rama verificada: `verify/m14r7` @ `dbfa1f70` (base `21dbfe42` + contratos T1).
Control: base `21dbfe42` en worktree `guiatv-m14r6-fixes` (misma ejecución de test, dist ya compilado).

## Comandos ejecutados (evidencia real)

| Ejecución | Comando | tests | pass | fail | skipped | exit |
|---|---|---|---|---|---|---|
| Árbol m14r7 (r1, antes de maxmind) | `npm run test -w apps/backend` (build + test) | 1052 | 998 | 6 | 48 | 1 |
| Árbol m14r7 (r2, tras maxmind en node_modules principal) | `node --require ./test-setup.cjs --test "dist/**/*.test.js"` | 1052 | 1002 | 2 | 48 | 1 |
| Base 21dbfe42 (control) | `node --require ./test-setup.cjs --test "dist/**/*.test.js"` | 987 | 937 | 2 | 48 | 1 |

Logs: `backend-test-m14r7.log` (r1), `backend-test-m14r7-r2.log` (r2) y `backend-test-base-21dbfe42.log`.

## Clasificación de los 6 fallos del árbol (r1) — resueltos 4, quedan 2 preexistentes

| # | Test | Causa raíz | ¿Preexistente? | Estado tras r2 |
|---|---|---|---|---|
| 1 | `EditorialRunnerService.test.js:12` | `EPERM` al `rmSync` de un dir temporal con un hijo vivo (Windows no permite borrar el cwd de un proceso vivo) | **SÍ** (idéntico en base) | **sigue** (preexistente) |
| 2 | `content-certify.cli.test.js:16` | `54 !== 0`: en Windows `mode & 0o077` no refleja `0o600`; la clave privada no queda "owner-only" | **SÍ** (idéntico en base) | **sigue** (preexistente) |
| 3-5 | `analyticsGeo.test.js:67/100/129` | `maxmind` NO estaba en el node_modules (junction → checkout principal) | **NO — artefacto de entorno** | **PASAN** en r2 (maxmind instalado) |
| 6 | `stepTimeline.test.js:55` | aserción de tiempo CPU vs wall-time | **NO — flaky** | **PASA** en r2 (no determinista) |

La corrida r2 (post-maxmind) cierra H1 con evidencia: `1052 tests / 1002 pass / 2 fail / 48 skip` — los
únicos 2 fallos son exactamente los 2 preexistentes de la base `21dbfe42` (mismo `fail=2`).

## Contratos T1: 0 regresiones

`1052 = 987 (base) + 65 (tests nuevos de `flow-states.test.ts` + `flow-mapping.test.ts`)`. Los 65
tests nuevos PASAN. Ningún fallo toca `application/editorialflow/`.

## Hallazgos

- **H1 — node_modules junction incompleto (entorno) — CERRADO con evidencia.** El junction de
  `node_modules` de los worktrees m14r7 apunta al checkout principal, que inicialmente carecía de
  `maxmind` y `mongodb-memory-server`. El captain instaló ambos en el node_modules principal
  (infraestructura, no mi worktree; git status limpio). Corrida r2 confirma: los 3 tests GeoIP
  pasan y el árbol queda en `fail=2` (idéntico a la base). Para staging sigo lanzando el binario
  `mongod` cacheado directamente (no dependo de `mongodb-memory-server`).
- **H2 — 2 fallos preexistentes confirmados.** `EditorialRunnerService` (EPERM Windows) y
  `content-certify.cli` (permisos Windows). No los introduce T1/T2; son ajenos al entregable m14r7.
- **H3 — `legacy-enrichment-preflight.mongo` NO es un fallo.** Está `skip` (requiere
  `TEST_MONGO_URI`); pertenece a los 48 skipped, tanto en base como en árbol. La hipótesis del
  captain que lo listaba como fallo no se sostiene con esta ejecución.

## Conclusión

Árbol m14r7 (r2): `1052 tests / 1002 pass / 2 fail / 48 skip`; base 21dbfe42: `987 / 937 / 2 / 48`.
Los únicos 2 fallos del árbol son idénticos a los 2 de la base (preexistentes, ajenos a m14r7).
Los 65 tests nuevos de los contratos T1 pasan. **0 regresiones de código.**
