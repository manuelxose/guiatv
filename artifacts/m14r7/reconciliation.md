# M14-R7 · Reconciliación del flujo editorial (verificación T4)

Verificador independiente: `verifier`. Fuentes (solo lectura, no se vuelve a consultar producción):
`tmp-storage/m14r7/prod-probe2..6.txt` (captura 2026-11-06 ~09:11 UTC).

## 1. Confirmación / refutación de los hechos del captain

| # | Hecho (captain) | Veredicto | Evidencia |
|---|---|---|---|
| F1 | 22 items = 21 rejected + 1 held | **CONFIRMADO** | prod-probe3 `BY_STATE={"rejected":21,"held":1}` |
| F2 | held = `cnmc-derechos-audiovisuales-accesibilidad-plataformas`, attempts=2, score=67, "blocked: agotados los ciclos de revisión (5)" | **CONFIRMADO** (con matiz, ver G1) | prod-probe3 #4 |
| F3 | 19 con `insufficient-evidence` | **CONFIRMADO** | classification.json `reasonFamily.insufficient-evidence=19` |
| F4 | 1 `invalid-candidate: slug` = `proteccion-menores-control-parental-plataformas` | **CONFIRMADO** | prod-probe3 #5 |
| F5 | 1 `duplicate` = `control-parental-netflix-prime-video` (0.47) vs `proteccion-menores-…` | **CONFIRMADO** | prod-probe3 #17 |
| F6 | 4 de 5 legacy publicados (status:publish, reviewState:approved) | **CONFIRMADO a nivel DB** | prod-probe5 líneas 2-9 |
| F7 | 5º legacy `es-ilegal-ver-futbol-iptv-pirata` NO tiene blog_post | **CONFIRMADO** | prod-probe5 línea 10 `NOT FOUND` |
| F8 | GSC: 2 "Google no reconoce esta URL", 1 "Descubierta: actualmente sin indexar" | **REFUTADO en los contadores** (la tesis "indexación != sitemap" se confirma y refuerza) | prod-probe6: 14 URLs → **7** "Google no reconoce" + **7** "Descubierta: sin indexar", 0 indexadas |
| F9 | 4 aprobaciones manuales del tema CNMC (13:44, 14:29, 15:01, 15:28 del 5-nov) sin publicación | **CONFIRMADO** | prod-probe4 `editorial_generation_requests` (4 `queue-action approve`), todas `completed` |

Detalle F8: el archivo de GSC es `prod-probe6.txt` (colección de URLs inspeccionadas + `gsc_runs`).
Las 14 URLs son guías publicadas (no los 22 temas rechazados). Ninguna está indexada:
`coverageState` es "Google no reconoce esta URL" (7) o "Descubierta: actualmente sin indexar" (7).
Los 4 legacy publicados se reparten así: `limite-anuncios…` = Descubierta (1), y
`horario-proteccion-menores…`, `subtitulos-audiodescripcion…`, `descargar-series-netflix…` =
"Google no reconoce" (3). El recuento del captain (2+1) no coincide con ninguna subselección
natural (ni 4 legacy ni 14 GSC); la conclusión cualitativa (sitemap no implica indexación) es correcta.

Detalle F6/F7: los HTTP 200 / canonical / sitemap-blog.xml son comprobaciones HTTP que el captain
ya ejecutó; desde los dumps solo puedo confirmar el estado DB (`status=publish`, `reviewState=approved`,
`seo.canonicalUrl` presente). No se re-consulta producción.

## 2. Clasificación de los 22 (19 + 1 + 1 + 1)

Ver `classification.json`. Resumen:

- **19 `insufficient-evidence`**: rechazados en discovery por no alcanzar 2 entidades editoras
  verificadas (o, en 1 caso — `apple-tv-airplay…` — "una sola entidad editora"). Patrón dominante:
  las semillas de proveedores (netflix/primevideo/disneyplus/uefa/rfef/laliga) devuelven 404, HTTP 0
  o "página sin texto legible (¿SPA?)"; solo las fuentes BOE/CNMC/support.apple puntúan.
- **1 `invalid-candidate: slug`** — `proteccion-menores-control-parental-plataformas`.
- **1 `duplicate`** — `control-parental-netflix-prime-video` (similitud 0.47 vs `proteccion-menores…`).
- **1 `held`** — `cnmc-derechos-audiovisuales-accesibilidad-plataformas` (agotados 5 ciclos).

