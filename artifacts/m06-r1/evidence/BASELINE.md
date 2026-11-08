# M06-R1 — Línea base verificada (capturada por el capitán antes de tocar código)

Fecha: 2026-11-06. Worktree: `guiatv/.m06-r1` (rama `feat/m06-r1-recovery`), base `f020ea82`
(HEAD de `feat/sports-v2-m06-integration`), árbol limpio, build propio (`dist/` regenerado).

## 1. Capacidades de ejecución realmente disponibles en este entorno

El revisor independiente no pudo ejecutar pruebas (`spawn EPERM`). Esta es la causa medida y la
solución verificada, no una suposición:

| Hecho medido | Evidencia |
|---|---|
| Un hijo con `stdio: 'pipe'` falla con `EPERM` en este host | matriz `spawn-matrix.json`: pipe → `EPERM`; `stdio` a archivo → `status 0` |
| `node --test` por defecto (`--test-isolation=process`) lanza un worker por archivo sobre un pipe | todos los archivos abortan al crear el worker con `spawn EPERM` |
| `--test-isolation=none` ejecuta todos los archivos en el proceso del runner | sin workers, sin pipes: la suite corre de verdad |
| La línea de resumen del reporter `spec` se suprime con stdout no-TTY | el resumen desaparece al redirigir |
| El reporter `junit` escribe un archivo estructurado de forma fiable | `junit.xml` parseado → recuentos reales |

Conclusión: `npm run test -w apps/backend` **no es ejecutable en este sandbox** y no lo era para el
revisor. El script `scripts/m06-r1-run-backend-suite.mjs` ejecuta la misma suite completa con
`--test-isolation=none` y reporter JUnit. **No se relaja ninguna aserción**; el script falla si no se
ejecuta ninguna prueba (guarda de cero-pruebas).

Limitación honesta: `--test-isolation=none` comparte el estado entre archivos dentro de un solo
proceso (Mongoose/Mongo, temporizadores, módulos con estado). Un fallo puede depender del orden, por lo
que el script acepta `--only <regex>` para ejecutar un subconjunto en aislamiento y distinguir un
defecto propio de una interferencia entre archivos.

## 2. Línea base de la suite de backend (build limpio, R1)

Comando: `node scripts/m06-r1-run-backend-suite.mjs --out <dir>`

| Métrica | Valor |
|---|---:|
| Archivos de prueba compilados | 198 |
| Pruebas ejecutadas | **1 118** |
| Pasadas | **1 058** |
| Falladas | **11** |
| Omitidas | 49 |
| Exit code | 1 |

Esto corrige la cifra declarada por el capitán ("1 119 pruebas, 1 069 pasando, un fallo conocido"):
la cifra real es 1 118 ejecutadas y **11 fallos**, ninguno de ellos el "fallo de modo de archivo de
Windows" descrito, y ninguno en fútbol.

## 3. Identidad exacta de los 11 fallos (todos fuera de fútbol)

| # | Archivo | Causa observada |
|---|---|---|
| 1 | `application/services/CatalogService.programme-path.test.js` | interferencia entre archivos (pasa en aislamiento) |
| 2 | `application/services/ContentCanaryManifest.test.js` | manifiesto/manifest reproducible |
| 3 | `application/services/ContentCanaryManifest.test.js` | refresco del manifiesto |
| 4 | `application/services/EditorialRunnerService.test.js` | arranque del proceso del runner editorial — `spawn EPERM` (restricción de sandbox real) |
| 5 | `infrastructure/external/ClaudeCodeEditorialModel.test.js` | espera "Could not start Claude Code", recibe `spawn EPERM` (restricción de sandbox real) |
| 6-10 | `presentation/controllers/SitemapController.test.js` (×4) y `scripts/content-certify.cli.test.js` (×1) | interferencia entre archivos (pasan en aislamiento) |

Verificación cruzada: ejecutando solo esos seis archivos en aislamiento → **39 pruebas, 34 pasan,
5 fallan**. Los cinco que fallan en aislamiento son #2, #3, #4, #5 y uno de SitemapController; el resto
son interferencia de la ejecución completa.

**Criterio de comparación para M06-R1**: cualquier fallo final que no esté en esta lista es una
regresión nueva y bloquea la entrega. Los fallos de esta lista siguen registrados como
preexistentes/medioambientales, no como aceptados.

## 4. Otros hechos de línea base

| Hecho | Resultado |
|---|---|
| `tsc -p apps/backend/tsconfig.json --noEmit` | exit 0 |
| `tsc -p apps/frontend/tsconfig.app.json --noEmit` | exit 0 |
| `apps/backend/dist` del worktree `guiatv-m06-int` | **no se puede escribir** (ACL residual `Todos:(DENY)(DC)`): impide compilar allí; por eso R1 trabaja en un worktree nuevo |
| MongoDB local | **no disponible** (puerto 27017 cerrado, sin binario `mongod`, Docker daemon inaccesible) |
| Playwright (navegadores) | instalado (`chromium-1248`, `chromium_headless_shell-1248`) |
| `mongodb-memory-server` | **no instalado** y no debe instalarse como dependencia del repositorio |
