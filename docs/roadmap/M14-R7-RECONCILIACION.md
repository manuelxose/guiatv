# M14-R7 · Reconciliación del flujo editorial (verificación T4)

Verificador independiente: `verifier`. Fuentes de solo lectura (no se vuelve a consultar producción):
`tmp-storage/m14r7/prod-probe2..6.txt` (captura 2026-11-06 ~09:11 UTC). Rama verificada: `verify/m14r7`
@ `fda8da0d` (T2 `e57db613` + corrección de contratos T1c `db5bee05`).

## 1. Confirmación / refutación de los hechos

| Hecho | Veredicto | Evidencia |
|---|---|---|
| 22 temas = 21 rejected + 1 held | Confirmado | prod-probe3 `BY_STATE={"rejected":21,"held":1}` |
| held = `cnmc-derechos-audiovisuales-accesibilidad-plataformas`, attempts=2, score=67, "agotados los ciclos de revisión (5)" | Confirmado | prod-probe3 #4 |
| 19 `insufficient-evidence` + 1 `invalid-candidate: slug` + 1 `duplicate` (0.47) | Confirmado | classification/evidence-classification.json |
| 4 de 5 legacy publicados; el 5º `es-ilegal-ver-futbol-iptv-pirata` sin `blog_post` | Confirmado | prod-probe5 |
| GSC: **7** "Google no reconoce esta URL" + **7** "Descubierta: sin indexar", **0 indexadas** | Confirmado (corregido el recuento 2+1) | prod-probe6 |
| 4 aprobaciones manuales del CNMC (13:44/14:29/15:01/15:28 UTC, 5-nov) sin publicación | Confirmado | prod-probe4 `editorial_generation_requests` |

## 2. Clasificación de los 19 fallos de evidencia

Ver `artifacts/m14r7/evidence-classification.json` (generado por `scripts/m14r7-evidence-classify.mjs`).
Clases dominantes: **URL rota (HTTP 404)** y **documento renderizado por JavaScript (SPA)** son las dos
causas más frecuentes; les siguen **problema HTTP de recuperación (HTTP 0)**, **extracción de texto pobre**
y **puntuación de relevancia incorrecta** (caso `decidir-edad…`: la fuente CNMC, primaria autoritativa,
puntúa 1/8). Un único caso es **independencia genuinamente requerida** (`apple-tv-airplay…`: una sola
entidad editora). No hay ningún caso de **falta real de evidencia** que no sea explicable por una causa
recuperable de fuente.

## 3. Reconciliación: 29 entidades (22 cola + 5 legacy + 2 huérfanos)

- **22 temas en cola** (`editorial_queue_snapshot`): 21 rejected + 1 held (clasificados arriba).
- **5 registros legacy** (`blog_posts`): 4 publicados (`limite-anuncios…`, `horario-proteccion-menores…`,
  `subtitulos-audiodescripcion…`, `descargar-series-netflix…`) + 1 ausente (`es-ilegal-ver-futbol-iptv-pirata`,
  solo existe como job bloqueado, sin `blog_post`).
- **2 huérfanos** (`editorial_jobs` sin tema en cola): `permanencia-television-pago-derechos-espana`
  (5 jobs blocked) y `cine-en-abierto-tdt-miercoles-28-octubre-2026` (2 jobs blocked).

## 4. Los 5 legacy: causa y alcance de `maintenance-unverifiable`

Los 4 legacy publicados tienen, en la pasada de mantenimiento del 3-nov, estado `maintenance-unverifiable`
con el **mismo motivo literal**: `sin el fichero de ejecución de la versión publicada: no se puede re-verificar`.

- **¿Causa?** (a) **falta del fichero de ejecución de la versión publicada**, de forma uniforme. No hay
  otra causa (sin error de proveedor, sin hash que no cuadre, sin crítico).
- **¿Afecta a la validez del contenido o solo a la re-verificación?** Solo a la **re-verificación**. Los 4
  artículos están publicados (`status=publish`, `reviewState=approved`) y fueron **re-verificados con éxito**
  el día de publicación (28-oct) como `maintenance-verified` con "22/25/33/23 afirmaciones verificadas". Es
  un problema de **trazabilidad de procedencia**, no de falsedad del contenido.
- **Modelo T1c** (ya en código): `jobKind='maintenance'` + ejecución `failed` + publicación `sin-datos`
  (los jobs tienen `publicUrl:null`; la publicación la posee `blog_posts`). Verificado contra el código:
  `mapJobRecord` consume `JOB_STATE_TO_PUBLICATION['maintenance-unverifiable'] = NO_DATA` y
  `JOB_STATE_TO_EXECUTION['maintenance-unverifiable'] = 'failed'`.

## 5. Hallazgos de reconciliación (G1-G5)

- **G1** — `attempts` de cola infra-cuenta. La cola marca el CNMC con `attempts=2`, pero `editorial_jobs`
  registra **7 ejecuciones bloqueadas** del mismo slug (más 4 `queue-action approve`). La ficha del tema
  devuelve `retries.attempts=2` (de la cola) y **no reconstruye las 7 ejecuciones**: la diferencia se
  documenta aquí y debe mostrarse en el diagnóstico.
- **G2** — huérfanos fuera del snapshot: `permanencia…` (5 jobs) y `cine-en-abierto…` (2 jobs) no están en
  la cola. Reconciliar 22+5+2=29.
- **G3** — `editorial_job_ledger` parcial: 6 registros (permanencia ×5 + cnmc ×1) frente a 35 jobs. Los 4
  legacy no tienen job en el ledger → gate "job-en-ledger" = missing (honesto).
- **G4** — 4 legacy `maintenance-unverifiable` = artículo publicado + re-verificación fallida (ver §4).
- **G5** — generación programada: **diferencia build desplegada vs candidato** (producción `enabled=true`,
  candidato default `false`), no un error. En staging se mantiene `DISABLE_SCHEDULED_JOBS=true`.

## 6. Verificación backend (ejecución real)

`npm run test --silent --workspace=apps/backend` → **1086 tests / 1036 pass / 2 fail / 48 skip** (exit 1).
Los 2 fallos son **preexistentes y ajenos a m14r7**: `EditorialRunnerService` (EPERM Windows) y
`content-certify.cli` (permisos Windows `54!==0`), confirmados idénticos en el control de base `21dbfe42`.
Los **99 tests nuevos de m14r7** (65 T1 + 16 T2 + 18 T1c) **pasan todos** (0 regresiones).

Escenarios backend: `node scripts/m14r7-backend-scenarios.mjs` → resultado en
`artifacts/m14r7/` (ver salida de la ejecución).
