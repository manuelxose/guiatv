# M14-B — Orquestación duradera, observable y recuperable

Estado: **PARTIAL**. El motor está implementado y probado en local; falta desplegarlo y verificar un ciclo real de artículo en producción.

Fecha: 2026-11-05.

## 1. Qué se ha implementado

### 1.1 Ledger persistente

Colección `editorial_job_ledger` (MongoDB, sin infraestructura nueva) con un registro por trabajo:

- `jobId`, `slug`, `kind`, estado, etapa actual, intento y máximo de intentos.
- `worker` y `lease` con `token`, `generación`, `expiresAt` y `heartbeatAt`.
- `createdAt`, `startedAt`, `updatedAt`, `endedAt`, `articleDeadlineAt`, `lastProgressAt`.
- `stages[]` con nombre, intento, estado, fechas, deadline, error y detalle.
- `checkpoints[]` acotados, referencias de artefacto y hash.
- `error.classification` (proveedor, plazo, cancelación, validación, fuente, publicación, lease, worker).
- `usage` (llamadas, tokens, USD), modelos y publicación idempotente (`publicationKey` único parcial).

Cada escritura es un **compare-and-set sobre `revision`**. El trabajador solo puede escribir si su `token` y `generación` siguen siendo los del documento; un worker con lease expirado pierde la escritura aunque conserve el token antiguo.

### 1.2 Etapas reales del pipeline

`EditorialAgentPipeline` acepta un ciclo de vida opcional y emite:

`source-retrieval`, `research-synthesis`, `evidence-validation`, `article-drafting`, `seo-enrichment`, `publication-eligibility`, `quality-evaluation`.

El runner añade `topic-selection`, `source-discovery` y `editorial-outline` como **skipped con motivo** (ya vienen resueltos por la cola), y `publication` + `sitemap-registration` con comprobación real de `sitemap-blog.xml`. No se inventa una etapa que no se ejecutó.

### 1.3 Plazos, cancelación y aborto

- Plazo absoluto por **llamada** al proveedor (no por turno), plazo por etapa y plazo por artículo.
- `AbortSignal` propagado hasta el stream del proveedor: una cancelación o un plazo aborta la petición en curso, no solo la siguiente.
- Un tope de texto de 1 MiB además del tope de 8 MiB por evento.
- SIGTERM/SIGINT: el runner pide la cancelación, espera a que el trabajo cierre su lease y sale; la recuperación reconcilia lo que no pudo confirmar.
- La cancelación de un trabajo en ejecución queda en `cancelling` hasta que el worker confirma o expira el lease; nunca se declara cancelada antes.

### 1.4 Recuperación

- `recover` de un trabajo con lease expirado: lo devuelve a `queued` o lo pasa a `dead-letter` si agotó intentos.
- `recoverStale` reconcilia todos los leases expirados de una vez.
- Reintento con máximo de intentos y backoff conceptual del scheduler (el ciclo decide cuándo volver a intentar).
- Publicación con clave idempotente `${slug}:${draftHash}`: otro trabajo no puede volver a publicar la misma versión.
- Borrado de metadatos separado de la eliminación de un artículo publicado; exige estado terminal y archivo previo.

### 1.5 API administrativa y del runner

Bajo `/v2/admin/editorial`, con el guard de admin existente:

- `GET /ledger`, `GET /ledger/:jobId`.
- `POST /ledger/:jobId/{pause,resume,cancel,retry,recover,archive,delete}`.
- `POST /ledger/bulk` con resultado por elemento.
- `POST /ledger/recover-stale`.
- `POST /ledger/register|:jobId/claim|heartbeat|stage/start|stage/finish|checkpoint|finish|publication`.

Las escrituras del runner llevan el lease; las acciones humanas se auditan en `editorial_audit`.

### 1.6 Administración

Nueva pestaña **Trabajos** en Operaciones IA:

- Tabla con estado, etapa, intento, lease, coste, duración y acciones.
- Filtros por texto, estado, archivo y lease expirado; paginación.
- Selección múltiple mantenida entre páginas, con semántica explícita y resultados parciales.
- Detalle con línea de tiempo de etapas, puntos de control, error y publicación.
- Pausar, reanudar, cancelar, reintentar, recuperar, archivar y borrar metadatos, cada una con su guarda.
- Recuperación masiva de leases expirados.

## 2. Verificación local

- `npm run build:backend`: correcto.
- `npm run build:frontend`: correcto.
- Tests focalizados:
  - `EditorialJobLedger.test.ts`: 11/11 (lease, fencing, plazos, cancelación, pausa, reintento, archivo/borrado, publicación idempotente, listado y recuperación).
  - `EditorialAgentPipeline.test.ts`: etapas reales y señal de aborto.
  - `AnthropicEditorialModel.test.ts`: señal ya abortada no abre stream.
  - `scripts/editorial-job-ledger.test.mjs`: 2/2 (contrato HTTP del runner y cancelación).
  - `scripts/editorial-cycle.test.mjs`: 17/17 con `EDITORIAL_JOB_LEDGER=off` (no cambia el comportamiento histórico en las pruebas del scheduler).
  - `admin-job-ledger.component.spec.ts`: acciones por estado, lease y Escape.
- Suite completa: ver `M14-B-VERIFICATION.md` (resumen y fallos ambientales conocidos).

## 3. Pendiente para PASS

1. Desplegar el backend antes que el runner (el runner falla cerrado si el endpoint del ledger no existe).
2. Ejecutar una sincronización de Search Console y comprobar que la nueva UI muestra motivos y diagnóstico.
3. Ejecutar un ciclo controlado, corto y con fuentes verificables, con el ledger activo.
4. Verificar cancelación durante generación, muerte del worker, reintento y recuperación en producción.
5. Confirmar que la publicación idempotente no duplica artículos.
6. No reactivar la generación programada hasta completar estos pasos.

## 4. Limitaciones conocidas

- MongoDB de producción es standalone: no hay transacciones multi-documento. La atomicidad se consigue con compare-and-set por documento; la publicación se protege con clave idempotente y la comprobación existente del CMS.
- El plazo por etapa aborta el trabajo completo; no reanuda la etapa desde un checkpoint intermedio. Los checkpoints se guardan para diagnóstico y recuperación manual.
- La recuperación de leases expirados no se ejecuta todavía en un cron propio; se ejecuta desde la administración y al arrancar el runner. Añadir un cron es una mejora operativa, no un requisito de corrección.
- El worker que muere justo después de publicar y antes de cerrar el lease deja el trabajo en `running` hasta que expira el lease; la publicación ya es idempotente, así que la recuperación no duplica el artículo.
