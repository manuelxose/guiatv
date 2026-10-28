# M09-C: consolidación HTTPS e indexación estable de películas y series

Fecha: 2026-10-28. PR #119 (implementación, squash `66c6b79`). Evidencia en `artifacts/m09c/` (no versionado).

## 1. Resumen ejecutivo

| Veredicto | Estado | Base |
|---|---|---|
| ENGINEERING PASS | **PASS** | Política implementada, probada, revisada de forma independiente y desplegada (§5, §6, §10, §11) |
| HTTPS CONSOLIDATION PASS | **PASS** | No quedan señales HTTP vivas. Se corrigió el único defecto (HSTS ausente en las respuestas 200) (§3, §4) |
| MOVIE/SERIES POLICY PASS | **PASS** | La indexabilidad ya no depende de que la obra se emita hoy. La calidad de contenido es obligatoria (§6) |
| CANONICAL CONSISTENCY PASS | **PASS** | Ningún `/programas` declara como canonical una obra `noindex`: comprobado en producción (§9) |
| SITEMAP QUALITY PASS | **PASS** | `sitemap-works.xml`: 2.140 URL; una muestra de 150 dio 150 `indexable`, y 20 de 20 pasaron SSR. Sin `lastmod` inventado (§8) |
| PRODUCTION PASS | **PASS** | `20261028193209` @ `66c6b79`. CI de `main` en verde, incluida la regresión SEO. 0 reinicios. Escalonado 10 % → 50 % → `on` (§14) |
| GOOGLE HTTPS CANONICAL | **PENDING** | En la inspección, Google sigue eligiendo `http://` para la portada. Es un estado histórico que se revisará tras el próximo rastreo (§15) |
| ORGANIC RECOVERY | **PENDING** | Sin evidencia todavía. Checkpoints: 4, 11 y 25 de noviembre (§15) |
| M09 | **PARTIAL** | Los criterios de ingeniería se cumplen; falta el efecto en Google (§16) |
| M12 | **NO-GO** | §17 |

**Conclusiones principales:**

1. **No queda ninguna señal HTTP en conflicto.**
   - HTTP → HTTPS y www → apex responden 301.
   - El canonical, `og:url`, JSON-LD, el sitemap y `robots.txt` usan todos `https://guiaprogramaciontv.com`.
   - La portada `http://` indexada corresponde al rastreo del **20-oct**. Es una decisión de Google pendiente de reprocesar, no un defecto vivo.
2. **El defecto real era otro.** 33 de 35 fichas de obra con impresiones en GSC (90 días) se servían `noindex`, porque la regla exigía emisiones actuales. Un ejemplo es `/peliculas/cenicienta`: está indexada en Google y el siguiente rastreo la habría retirado.
3. **La política nueva no infla el sitemap.**
   - Hay 5.707 fichas indexables a nivel de página.
   - El sitemap solo lista las 2.140 que también tienen emisiones registradas por GuíaTV, que es valor propio y estable.

## 2. Línea base verificada

- **Repositorio:** `main` en `01a0288` (docs M09-B). La rama M09-C parte de ahí.
- **Producción:**
  - release `20261028185153` @ `30d3e75`;
  - `PROGRAMME_SEO_POLICY=on`;
  - servicios `guiatv-api` y `guiatv-ssr` activos.
- **nginx:** `/etc/nginx/sites-enabled/guiatv.conf` era idéntico byte a byte a `infra/nginx/guiatv.conf`.
- **Sitemap:** 167 URL (static 23, channels 82, programs 44, blog 18); 0 `/peliculas`, 0 `/series`.
- **Search Console:** propiedad `sc-domain:guiaprogramaciontv.com`, consultada en solo lectura con la cuenta de servicio (§15).

## 3. Forense HTTP/HTTPS

Medido desde fuera, a través de Cloudflare, con UA Googlebot; la contraprueba se hizo en el origen.

