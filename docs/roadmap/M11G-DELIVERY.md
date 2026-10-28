# M11-G: indexación en Google y datos propios en el pipeline editorial

- **Fecha:** 2026-10-28.
- **Base:** `main@ddb0e00`, producción `20261028111735` @ `e7aaf2b` (verificado en el host antes de empezar).
- **Producción tras el hito:** `20261028155613` @ `ad46e73` (PR #115).
- **Runner programado:** `guiatv-runner` en `main@ad46e73` (pipeline `m11g-1`).
- **Alcance:** solo M11-G.
  - Sin trabajo de M12.
  - Sin cambios en la política de canonical ni en las decisiones de URL de M09.
  - Sin dependencias nuevas; `package-lock.json` no cambia.
  - El frontend no cambia.

## 1. Resumen ejecutivo

| Puerta | Estado | Evidencia |
|---|---|---|
| ENGINEERING PASS | **PASS** | PR #115: CI del PR y de `main` en verde (backend, frontend, build/test/perf con `test:ops`, regresión SEO). Dos revisiones independientes: 0 BLOCKER; los HIGH y MEDIUM se corrigieron antes del merge (§12) |
| INDEXATION DIAGNOSTICS PASS | **PASS** | Diagnóstico de las 14 guías con inspección real de Google, separando guías nuevas y antiguas (§3) |
| TECHNICAL SEO PASS | **PASS** | SSR, robots, canonical, sitemap, enlaces y paridad móvil/escritorio verificados en producción (§5). Defecto confirmado y corregido: el índice del sitemap no tenía `lastmod` |
| FIRST-PARTY DATA PASS | **PASS** | `GET /v2/editorial/facts`: hechos propios con procedencia, origen, vigencia y frescura; datos ambiguos o caducados retenidos; 5 tests deterministas y smoke en producción (§6–§7) |
| EDITORIAL PILOT PASS | **NOT PASS** (HOLD correcto) | La revisión de `descargar-series-netflix-grabar-tele-copia-privada` verificó el art. 31 de la LPI y pasó todas las puertas deterministas, pero el crítico pidió `revise` en las 6 versiones (un `high` lo detectó la comprobación nueva del valor diferencial). No se publicó nada y la versión publicada quedó intacta (§8) |
| AUTONOMOUS OPERATIONS PASS | **PASS** | Tarea `GuiaTV\EditorialCycle` intacta, runner actualizado; cupo 10/día en el servidor; parada de emergencia, política activa y presupuesto ilimitado sin cambios (§16) |
| SEARCH CONSOLE OBSERVABILITY PASS | **PASS** | Histórico de inspecciones, clasificación normalizada, cadencia acotada y resumen por grupos (§10) |
| GOOGLE INDEXING | **NOT YET OBSERVED** | 0 de 14 guías indexadas; 0 de 840 URLs del sitemap indexadas en todo el dominio |
| M12 | **NO-GO**, sin cambios | §18 |

**Conclusión principal:** la falta de indexación **no es un defecto de las guías**. Afecta a todo el dominio:

- La portada figura como «Rastreada: actualmente sin indexar» (último rastreo el 20-oct).
- Los sitemaps tienen 840 URLs enviadas y 0 indexadas.
- Las impresiones del sitio cayeron de 20–60 al día a prácticamente 0 el **2026-09-01**, antes de que existiera ninguna de estas guías.

Técnicamente las guías son indexables. El único defecto demostrable dentro del alcance era de descubrimiento, y se ha corregido: Google no releía `sitemap-blog.xml`, así que las guías nuevas no estaban en su copia. La causa de fondo, la valoración del dominio, es una hipótesis que pertenece a M09/M10 (§4).

## 2. Línea base verificada

- **Repositorio:** `main@ddb0e00` (docs de M11-F, #114). La rama de trabajo se creó desde ahí.
- **Producción:**
  - `readlink` → `releases/20261028111735`;
  - `release.json` con `gitSha e7aaf2b…`;
  - `guiatv-api` y `guiatv-ssr` activos con `NRestarts=0`;
  - `GSC_MONITOR_ENABLED`, `GSC_AUTO_SUBMIT_ENABLED` y `EDITORIAL_POLICY_PUBLISHING` definidos.
- **Corpus público:** **14 guías**, no 13. Las 13 inspecciones de M11-F son anteriores a la guía del 28-oct. Por fecha de publicación:

  | Fecha | Guías |
  |---|---|
  | 2026-08-31 | 1 |
  | 2026-10-19 | 9 |
  | 2026-10-27 (23:33 UTC) | 3 |
  | 2026-10-28 (10:40 UTC) | 1 |

- **Search Console:** la cuenta de servicio con `webmasters.readonly` funciona. Todas las consultas de este hito fueron de solo lectura; nunca se usó la Indexing API.

## 3. Diagnóstico de indexación de las 14 guías

**Fuentes:** inspección URL de Google (API URL Inspection, `languageCode=es`) del 2026-10-28 a las 10:19, 11:22 y ~15:00 UTC, más la lista de sitemaps de la propiedad. La API muestra la copia indexada de Google, no un rastreo en directo. Los campos que Google no devuelve se marcan como «—» y no se interpretan como un estado negativo.

| Guía | Publicada | Edad | Estado de Google (última respuesta) | Clase normalizada | Último rastreo | Sitemap asociado | Referencias | Canonical de Google |
|---|---|---|---|---|---|---|---|---|
| movistar-plus-vs-dazn | 2026-08-31 (cambio 10-19) | 58 d | Google no reconoce esta URL | not-discovered | — | — | — | — |
| donde-ver-champions-league-2026-27-espana | 2026-10-19 | 9 d | Google no reconoce esta URL | not-discovered | — | — | — | — |
| donde-ver-laliga-2026-27-espana | 2026-10-19 | 9 d | Google no reconoce esta URL | not-discovered | — | — | — | — |
| precios-plataformas-streaming-espana | 2026-10-19 | 9 d | Descubierta: actualmente sin indexar | discovered-not-indexed | — | sitemap-blog, sitemap | — | — |
| netflix-hbo-max-disney-prime-video-que-plan-elegir | 2026-10-19 | 9 d | Google no reconoce esta URL (10:19: «Descubierta») | not-discovered | — | — | — | — |
| mejores-series-y-peliculas-netflix-espana | 2026-10-19 | 9 d | Google no reconoce esta URL | not-discovered | — | — | — | — |
| mejores-series-y-peliculas-prime-video-espana | 2026-10-19 | 9 d | Google no reconoce esta URL | not-discovered | — | — | — | — |
| mejores-series-y-peliculas-disney-plus-espana | 2026-10-19 | 9 d | Google no reconoce esta URL (10:19: «Descubierta») | not-discovered | — | — | — | — |
| mejores-series-y-peliculas-hbo-max-espana | 2026-10-19 | 9 d | Descubierta: actualmente sin indexar | discovered-not-indexed | — | sitemap-blog, sitemap | — | — |
| mejores-series-y-peliculas-movistar-plus-espana | 2026-10-19 | 9 d | Descubierta: actualmente sin indexar | discovered-not-indexed | — | sitemap-blog, sitemap | — | — |
| horario-proteccion-menores-television-calificacion-por-edades | 2026-10-27 | 15 h | Google no reconoce esta URL | not-discovered (demasiado pronto) | — | — | — | — |
| limite-anuncios-television-minutos-por-hora-ley | 2026-10-27 | 15 h | Google no reconoce esta URL | not-discovered (demasiado pronto) | — | — | — | — |
| subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones | 2026-10-27 | 15 h | Google no reconoce esta URL | not-discovered (demasiado pronto) | — | — | — | — |
| descargar-series-netflix-grabar-tele-copia-privada | 2026-10-28 | 5 h | Google no reconoce esta URL | not-discovered (demasiado pronto) | — | — | — | — |

**Resultado en todas las guías:** veredicto NEUTRAL, sin rastreo registrado, sin estado de robots ni de descarga y sin canonical elegida por Google. Ninguna está indexada, bloqueada, con error de descarga ni como duplicado de otra canonical.

**Guías nuevas frente a antiguas:**
- **Nuevas (≤ 1 día, 4 guías):** que no estén indexadas es lo esperable y no es un defecto. Además, Google no las tenía en su copia del sitemap (§4, F1).
- **Del 19-oct (9 días, 9 guías):** Google conoce algunas por el sitemap («Descubierta»), pero no ha rastreado ninguna. La API dio respuestas distintas en la misma mañana: a las 10:19 las «descubiertas» eran Disney+ y «qué plan elegir»; a las 15:00, precios, HBO Max y Movistar+. Se registra como inestabilidad de la API, no como un cambio real.
- **Del 31-ago (1 guía):** Google no la reconoce. Su publicación efectiva en el corpus aprobado es probablemente del 19-oct (por su `updatedAt` y la remediación de M11-B), pero no se puede demostrar.

**Search Analytics:**
- **`/guias/`:** 0 filas en 28 días.
- **Todo el sitio, 90 días:** 653 impresiones y 6 clics, con posición media 56. La mayoría corresponde a la portada (575) y a páginas sueltas.
- **Serie diaria de la portada:** 20–60 impresiones al día del 16 al 31 de agosto, ~0 desde el 1 de septiembre y un pequeño repunte el 24–27 de octubre (8–17 al día).

## 4. Causas confirmadas frente a hipótesis

### Confirmadas y corregidas (dentro del alcance)

| # | Hallazgo | Evidencia | Reproducción | Gravedad | Confianza | Corrección |
|---|---|---|---|---|---|---|
| F1 | El índice `sitemap.xml` no declaraba `lastmod`, así que reenviarlo nunca indicaba a Google que un hijo había cambiado | API `sitemaps.list`: índice descargado el 28-oct a las 11:22, pero `sitemap-blog.xml` descargado por última vez el **26-oct con 13 URLs**; hoy tiene 18. Las 4 guías nuevas y la categoría Televisión faltaban en la copia de Google. Cuadra con «Google no reconoce esta URL» en las nuevas | `GET /sitemap.xml` antes del despliegue: ningún `<lastmod>`. Comparar con `sitemaps.list` | Media (descubrimiento) | Alta | El hijo `blog` lleva el `lastmod` real más reciente de sus guías. Los hijos que dependen de la parrilla no llevan, porque dirían «hoy» cada día y Google descuenta el `lastmod` de un sitio cuando no es fiable. Verificado en producción: `sitemap-blog.xml=2026-10-28` |
| F2 | Publicar una guía no invalidaba la caché del sitemap (6 h). Solo lo hacía el precálculo de la parrilla | Código: `invalidateSitemapCache` solo se llamaba desde `PrecomputeSchedule` | — | Baja (dependía del intervalo del precálculo) | Alta | Publicar o revisar invalida solo los sitemaps de blog e índice. Una construcción en curso durante la invalidación no deja en caché la versión antigua (test) |
| F3 | Operación: una revisión del mismo día que la publicación sobrescribía el fichero de ejecución de la versión en producción | `persist()` escribía `<día>-<slug>.json` | Test `editorial-cycle.test.mjs` | Media (pérdida de procedencia para el mantenimiento) | Alta | La nueva ejecución se escribe al lado. Test: la fallida deja intacto el fichero publicado |

### Observaciones confirmadas fuera del alcance (M09/M10)

- **Todo el dominio está fuera del índice:**
  - portada en «Rastreada: actualmente sin indexar» (rastreo del 20-oct, canonical de Google = la declarada);
  - `/canales` en «Descubierta»;
  - `/guias` y `/guias/categoria/streaming` en «Google no reconoce esta URL»;
  - 0 de 840 URLs del sitemap indexadas.
- **La demanda de rastreo es mínima:** Google no ha rastreado ninguna guía en 9 días aunque están en el sitemap y enlazadas desde la portada y `/guias`.
- **El 85 % del sitemap son páginas `/programas` de la EPG** (680–722 URLs): efímeras, muchas a nivel de episodio y con slugs que pierden las tildes (`/programas/cmicos-nuestros`, `la-maldicin-…`). Su arreglo cambia URLs, así que es una decisión de M09.
- **HTML muy pesado:** la portada tiene 1,2 MB y `/canales` 5,8 MB. Es rendimiento (M10), no un bloqueo.
- **Única referencia externa que Google conoce de la portada:** `teknologiz.com/globnewsx/…`, con apariencia de spam.

### Hipótesis (no demostradas, no implementadas)

- **H1. Valoración baja del dominio:** un sitemap dominado por páginas finas de la EPG reduce la calidad percibida de todo el sitio. Es la más coherente con los datos, pero no se puede probar con la API.
- **H2. Algo ocurrió en torno al 2026-09-01:**
  - Puede ser una actualización de Google o un cambio del sitio. Los commits del 30-ago al 2-sep incluyen el motor de afiliación, el chat, la revisión de AdSense y la migración de infraestructura.
  - No hay evidencia de un bloqueo técnico: robots permite el rastreo, la canonical es correcta, el HTTP responde 200 y el rastreo del 20-oct fue correcto.
- **H3. Acción manual o problema de seguridad:** la API no los expone. **El propietario debe revisar «Acciones manuales» y «Problemas de seguridad» en la interfaz de Search Console.**

No se inventa ninguna penalización. Una posición baja no se confunde con ausencia de indexación: aquí, sencillamente, no hay indexación.

## 5. SEO técnico verificado en producción

Comprobado como Googlebot móvil y de escritorio, antes y después del despliegue:

- **HTTP:**
  - las 14 guías, `/`, `/guias`, las categorías, `/canales` y `/guias/rankings` responden 200;
  - `http://` → `https://` y `www.` → apex con 301 de un salto;
  - una guía inexistente da 404 real con `noindex, nofollow` (sin soft 404).
- **Robots:**
  - `robots.txt` (gestionado por Cloudflare) tiene `User-agent: *` con `Allow: /` y declara el sitemap;
  - `X-Robots-Tag` y meta robots dicen `index, follow` en las guías;
  - no requiere autenticación.
- **SSR:** título, descripción, canonical propia, H1 y cuerpo completo del artículo están en el HTML inicial (5–10 k caracteres de texto por guía). Móvil y escritorio dan el mismo HTML.
- **Sitemaps:**
  - cada guía publicada aparece una vez, con su URL canónica;
  - los borradores quedan excluidos (75 borradores, 14 publicadas);
  - el `lastmod` de cada guía sale de `updatedAt`/`publishedAt`;
  - XML válido.
- **Enlaces internos:**
  - auditoría de 20 páginas y 130 destinos internos: 0 enlaces rotos (dos 503 transitorios provocados por la propia ráfaga dieron 200 al repetir);
  - `/guias` enlaza todas las guías y ninguna queda huérfana (2–11 enlaces entrantes cada una);
  - los enlaces a `/v2` son solo de afiliación: 302 con `nofollow`, `X-Robots-Tag: noindex`, nunca JSON.
- **Pendiente menor (M10):** `/canales/la_1` redirige con 301 a `/canales/la-1`; el sitemap ya usa `la-1`.

## 6. Integración de datos propios

**`GET /v2/editorial/facts`** (`EditorialFirstPartyFacts.ts`): solo lectura, pública, con limitación de peticiones, `X-Robots-Tag: noindex` y caché de 5 min.

- **`kind=channels&group=tdt|autonomico`:** catálogo de canales.
  - Solo los canales `registry` (curados) son elegibles. Los 60 autonómicos son `heuristic` y quedan retenidos.
  - El enunciado no lleva cifras ni URLs, y la lista se calcula sobre toda la ventana EPG, para que el texto citado sea estable al re-verificarlo.
- **`kind=schedule&channel=<id>&date=AAAA-MM-DD`** (hoy y los 3 días siguientes): emisiones de un canal en un día local.
  - Formato del enunciado: «LA 1 emite «Directo al grano» el miércoles, 28 de octubre de 2026 de 15:50 a 17:45 (hora peninsular)».
- **Campos de cada hecho:**
  - entidad, tipo y URL canónica;
  - `provenance` (editor GuíaTV, dataset y fuentes XMLTV de origen);
  - `recordedAt`, `validFrom`/`validUntil` y `timezone`;
  - `verification` (`registry`, `single-upstream`, `multi-upstream`), `freshness` y `eligible` con su motivo;
  - entidades relacionadas solo si la emisión tiene `entityId` verificado (hoy ninguna).
- **`format=text`:** es lo que cita el agente de investigación. Lleva una cabecera estable de procedencia, un dato vigente por línea y la fecha de generación marcada como no citable. El JSON público solo muestra los hechos elegibles y cuenta los retenidos por motivo.

**En el pipeline:**
- **Fuentes internas:** el runner añade el catálogo TDT a los temas de televisión lineal. La regex excluye televisores («tele 4K»), radio y parrillas de salida.
- **Reglas del redactor:**
  - datos propios solo si ayudan a la intención;
  - un horario lleva su día y su hora, y caduca;
  - nunca sacar de la parrilla datos de una película (año, director, reparto);
  - GuíaTV no es una segunda fuente.
- **`enrich <slug>`:** revisión re-certificada de una guía publicada por la política, por `revise-by-policy`.

**Valor diferencial (B5):**
- **Declaración del redactor:** `distinctValue` = qué obtiene el lector y con qué afirmaciones se prueba.
  - Va firmado en la procedencia: alterarlo rompe la firma.
  - La puerta bloquea si falta (desde `m11g-1`), si es genérico (< 40 caracteres) o si cita afirmaciones que el texto no usa.
  - La prueba tiene que llevar datos propios distintos del catálogo, o dos editores externos.
  - El crítico recibe la declaración y debe marcar como `high` un valor genérico, una paráfrasis de una sola fuente, datos o enlaces sin relación o un horario presentado como permanente.
- **Más estricto que antes:**
  - el catálogo de canales cuenta como contexto, no como valor propio;
  - GuíaTV ya no cuenta como editor en la puerta de «varias fuentes»;
  - un dato de la parrilla citado como algo distinto de `tv-schedule` se bloquea (`schedule-fact-not-dated`).
- **Sin cambios:** crítico, firma, verificación literal de citas, duplicados, puerta SEO y regla de dos editores en el descubrimiento. Las procedencias anteriores a `m11g-1` no se bloquean de forma retroactiva.

## 7. Procedencia, frescura y legalidad de los datos

| Dataset | Presente | Fiable para | No apto para | Frescura |
|---|---|---|---|---|
| Parrilla (`tv_read_airings`) | Sí, unos 12 000 registros al día; hoy y 2 días más | Qué se emite, dónde y cuándo | Metadatos de películas: datos erróneos documentados en M11-E; solo un 9,3 % tiene TMDB | Reconstrucción cada hora; un dato con más de 6 h sin refrescar se retiene |
| Catálogo de canales | Sí (22 TDT `registry`, 60 autonómicos `heuristic`) | Qué canales cubre GuíaTV | Afirmar la clasificación de los autonómicos | Estable |
| Emisiones de fútbol (`football_broadcast_mappings`) | Sí | Overrides manuales | Afirmar quién emite un partido, porque se infiere de la EPG | — (no se integra) |
| Disponibilidad en streaming (TMDB/JustWatch) | Caché de 24 h, sin colección | — | Afirmaciones publicadas: requiere la atribución de JustWatch y no tiene histórico | — (no se integra) |
| Entidades de películas y series | Modelo presente, flags apagados en producción | — | Enlazar una emisión con una entidad | — |

**Origen:**
- Las parrillas proceden de tres guías XMLTV comunitarias: iptv-epg.org, davidmuma/EPG_dobleM y tdtchannels.
- Cada hecho las nombra. GuíaTV las agrega, no las produce.
- Publicar en un artículo horarios que el sitio ya muestra no cambia la exposición. Aun así, **la reutilización editorial de esas guías (derecho sui generis sobre bases de datos) queda señalada al propietario** como decisión, no como hecho resuelto.

## 8. Piloto editorial

**Guía elegida:** `/guias/descargar-series-netflix-grabar-tele-copia-privada` (se publicó antes de #113).

**Línea base:** la copia del fichero de ejecución de la versión publicada está en `artifacts/m11g/baseline-run-descargar-series.json`.

**Por qué merecía una revisión:**
1. Le muestra al lector lenguaje interno del pipeline: «las afirmaciones disponibles no dan una respuesta cerrada».
2. Deja sin responder la mitad de su intención («¿es legal grabar la tele?»), aunque el BOE contiene el límite de copia privada (art. 31.2) y sus exclusiones (art. 31.3), legibles sin JS. Comprobado antes de lanzar.
3. Solo enlaza `/politica-editorial`.

No se trataba de forzar enlaces: los defectos eran reales.

**Ejecución:**
- Una sola ejecución: `enrich` desde el runner `m11g-1` (`artifacts/m11g/pilot-enrich.mjs`).
- Nota con los dos defectos; semilla del BOE con fragmento al art. 31; enlaces candidatos `/canales` y `/programacion-tv/que-ver-hoy`, ambos verificados por el runner (200, canonical propia).
- Catálogo TDT como fuente interna.
- Vía `revise-by-policy`, con el cupo del servidor en 4/10.

**Resultado: BLOQUEADO (HOLD correcto); no se publicó nada.**

| | Valor |
|---|---|
| Revisiones | 6 versiones (máximo 5 ciclos), todas con `revise` del crítico |
| Problemas por versión | 3, 4, 3, 6, 4 y 6 |
| Hallazgos de bloqueo de las puertas deterministas | 0 en todas |
| Afirmaciones | 25 (23 verificadas): art. 31.2 con sus tres condiciones (c1–c4), 31.3 con su exclusión de obras bajo demanda (c8) y la de bases de datos y programas (c9), condiciones de Netflix y 3 del catálogo de GuíaTV (c23–c25) |
| Valor medido | `internalClaims 0` (el catálogo es contexto, como está diseñado), 2 editores (BOE y Netflix) y 1 tabla |
| Valor declarado | «Pone frente a frente las condiciones legales de la copia privada con lo que permiten las condiciones de uso de Netflix, y explica por qué las descargas con licencia quedan fuera de ese límite…» |
| Último crítico | `high`: el texto no conecta el art. 31.3 con Netflix como promete el valor declarado (lo detectó la comprobación nueva de M11-G). `medium`: matiz «salvo autorización expresa» perdido en el resumen; conclusión jurídica sin respaldo; condiciones del 31.2 repartidas. `low`: la sección «Para planificar qué grabar» está poco ligada a la pregunta legal |
| Coste | 1,404 USD estimados, 20 llamadas |
| Guía pública | Sin cambios (versión 1, `updatedAt` 10:40:24) |
| Fichero de ejecución publicado | Intacto (mismo hash). El bloqueado se escribió al lado (`2026-10-28-145907-…`): la corrección F3 funcionó en producción |

**Conclusión del piloto:**
- **Puertas e infraestructura:** el sistema se comportó como debe. Encontró la evidencia que faltaba y la verificó de forma literal. Rechazó publicar un texto cuyo valor declarado no cumplía. Respetó la versión publicada.
- **Calidad del texto:** la revisión no llegó a un texto que el crítico aprobara dentro del límite de revisiones, así que la mejora no está publicada.
- **Datos propios:** el catálogo TDT aporta poco a esta intención legal; el crítico lo señaló. Es la observación esperada para un dato que es contexto, no valor.

**Decisiones:**
- No se reintentó ni se subió `EDITORIAL_MAX_REVISIONS` para «conseguir» un piloto. El encargo prohíbe forzarlo y saltarse un HOLD.
- No se usó un segundo candidato. Cualquier tema nuevo apto para datos de parrilla (`kind=schedule`) es, por naturaleza, efímero; publicarlo solo para demostrar el adaptador sería contenido de poco valor.

**EDITORIAL PILOT: NOT PASS.** La revisión se ejecutó y fue certificable en todas las puertas deterministas, pero no se publicó por el crítico.

**Siguiente paso:** un único `enrich` más en otra jornada, con la nota centrada en el `high` del crítico (relacionar el 31.3 con las descargas bajo licencia), es la forma ordinaria de cerrarlo. Queda a decisión del propietario.

## 9. Verificación SEO y de calidad

Ver §5 (técnica) y §6 (puertas). Smoke público tras el despliegue:
- **Índice:** solo `sitemap-blog.xml` lleva `lastmod` (2026-10-28).
- **`sitemap-blog.xml`:** 18 URLs.
- **`/v2/editorial/facts`:**
  - responde 200 en `text/plain` con `noindex`;
  - la parrilla de La 1 da 10 emisiones vigentes y retiene 11 ya emitidas;
  - `channel=$where`, `kind=films` y fechas fuera de la ventana dan 400.
- **Páginas:** `/`, `/guias`, `/guias/categoria/television` y dos guías dan 200 con canonical propia, `index` y H1 en el SSR. Una guía inexistente da 404 con `noindex`.

## 10. Métricas de Search Console y monitorización

- **Histórico:** cada inspección se guarda también como una instantánea en `editorial_gsc_inspection_history`, con el índice `{url, inspectedAt}`. El estado más reciente sigue en `editorial_gsc_inspections`, que ahora añade `referringUrls` y `crawledAs`.
- **Clase normalizada (`classifyInspection`):**
  - clases: `indexed`, `blocked`, `fetch-error`, `alternate-canonical`, `crawled-not-indexed`, `discovered-not-indexed`, `not-discovered` e `insufficient-evidence`;
  - una respuesta vacía o un error no cuentan como estado;
  - el texto de Google se conserva siempre.
- **Cadencia:** el monitor corre tras cada envío del sitemap, unas 4 veces al día. Una URL sin indexar se inspecciona como mucho una vez al día y una indexada cada 7 días. Con 14 guías son unas 14 inspecciones diarias frente a una cuota de 2000.
- **Vista del Admin:**
  - por guía: edad, franja de edad (0–7, 8–14, 15–28 y más de 28 días, que son los puntos de control), días desde el último rastreo, estrategia (`pipeline` o `manual`) y uso de datos propios;
  - por grupo: clase, edad, día de publicación, categoría, estrategia y datos propios;
  - Search Analytics queda como estaba: sin días inventados.
- **Recuento al cierre:**

  | Métrica | Valor |
  |---|---|
  | Guías técnicamente indexables | 14 |
  | Descubiertas por Google (última respuesta) | 3 |
  | Rastreadas | 0 |
  | Indexadas | 0 |
  | Bloqueos confirmados | 0 |
  | Impresiones y clics en `/guias/` (28 días) | sin datos |

  No se adelantan mediciones futuras. El siguiente punto de control útil es a 7, 14 y 28 días de cada publicación.

## 11. Skills y agentes usados de verdad

- **Orquestador (Opus 5.5):**
  - recuperó el contexto y verificó producción;
  - hizo el diagnóstico forense de Search Console y HTTP (Agent A del encargo);
  - implementó todos los cambios, ejecutó el piloto e hizo el release y este informe.
- **Agent B, auditoría de datos** (subagente Explore, solo lectura): inventario de datasets, campos y fiabilidad (§7).
- **Agent C, revisión SEO y editorial independiente** (subagente general-purpose, solo lectura y GET públicos): 0 BLOCKER, 3 HIGH, 4 MEDIUM y 4 LOW.
- **Agent D, revisión de seguridad y backend independiente** (subagente general-purpose, solo lectura): 0 BLOCKER, 0 HIGH, 4 MEDIUM y 9 LOW.
- **Skills:** ponytail (cambio mínimo completo). La comprobación tipo Playwright de SSR y HTTP se hizo con scripts `fetch` como Googlebot (`artifacts/m11g/*.mjs`), sin navegador, porque el frontend no cambió. No se usaron Impeccable ni UI UX Pro Max (no había un defecto de UI) ni la Indexing API.

## 12. Tests

| Suite | Resultado |
|---|---|
| Backend completo con Mongo (Windows), antes de las correcciones de revisión | 769/771: 1 fallo conocido de Windows (`content-certify.cli`, modo de fichero POSIX) y 1 omitido |
| Afectados tras las correcciones (editorial, GSC con Mongo, sitemap, `revise-by-policy` con Mongo) | 119/119 |
| Tests nuevos: hechos propios | 5 (DST, caducidad, frescura, solape contradictorio, confianza, entidad, sin metadatos de película, sin URLs, entrada estricta) |
| Tests nuevos: valor diferencial | 2 (ausente, genérico, no probado, firma, versión antigua, catálogo sin valor, GuíaTV no es editor, horario como estable) |
| Tests nuevos: GSC (Mongo) | cadencia de 7 días, histórico, resumen y 14 casos de clasificación |
| Tests nuevos: sitemap | `lastmod` del índice, invalidación selectiva y carrera de construcción |
| Runner (`editorial-cycle.test.mjs`) | 8/8 (nuevo: `enrich` rechaza la clave humana, los enlaces externos y la política parada; una revisión fallida conserva el fichero publicado) |
| Lint backend | limpio |
| CI PR #115 (`f0dd6ee`) | backend, frontend y verify en verde |
| CI `main` (`ad46e73`) | Build/test/perf (incluye `test:ops`) y SEO regression en verde |

## 13. Revisiones independientes

**SEO y editorial (Agent C).** Corregidos antes del merge:
- **HIGH:** el `lastmod` del índice heredaba «hoy» de los hijos de la parrilla. Ahora solo se fecha el blog.
- **HIGH:** una frase del catálogo superaba la puerta de valor. El catálogo es ahora contexto y el valor declarado exige datos propios con valor o dos editores.
- **MEDIUM:** `/canales` se imponía como enlace obligatorio y la regex era demasiado amplia.
- **LOW:** cifra que cambia a diario, URL en el enunciado y `new URL` sin protección.
- **Coherencia:** un horario en una guía permanente ahora se rechaza con una regla determinista.

Documentados fuera de alcance: `/programas` como 85 % del sitemap con slugs sin tildes (HIGH, M09) y `/canales` de 5,8 MB (MEDIUM, M10).

**Seguridad y backend (Agent D).** Corregidos:
- **M1:** GuíaTV ya no cuenta como editor.
- **M2:** texto citable sin marca de tiempo y catálogo sobre toda la ventana EPG.
- **M3:** carrera al invalidar con una construcción en curso.
- **M4:** el índice ya solo construye el hijo blog.
- **LOW 1, 2, 3, 4, 5, 6 y 8.**

LOW aceptados:
- **L7:** quien tiene la clave de firma podría firmar una versión antigua sin `distinctValue`. Esa clave solo la tiene el pipeline.
- **`confidence: high`** de la EPG se basa en la presencia de imagen, no en la exactitud del horario. Se compensa con la retención por solape y por frescura.
- **Invalidación por proceso:** producción ejecuta un único proceso de API.

## 14. PRs y commits

| PR | Squash | Commits |
|---|---|---|
| #115 | `ad46e73` | `b3aba6f` (`lastmod` del sitemap e invalidación); `d4a0392` (histórico y clases GSC); `dc7e3ce` (adaptador de hechos); `fcaa396` (valor diferencial y runner); `35579ef` (fichero de ejecución); `f0dd6ee` (correcciones de las revisiones) |
| docs | (este PR) | este informe, `GUIATV-MILESTONES.md` y `CURRENT-STATE.md` |

El merge se hizo con `--match-head-commit f0dd6ee…`, solo después de que el CI del PR existiera y terminara en verde sobre ese head. Así no se repitió la carrera del #113.

## 15. Release y smoke

- **Despliegue:** `deploy-artifact.yml`, ejecución 40710538977, release `20261028155613`. El `gitSha` `ad46e73…` está verificado en el host. `guiatv-api` y `guiatv-ssr` están activos con `NRestarts=0` y `/v2/health` da 200.
- **Smoke:** ver §9.
- **Rollback:** release `20261028111735`. No hay migraciones de datos; la colección de histórico es nueva y solo de adición.

## 16. Estado de la publicación autónoma

- **Tarea:** `GuiaTV\EditorialCycle` sin cambios (08–20 h cada 3 h). El último ciclo, de las 14:00, terminó con resultado 0.
- **Runner:** `guiatv-runner` actualizado a `main@ad46e73` y recompilado (`PIPELINE_VERSION = m11g-1`).
- **Sin cambios:** política activa, límite de 10 al día aplicado en el servidor, presupuesto `unlimited` con telemetría, parada de emergencia, procedencia firmada, borradores privados, lock e idempotencia.
- No se ha añadido ninguna dependencia de aprobación humana.

## 17. Bloqueos pendientes

- **Indexación del dominio** (M09/M10): ver §4, H1–H3. Lo que más impacto tendría: decidir qué hacer con las ~700 URLs `/programas` del sitemap y corregir sus slugs sin tildes. Es decisión de URL de M09, no de este hito.
- **Propietario:**
  - revisar Acciones manuales y Problemas de seguridad en Search Console (la API no los expone);
  - decidir sobre la reutilización editorial de las guías XMLTV.
- **Piloto editorial:** sin publicar (§8). Un `enrich` más en otra jornada, centrado en el `high` del crítico, queda a decisión del propietario.
- **Prompts del redactor y del crítico:** este piloto, como los canarios de M11-E2, no convergió en 5 ciclos con problemas que cambian de una versión a otra. Es una línea de mejora del pipeline, no un defecto de las puertas.
- **M11-B:** sigue PARTIAL (M04-B sin cumplir).

## 18. Puerta de entrada a M12

**NO-GO**, sin cambios.
- M10 parcial y M11-B parcial.
- Sin kill switch a nivel de índice ni gate por URL para familias programáticas.
- Google no indexa el dominio: ampliar con páginas programáticas iría justo en contra de la hipótesis H1.

## 19. Siguiente hito (uno solo)

**M09-B: saneamiento del sitemap y de las páginas `/programas` para recuperar la indexación del dominio.**

Decisión del propietario sobre la propiedad de URL de las ~700 páginas de la EPG:
- sacar del sitemap las efímeras y las de episodio;
- corregir los slugs sin tildes con 301;
- consolidar con `/peliculas` y `/series` las 563 que ya tienen gemela.

Después, medir en Search Console (con el histórico de M11-G) el efecto sobre la portada y las guías durante 28 días antes de subir la cadencia editorial.