## 3. Reconciliación: 29 entidades (22 cola + 5 legacy + 2 huérfanos) vs editorial_jobs (35)

El snapshot (cola) tiene 22 temas; `editorial_jobs` (35) contiene más entidades. Inventario por slug:

| slug | jobs | resultado |
|---|---|---|
| cnmc-derechos-audiovisuales-accesibilidad-plataformas | 7 | todos `blocked` (truncated/401/no-route/connection/ciclos 5) |
| limite-anuncios-television-minutos-por-hora-ley | 3 | published + maint-verified + maint-unverifiable |
| horario-proteccion-menores-television-calificacion-por-edades | 4 | published + blocked + maint-verified + maint-unverifiable |
| subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones | 3 | published + maint-verified + maint-unverifiable |
| descargar-series-netflix-grabar-tele-copia-privada | 4 | published + maint-verified + re-blocked + maint-unverifiable |
| permanencia-television-pago-derechos-espana | 5 | todos `blocked` (JSON/map/no-JSON-block/ciclos 2 ×2) |
| cine-en-abierto-tdt-miercoles-28-octubre-2026 | 2 | `blocked` (critic-rejected, límite presupuesto) |
| es-ilegal-ver-futbol-iptv-pirata | 1 | `blocked` (ciclos 5) — el 5º legacy sin publicar |
| discovery | 6 | discovery runs (Oct 28 ×3, Nov 3 ×1, Nov 5 ×1, Nov 6 ×1) |

### Hallazgos de reconciliación (gaps)

- **G1 — `attempts` del snapshot infra-cuenta la realidad.** El snapshot marca el tema held
  `cnmc…` con `attempts=2`, pero `editorial_jobs` registra **7 ejecuciones bloqueadas** del mismo
  slug (más 4 `queue-action approve`). El campo `attempts` de la cola no es el contador de intentos
  de generación; debe documentarse qué cuenta exactamente o corregirse. Relevante para
  "instrumentación del embudo sin eventos inventados".
- **G2 — temas huérfanos en `editorial_jobs` fuera del snapshot.** `permanencia-television-pago-derechos-espana`
  (5 jobs) y `cine-en-abierto-tdt-miercoles-28-octubre-2026` (2 jobs) existen en `editorial_jobs`
  pero no aparecen en el snapshot de 22. Son temas que pasaron a generación (blocked) pero ya no
  están en la cola: o se consumieron sin dejar rastro en la cola, o el snapshot no representa el
  estado `blocked` de generación (solo `rejected`/`held` de discovery). La reconciliación debe
  cubrir 22 (cola) + 5 (legacy) + 2 (huérfanos) = 29 entidades, no solo 22+5.
- **G3 — `editorial_job_ledger` parcial.** Solo 6 registros (permanencia ×5 + cnmc ×1) frente a
  35 en `editorial_jobs`. El ledger no contiene los jobs de discovery, maintenance ni published.
  Si el ledger es la fuente de verdad del embudo, está incompleto.
- **G4 — 4 legacy en `maintenance-unverifiable` (artículo publicado, re-verificación fallida).**
  Los 4 jobs tienen `publicUrl:null`; la publicación la posee `blog_posts` (status=publish,
  reviewState=approved), no el job. Modelo correcto (T1c, en curso por contracts-arch):
  `jobKind='maintenance'` + ejecución `failed` + publicación `sin-datos` — **NO** ejecución `blocked`
  (el mapeo anterior de T1 era incorrecto). El motivo es "sin el fichero de ejecución de la versión
  publicada": la re-verificación pierde el fichero de ejecución al publicar — brecha para
  "recuperación segura". (4 jobs `maintenance-verified` anteriores sí verificaron 22/33/25/23 afirmaciones.)
- **G5 — generación programada: diferencia build desplegada vs candidato (no error).** Producción
  tiene `editorial_settings.generation.enabled=true` (`scheduleHours=3`, runner `status=ready`) y los
  ciclos recientes devuelven `no-eligible-topics` (queued=0): pipeline "hambriento" porque 22 están
  rechazados y el held agotó ciclos. Esto **no contradice el candidato**, cuyo default es `false`;
  es una diferencia entre el build desplegado y el candidato. (En staging se mantiene
  `DISABLE_SCHEDULED_JOBS=true`.)