| # | Señal | Observación | Clasificación |
|---|---|---|---|
| 1 | `http://` apex | 301 → `https://…/` en un salto | Configuración correcta |
| 2 | `http://www` | 301 → `https://www` → 301 → apex (2 saltos: Cloudflare «Always Use HTTPS» actúa antes que el origen) | Correcta pero mejorable (§17); sin bucles |
| 3 | `https://www` | 301 → apex | Correcta |
| 4 | TLS | Let's Encrypt `guiaprogramaciontv.com` sirve apex y www | Correcta |
| 5 | HSTS | Solo aparecía en los 301 y en el sitemap. **Faltaba en toda respuesta 200 HTML, API y estáticos**: en nginx 1.24, un `add_header` dentro de un `location` anula los del `server` | **Defecto confirmado → corregido** |
| 6 | X-Forwarded-Proto | `$scheme`. Cloudflare → origen va por 443, así que el SSR ve `https` | Correcta |
| 7 | Canonical SSR | Siempre `https://guiaprogramaciontv.com…`, una sola etiqueta | Correcta |
| 8 | `Link: rel=canonical` HTTP | No se emite | Correcta (sin señal duplicada) |
| 9 | JSON-LD | 0 URL `http:` o `www` (portada, fútbol, plataformas, películas, guías) | Correcta |
| 10 | Sitemaps | 167/167 URL en `https://` apex | Correcta |
| 11 | robots.txt | `Sitemap: https://…` | Correcta |
| 12 | Enlaces internos y `og:url` | 0 referencias `http://` o `www` en el HTML muestreado | Correcta |
| 13 | hreflang | No existe | No aplica |
| 14 | Contenido mixto | 0 recursos `http:` (también comprobado con Playwright) | Correcta |
| 15 | ACME | `http://…/.well-known/acme-challenge/*` se sirve sin redirección (404 en la sonda) | Correcta; no se tocó |
| 16 | GSC portada | `http://`: «Enviada e indexada», canonical de Google = `http://`. `https://`: «Rastreada: actualmente sin indexar», canonical de Google = `https://`. Ambas con rastreo del 2026-10-20 | **Observación histórica de Google** |
| 17 | GSC otras páginas | `/deportes/futbol`, `/plataformas` y `/peliculas/cenicienta` están indexadas como `https://`; sus variantes `http://` son «Google no reconoce esta URL» | Correcta |

La muestra de páginas indexadas y no indexadas (§15) no muestra variantes HTTP fuera de la portada. Por qué Google sigue con `http://` en la portada es **inconcluso**. Lo más probable es que conserve la elección anterior hasta reprocesarla; no hay evidencia de una señal viva que la sostenga.

APIs, OAuth y webhooks: no se cambió ninguna redirección. HTTP → HTTPS ya era global, incluido `/v2/*`, y lo hacía Cloudflare. Solo se añadió una cabecera de respuesta.

## 4. Causas confirmadas de señales de protocolo en conflicto

- **HSTS ausente en las respuestas 200**, por la herencia de `add_header` en nginx. Es la única causa confirmada.
- **No hay ninguna señal de canonical HTTP viva.** Lo que muestra GSC es histórico, y no se aplicó `noindex` a variantes HTTP.

## 5. Cambios en la arquitectura canonical pública

- `infra/nginx/guiatv.conf`: HSTS repetido en cada `location` que define sus propias cabeceras (`/v2/`, `/assets/`, `/media/`, estáticos, `/`).
  - El resto lo hereda.
  - El snippet `guiatv_proxy.conf` no tiene `add_header`, comprobado en el servidor.
  - Ni el backend ni el SSR emiten HSTS, así que no se duplica.
- No se añadió ninguna redirección nueva: las existentes ya eran correctas.
- `ProgrammeSeoPolicy`: un `/programas` de disposición `work` cuya obra no supera el gate estable conserva su propio canonical y pasa a `noindex, follow`. Ya no apunta a una página `noindex`.

## 6. Política de elegibilidad de películas y series

Código: `apps/backend/src/application/services/WorkSeoPolicy.ts`. Interruptor: `WORK_SEO_POLICY=off|canary|on` y `WORK_SEO_CANARY_PERCENT`, con el mismo hash de cohorte que M09-B.

**Identidad.** Se leen las filas de `media_catalog` con la clave del slug, que es la misma lectura que hace la página.

- Solo hay identidad probada si todas las filas del mismo tipo que responden a ese slug tienen el mismo id TMDB que la página.
- Si existe un homónimo (otro id), la disposición es `ambiguous`.
- Si la página se resolvió por búsqueda TMDB en vivo, sin fila local, también es `ambiguous`.

**Contenido** (umbrales de Phase 3B, `QUALITY_THRESHOLDS`):

- ficha completa de TMDB (`lastEnrichedAt`);
- sinopsis de 300 caracteres o más;
- géneros y póster;
- director, o al menos 3 actores del reparto;
- en películas, además, año y duración.

