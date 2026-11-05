# M14-B — Verificación local

Fecha: 2026-11-05. Ejecutado en Windows 11, Node 24.18.0, desde `C:\Users\Admin\Documents\workspace\guiatv`.

## 1. Compilación

| Comando | Resultado |
|---|---|
| `npm run build:backend` | PASS (tsc + tsc-alias sin errores) |
| `npm run build:frontend` | PASS (SSR production; único aviso: caché nativa de Angular no disponible en este host) |

## 2. Tests focalizados

| Comando | Resultado |
|---|---|
| `node --require ./test-setup.cjs --test dist/application/services/EditorialJobLedger.test.js` | 11/11 PASS |
| `node --require ./test-setup.cjs --test dist/application/services/EditorialAgentPipeline.test.js` | 13/13 PASS |
| `node --require ./test-setup.cjs --test dist/infrastructure/external/AnthropicEditorialModel.test.js` | 6/6 PASS |
| Conjunto anterior | 32/32 PASS |
| `node --test scripts/editorial-job-ledger.test.mjs` | 2/2 PASS |
| `node --test scripts/editorial-cycle.test.mjs` | 17/17 PASS con `EDITORIAL_JOB_LEDGER=off` |
| `npm run test:frontend` | 451/451 PASS |

## 3. Suite completa de backend

Comando: `node --require ./test-setup.cjs --test "dist/**/*.test.js"`.

```
tests 960
pass 908
fail 5
skipped 47
cancelled 0
```

Los 5 fallos son los ambientales ya documentados en `M14-RECOVERY-BASELINE.md`, no del código de M14-B:

1. `EditorialRunnerService.test.js`: `EPERM` al borrar un directorio temporal en Windows (contenido del test, no del servicio).
2. `analyticsGeo.test.js`: fixture GeoIP no disponible en este host (2 fallos más del mismo archivo).
3. `analyticsGeo.test.js`: base de datos de refresco no disponible.
4. `analyticsGeo.test.js`: MaxMind/DB-IP no disponibles.
5. `content-certify.cli.test.js`: permisos de archivo de la clave privada en Windows (54 en vez de 0).

No hay ningún fallo nuevo en `EditorialJobLedger`, `EditorialAgentPipeline`, `AnthropicEditorialModel`, `DeepSeekEditorialModel`, `SearchConsoleMonitor` ni en las rutas/controlador modificados.

## 4. Qué cubren los tests nuevos

- Registro y claim con lease, generación y plazo del artículo.
- Rechazo de escrituras de un worker cuyo lease expiró y fue recuperado por otro.
- Heartbeat con cancelación y plazo agotado.
- Cancelación inmediata en cola y reconciliación diferida en ejecución.
- Pausa y reanudación.
- Reintento con tope de intentos.
- Archivo y borrado separados de metadatos.
- Publicación idempotente por `publicationKey`.
- Listado, filtros, búsqueda y recuperación masiva de leases.
- Checkpoints acotados y protegidos por lease.
- Etapas reales del pipeline y aborto por señal.
- Contrato HTTP del runner: registro, claim, etapas, checkpoint, publicación y cierre con el mismo token.
- Cancelación por heartbeat que aborta el `AbortSignal` del trabajo.

## 5. Pendiente de verificación en producción

- Despliegue del artefacto y comprobación de que el endpoint del ledger responde antes de arrancar el runner.
- Ciclo controlado de un artículo corto con fuentes verificables.
- Cancelación durante generación y recuperación tras matar el worker.
- Confirmación de publicación idempotente y de que la generación programada sigue en pausa hasta el canary.