## 4. Estado de settings / runner / aprobaciones

- `editorial_settings.policy`: `paused=false`, `dailyLimit=10`.
- `editorial_settings.generation.routes`: research/evidence/editorial/critic = deepseek-v4-pro,
  seo = deepseek-flash (actualizado 2026-11-06T00:08 por manuelxgon@gmail.com).
- `editorial_runner`: `status=ready`, providers `["deepseek"]`, `webSearch=true`, `version=m11g-2`.
- 4 `queue-action approve` del tema CNMC: 13:44:01Z (manuelxgon), 14:29:15Z, 15:01:11Z ("reintento
  tras límites de proveedor"), 15:28:45Z ("reintento con redactor v4-pro"). Ninguna desembocó en
  publicación; el último intento de generación (15:06 y 15:23 del 5-nov y 00:08 del 6-nov) acabó
  `blocked`. El 4º approve (15:28) se registra `finishedAt` 15:40:49Z sin job correspondiente en
  `editorial_jobs` a esa hora — la aprobación se marcó completada pero no consta una ejecución
  generada para ella (ver G1).

## 5. Los 4 legacy `maintenance-unverifiable`: causa y alcance (pregunta del encargo)

**¿(a) falta de fichero de ejecución de la versión publicada, o (b) otra causa? → (a), de forma uniforme.**
Los 4 jobs (`limite-anuncios…`, `horario-proteccion-menores…`, `subtitulos-audiodescripcion…`,
`descargar-series-netflix…`) comparten el **mismo motivo literal**: `sin el fichero de ejecución de la
versión publicada: no se puede re-verificar`. No hay evidencia de otra causa (sin errores de proveedor,
sin hash que no cuadre, sin critic): es la falta del fichero de ejecución, y nada más.

**¿Afecta a la validez del contenido publicado o solo a la capacidad de re-verificarlo? → solo a la
re-verificación; el contenido publicado no queda en entredicho.**
Razones con evidencia:
1. Los 4 artículos están publicados con `status=publish`, `reviewState=approved` y conservan su
   `seo.canonicalUrl` (prod-probe5).
2. Los 4 fueron **re-verificados con éxito** el mismo día de publicación (2026-10-28) como
   `maintenance-verified` con "22 / 25 / 33 / 23 afirmaciones verificadas" respectivamente
   (prod-probe2).
3. El motivo `maintenance-unverifiable` aparece en la siguiente pasada de mantenimiento (2026-11-03),
   es decir, *después* de la publicación: lo que se perdió es el fichero de ejecución de esa versión,
   no la verificación original del contenido.

Conclusión: es un **problema de trazabilidad de procedencia** (el registro de ejecución que permitiría
re-verificar ya no está), **no** un indicio de que el artículo sea falso. El mapeo correcto (T1c)
`jobKind='maintenance'` + ejecución `failed` + publicación `sin-datos` refleja exactamente eso: la
publicación la posee `blog_posts` (approved), y el job de mantenimiento falla sin datos re-verificables.

Nota de trazabilidad adicional: la cadena literal "sin el fichero de ejecución de la versión publicada"
**no aparece en el código fuente del candidato** (solo como fixture en `flow-mapping.test.ts`); la
emitió el build desplegado en producción. El generador de jobs de mantenimiento que produce ese estado
no está (íntegro) en el candidato — brecha a revisar en la integración.

## 6. Veredicto parcial de reconciliación

La clasificación de los 22 y la existencia/estado de los 5 legacy **quedan confirmadas**. La
reconciliación abarca **29 entidades**: 22 (cola) + 5 (legacy) + 2 (huérfanos: `permanencia…` y
`cine-en-abierto…`). Quedan abiertos para el entregable: G1 (semántica de `attempts`), G2 (huérfanos),
G3 (ledger parcial), G4 (re-verificación legacy → `jobKind='maintenance'` + ejecución `failed` +
publicación `sin-datos`), G5 (diferencia build desplegada vs candidato). El recuento GSC correcto
es 7+7 (no 2+1), manteniendo la tesis "indexación != sitemap".