| Condición | Disposición | Robots | Sitemap |
|---|---|---|---|
| Identidad y contenido OK, con o sin emisión | `indexable` | `index, follow` | Sí, si GuíaTV la ha emitido alguna vez |
| Identidad OK, contenido insuficiente, con emisión actual | `airing` | `index, follow` mientras dure | No |
| Identidad OK, contenido insuficiente, sin emisión | `thin` | `noindex, follow` | No |
| Homónimo o identidad no probada | `ambiguous` | `noindex, follow` | No |
| Slug legado sin plegar acentos | `variant` | `noindex, follow` | No |

Notas sobre la política:

- **Fallos de lectura.** Si falla la lectura del catálogo, se lanza un error: la página responde 503 sin caché y nunca un `noindex` cacheable. `findByNormalizedTitles` traga errores, por eso no se usa aquí.
- **Emisión actual.** La emisión deja de ser obligatoria. Aun así cuenta como valor propio, igual que el criterio `original_value` de Phase 3B: sin esto, 406 fichas que hoy se indexan por estar en emisión habrían pasado a `noindex`.
- **Contenido.** No se genera texto ni se infiere ningún dato.

## 7. URL afectadas y recuentos

Dry run de solo lectura sobre producción (`artifacts/m09c/dryrun.js`, réplica exacta de la función) con 17.993 filas de catálogo y 855.277 emisiones (histórico desde el 2026-03-19):

| | Películas | Series |
|---|---|---|
| Rutas de obra posibles | 13.473 | 4.088 |
| `indexable` | 4.803 | 904 |
| `thin` | 8.113 | 3.024 |
| `ambiguous` | 557 | 160 |
| Antes indexables (con emisión hoy o después; aproximado) | 537 | 202 |
| Pasan a indexables sin emisión actual | 4.554 | 845 |
| Con emisión y contenido pobre → se mantienen indexables (`airing`) | 276 | 130 |
| **Pierden `index`**: homónimos con emisión | **12** | **13** |

Las 25 fichas que pierden `index` son homónimos, por ejemplo `/series/chicago-pd` y `/series/rubi`. La página puede mostrar la obra equivocada, así que el encargo pide tratamiento conservador. Se mantienen accesibles, con `follow`.

Evidencia GSC:

- Hay 35 fichas de obra con impresiones en 90 días; 33 de ellas se servían `noindex` antes del despliegue (`artifacts/m09c/gsc-works-20261028.tsv`).
- Con la política en `on`, `cenicienta`, `el-cliente`, `disforia`, `el-puente-sobre-el-rio-kwai` y el resto de fichas con contenido suficiente pasan a `index`.

## 8. Sitemap antes y después

| Hijo | Antes | Después |
|---|---|---|
| static | 23 | 23 |
| channels | 82 | 82 |
| programs | 44 | 44 |
| blog | 18 | 18 |
| **works** (nuevo) | — | **2.140** (1.963 películas, 177 series) |
| Total | 167 | 2.307 |

Reglas de `sitemap-works.xml`:

- Solo entra una obra `indexable`, de la cohorte activa, de la que `tv_read_airings` registra al menos una emisión.
- Ese histórico no se poda (`TvReadModelBuilder` solo reescribe por fecha), así que una emisión que termina no saca la obra del sitemap.
- Sin `lastmod`: el refresco del catálogo no es un cambio de contenido.
- El hijo aparece en el índice solo cuando tiene URL.
- Si su construcción falla, falla el índice entero, que se sirve desde su última copia buena. Así nunca se cachea un índice al que le falte el hijo `works`.

No se restaura el inventario de 803 URL: los 44 `/programas` siguen siendo los `standalone` de M09-B.

## 9. Coherencia de los cross-canonicals

- Destinos `workPath` presentes en emisiones de hoy en adelante: 408.
  - 181 apuntan a una obra `indexable`, que mantiene el canonical cruzado.
  - 227 apuntan a una obra `thin`: el `/programas` correspondiente queda con canonical propio y `noindex, follow`.
- La ficha de obra de esos 227 sigue indexable como `airing` mientras se emita. Hay una sola página en el índice y ningún canonical apunta a una página `noindex`.

Verificado en producción con la política en `on`:

| Página | Robots | Canonical |
|---|---|---|
| `/programas/gladiator` | `index` | `/peliculas/gladiator` (`indexable`, en el sitemap) |
| `/programas/la-ley-de-jenny-pen` | `noindex` | `/programas/la-ley-de-jenny-pen` (la obra es `airing`) |
| `/programas/american-badger` | `noindex` | `/programas/american-badger` (la obra es `airing`) |

## 10. Tests y evidencia de navegador

- **Backend**, todos en verde en local y en CI:
  - `WorkSeoPolicy.test.ts` (7): película sin emisión indexable; serie estable entre actualizaciones del EPG; las fichas pobres siguen `noindex`; `airing`; homónimos nunca fusionados; tipo equivocado rechazado; slug variante; cohorte; programa → obra `noindex` no se canonicaliza.
  - `WorkSeoPolicy.mongo.test.ts`: sitemap y página dan el mismo veredicto sobre las mismas filas; las emisiones antiguas cuentan; la categoría decide el tipo; política `off` o canario inválido = nada.
  - `SitemapController.test.ts` (21): hijo `works`, sin `lastmod`, índice condicionado; un fallo del hijo hace fallar el índice.
  - `ProgrammeSeoPolicy` y las suites de `CatalogService`, incluidas las de Mongo real (`slug-lookup` y `legacy-enrichment`, con Mongo 7 desechable en local).
- **Frontend:**
  - `catalog-indexability.spec.ts`;
  - `catalog-detail.programme-seo.spec.ts`: película verificada sin emisión → `index`, un solo canonical; ficha pobre → `noindex`.
- **CI:**
  - PR #119: `backend`, `frontend` y `verify` en verde sobre la cabeza revisada `6747db8`.
  - `main` @ `66c6b79`: «Build, test, and performance budgets» y «SEO regression» en verde.
- **Playwright** contra producción (`https://`, escritorio y móvil a 390×844):
  - páginas: portada, `/peliculas/cenicienta` (sin emisión), `/series/una-nueva-vida` (sin emisión), `/programas/gladiator`, `/peliculas/el-puente-sobre-el-rio-kwai`, `/guias` y `/guias/rankings`;
  - resultado: HTTP 200, un canonical `https://` por página, robots esperados, 0 recursos inseguros, 0 URL `http:` o `www` en JSON-LD, 0 errores JS de página;
  - el menú móvil muestra 13 enlaces.
  - En consola hubo 503 transitorios de `/storage/channel_icons/*`, generados por Cloudflare ante la ráfaga de pruebas. El origen y la API respondieron 200 y la API no registró ningún 5xx. Se volvió a comprobar en público pasados 20 s: 200.
- **HSTS público tras el cambio:** presente en HTML, `/v2/health`, sitemaps, `robots.txt` y en el 301 de www. Un JS inmutable seguía sin la cabecera en el borde, pero el origen sí la envía; HSTS es por host y lo fija el documento.

## 11. Revisión independiente

Un subagente revisor sin acceso a mis conclusiones recibió el diff y el código conectado, con tres enfoques: SEO técnico, backend y datos, y seguridad y producción. **0 BLOCKER, 0 HIGH.**

| Hallazgo | Severidad | Resolución |
|---|---|---|
| Un fallo del hijo `works` cacheaba el índice sin él durante 6 h | MEDIUM | **Corregido**: el índice falla y se sirve desde la última copia buena; con test |
| Inestabilidad ante la llegada de un homónimo (una obra indexada pasa a `ambiguous`) | MEDIUM | **Aceptado y documentado**: falla de forma segura; se vigila en los checkpoints |
| Memoria del build del sitemap (18 k filas con reparto completo) | MEDIUM | **Corregido**: proyección `castSummary: {$slice: 3}` |
| Un blip de Mongo durante la búsqueda local puede dar un `ambiguous` legítimo tras una búsqueda TMDB | LOW | Aceptado: la página mostraría otra obra, así que `noindex` es correcto |
| `workPathIndexable` tragaba los errores | LOW | **Corregido**: propaga el error, igual que la ficha de obra |
| Obras resueltas solo por búsqueda TMDB en vivo pasan a `noindex` aunque se emitan | LOW | Aceptado: sin fila local no hay identidad probada |
| Rollback: `/sitemap-works.xml` sigue enrutado (urlset vacío) | LOW | Aceptado: deja de figurar en el índice. Cloudflare no lo cachea (`DYNAMIC`) |
| Falta de tests de `indexableWorkPaths` y del fallo del índice | — | **Añadidos** |

## 12. Skills y agentes realmente usados

- **Ponytail:** cambio mínimo, reutilizando el hash de cohorte, los umbrales de Phase 3B, la clave de slug de M10 y el patrón de sitemap de M09-B.
- **Context-mode:** sondas HTTP y análisis sin volcar los cuerpos.
- **Playwright MCP:** recorridos de navegador en producción.
- **Un subagente de revisión independiente** (general-purpose).

No se usaron los agentes A–D por separado. La forense, la implementación y la verificación fueron secuenciales y por un solo implementador. La revisión sí fue independiente: el revisor recibió el código, no las conclusiones. No había skills de GSC ni de SEO instaladas; se usaron la integración GSC existente (`google-auth-library` de la release) y los scripts de solo lectura de M09-B.

## 13. PR y commits

- PR #119, squash `66c6b79` («M09-C: stable work-page indexation, cross-canonical consistency, HSTS»), a partir de dos commits:
  - `6301e76`: implementación;
  - `6747db8`: correcciones de la revisión.
- PR de documentación: este documento, `GUIATV-MILESTONES.md` y `scripts/gsc-canonical-checkpoint.mjs`.

## 14. Release de producción y rollback

1. Despliegue por artefacto (`deploy-artifact.yml`, run 40745800782) → `20261028193209` @ `66c6b79`, con `release.json` verificado.
   - Política ausente, por tanto `off`: sin cambio de comportamiento.
   - `package-lock.json` sin cambios.
2. `api.env`: backup `/etc/guiatv/api.env.bak-m09c-20261028T183308Z`, después `WORK_SEO_POLICY=canary` y `WORK_SEO_CANARY_PERCENT=10`.
   - Sitemap `works` con 203 URL, igual que la predicción del dry run.
   - 25 de 25 URL del sitemap con SSR `index` y canonical propio.
3. Canario al 50 %: 1.110 URL, igual que la predicción; 25 de 25.
4. `WORK_SEO_POLICY=on`: 2.140 URL, igual que la predicción.
   - Muestra aleatoria de 150: 150 `indexable` en la API, 20 de 20 en SSR.
   - Casos de §9 verificados.
   - `WORK_SEO_CANARY_PERCENT=50` queda en el fichero, inerte con `on`.
5. nginx: backup `/etc/nginx/guiatv.conf.bak-m09c-20261028T183731Z`, copia del fichero de `main` (diff = solo las 7 líneas HSTS), `nginx -t` correcto, `reload`.
6. Estado final:
   - `guiatv-api` y `guiatv-ssr` activos, `NRestarts=0`;
   - `PROGRAMME_SEO_POLICY=on` intacto;
   - la tarea `GuiaTV\EditorialCycle` está `Ready`, última ejecución a las 17:00 con resultado 0, próxima a las 20:00.

M11-E2 y M11-F no se tocaron: descubrimiento, publicación automática, límite de 10 al día, presupuesto, telemetría, crítico, parada de emergencia y procedencia siguen igual. Enlaces internos editoriales: las 14 guías publicadas tienen 0 enlaces `http://` o `www` y 48 enlaces relativos, que se resuelven en el origen `https://`. Hoy ninguno apunta a una ficha de obra.

**Rollback** (ejecutar en `contabo`):

```sh
# Política de obras: volver al comportamiento pre-M09-C (indexable solo con emisiones). El sitemap «works» queda vacío y sale del índice.
sudo sed -i 's/^WORK_SEO_POLICY=.*/WORK_SEO_POLICY=off/' /etc/guiatv/api.env && sudo systemctl restart guiatv-api
# o restaurar el fichero completo:
sudo cp -p /etc/guiatv/api.env.bak-m09c-20261028T183308Z /etc/guiatv/api.env && sudo systemctl restart guiatv-api
# HSTS en nginx:
sudo cp -p /etc/nginx/guiatv.conf.bak-m09c-20261028T183731Z /etc/nginx/sites-available/guiatv.conf && sudo nginx -t && sudo systemctl reload nginx
# Código: la release anterior sigue en /var/www/guiatv/releases/20261028185153 (procedimiento de rollback habitual).
```

Las cachés SSR y de nginx expiran en 5–30 min. El rollback de código y configuración ya se practicó en el escalonado: `off` es el estado del paso 1, verificado. Un rollback técnico **no** revierte de inmediato las decisiones de indexación que Google ya haya tomado.

## 15. Línea base de Search Console y checkpoints

La línea base (2026-10-28 18:22 UTC) está en `artifacts/m09c/gsc-baseline-20261028.json`; las obras con impresiones, en `gsc-works-20261028.tsv`. Inspección de URL en solo lectura:

| URL | Estado | Canonical de Google | Último rastreo |
|---|---|---|---|
| `http://guiaprogramaciontv.com/` | Enviada e indexada | `http://…/` (el declarado es `https://…/`) | 2026-10-20 |
| `https://guiaprogramaciontv.com/` | Rastreada: actualmente sin indexar | `https://…/` | 2026-10-20 |
| `https://www…/` | Página con redirección | apex | 2026-06-14 |
| `/deportes/futbol` | Enviada e indexada | igual | 2026-10-24 |
| `/plataformas` | Enviada e indexada | igual | 2026-10-06 |
| `/peliculas/cenicienta` | Enviada e indexada | igual | 2026-07-22 |
| `/series/modern-family` | Excluida por `noindex` | igual | 2026-10-19 |
| `/peliculas/el-regreso-de-la-momia`, `/series/una-nueva-vida`, `/series/chicago-pd`, `/guias` | Google no reconoce esta URL | — | — |

Search Analytics de 90 días por URL exacta:

- `https://`: 49 páginas, 892 impresiones, 5 clics.
- `http://`: 1 página (la portada), 47 impresiones, 1 clic.
- La portada `https://` acumula 575 impresiones en posición 57,8.

**Checkpoints** (en el servidor, solo lectura):

```sh
scp scripts/gsc-canonical-checkpoint.mjs contabo:/tmp/ && ssh contabo 'set -a; . /etc/guiatv/api.env; set +a; cd /tmp && node gsc-canonical-checkpoint.mjs / /deportes/futbol /plataformas /peliculas/cenicienta /peliculas/el-regreso-de-la-momia /series/una-nueva-vida /series/modern-family /series/chicago-pd /guias'
```

| Fecha | Qué mirar |
|---|---|
| **2026-11-04** | `lastCrawlTime` posterior al 28-oct en la portada y en `/peliculas/cenicienta`; Google ve `index` en la ficha; GSC ha leído `sitemap-works.xml` |
| **2026-11-11** | Canonical elegido por Google para la portada (`http` → `https`); cobertura de una muestra de URL del sitemap `works` |
| **2026-11-25** | Impresiones `https://` frente a `http://`; impresiones de `/peliculas` y `/series`; homónimos que hayan cambiado a `ambiguous` |

**Indexación manual:** preparada para una sola solicitud desde el inspector de URL de GSC sobre `https://guiaprogramaciontv.com/`, porque la coherencia HTTPS ya está confirmada. Es una acción de la interfaz del propietario y no se ha hecho. No usar la Indexing API, ni repetir la solicitud.

No se asegura que Google haya cambiado nada: la portada sigue elegida como `http://` hasta que Google la vuelva a rastrear.

## 16. Estado de M09

**PARTIAL.**

- Ya se cumple:
  - la política de indexación está documentada, también para `/peliculas` y `/series`;
  - la regla de robots de las obras es estable;
  - los canonical son coherentes;
  - `seo-regression` en verde;
  - ninguna página pobre es indexable sin valor propio (ni contenido suficiente ni emisión actual).
- Falta el efecto observado en Google: la portada HTTPS y la indexación de las fichas de obra, según los checkpoints de §15.

## 17. Bloqueos pendientes de M10 y M12

- **M10 (PARTIAL):**
  - el grafo de enlaces todavía no enlaza de forma estable las fichas `indexable` sin emisión. Hoy solo se descubren por el sitemap, por las búsquedas o por los relacionados;
  - las 717 obras `ambiguous` necesitan desambiguación de identidad, por ejemplo con el año en el slug, que es una decisión de URL.
- **M12 (NO-GO):**
  - siguen M10 y M11-B (M04-B) parciales;
  - no hay interruptor de indexación por lotes;
  - Google aún no ha validado nada de M09.
  - M09-C no cambia esa evaluación.
- **Mejoras menores fuera del repo:**
  - `http://www` hace 2 saltos porque Cloudflare «Always Use HTTPS» actúa antes que el origen. Una regla de redirección en Cloudflare (`http://www/*` → `https://guiaprogramaciontv.com/$1`) lo dejaría en uno;
  - preload de HSTS: solo si el propietario lo decide.

## 18. Siguiente hito recomendado

**M10-B: enlazado interno estable hacia las fichas de obra indexables**, con desambiguación de homónimos. Antes conviene revisar el checkpoint del 2026-11-04: si Google no rastrea `sitemap-works.xml` o ve `noindex` donde no corresponde, eso pasa por delante.
