# M10-B: enlazado interno, coherencia de canonical e identidad de entidades

Fecha: 2026-10-28. PR #124 (squash `2f6013d`), desplegado como `20261028223254` (run 40772569024). Evidencia en `artifacts/m10b/` (no versionado; copia en los ficheros del proyecto `m10b/`).

## 1. Veredicto

| Criterio | Estado | Base |
|---|---|---|
| Duplicado Modern Family resuelto | **PASS** | §2, §6 |
| Misma lógica para toda la clase (`ambiguous`) | **PASS** | §3 |
| Enlaces verificados estables, homónimos protegidos, sin asociaciones nuevas | **PASS** | §3, §4 |
| SSR con enlaces rastreables | **PASS** | §5, §6 |
| Profundidad de rastreo mejorada de forma medible | **PASS** | §7 |
| Sin nuevas huérfanas indexables | **PASS** (garantía del grafo + test; sin crawl completo) | §4, §7 |
| Sitemap, robots y canonical coinciden | **PASS** | §3, §6 |
| Tests y CI sin regresiones | **PASS** | §5 |
| Producción verificada | **PASS** | §6 |
| **M10-B** | **PASS** (ingeniería) | |

La indexación y el posicionamiento en Google son resultados externos. Se miden en los checkpoints de GSC de M09-C §15 y no forman parte de este veredicto.

## 2. Diagnóstico de Modern Family

- `/programas/modern-family` carga una emisión de Comedy Central con `tmdbId 1421`. Ese id viene de la búsqueda TMDB por título en `SyncEPGData` y la emisión no tiene `mediaId`. Por eso la puerta M10 (`VerifiedWorkLinks`) la rechaza con `no_media_id`: falta `workPath` y la disposición M09-B es `ambiguous`.
- `/series/modern-family` sí tiene la identidad probada: una sola fila local con TMDB 1421 y el contenido completo, así que es `indexable`.
- **Causa:** M09-B dejaba `ambiguous` intacto (canonical propio, `index`) y la página de programa renderiza el registro TMDB 1421. Resultado: dos representaciones indexables del mismo registro. Además, la ficha de la serie enlazaba el programa con la anchor «Horarios de Modern Family», que afirma una identidad que nadie ha verificado.
- **Caso B (identidad no verificada).** No se canonicaliza ni se enlaza la serie desde el programa: el título igual no prueba nada.
- **La clase completa:** el 28 de octubre había 506 emisiones de Cine/Series con `tmdbId` sin verificar, frente a 289 enlazadas; el 29, 541 frente a 303. Lo que mide `/v2/tv/read/schedule` es un recuento por emisión, sin el desglose por motivo de rechazo (ese desglose solo está en el log del build del servidor).

## 3. Política (código)

| Pieza | Antes | Ahora |
|---|---|---|
| `ProgrammeSeoPolicy`, `ambiguous` | canonical propio, `index` | canonical propio, **`noindex, follow`**, como una obra `ambiguous` en `WorkSeoPolicy` |
| Indexada con su propia URL | `standalone` + `ambiguous` | solo `standalone`, que coincide con `sitemap-programs.xml` |
| Ficha de obra → `/programas` (`programmePath`) | con el mismo `tmdbId` y tipo | además, el programa debe tener canonical propio y no ser `ambiguous` (política aplicada) |
| Rail «Relacionados» de la ficha | TMDB discover «popular» (slugs que luego resuelve una búsqueda) y, en el cliente, un fallback de títulos populares | solo obras de `WorkSeoPolicy.indexableWorks` (el conjunto de `sitemap-works`), del mismo tipo, primero por género (`RelatedWorks.ts`) |
| Emisión `/contenido/program:*` → `/programas/:slug` | nunca | solo si esa página es `standalone` y carga el mismo título (caché de 10 min por título) |

No cambian:
- la puerta por emisión de M10 (`VerifiedWorkLinks`);
- `WorkSeoPolicy` (M09-C/D);
- los sitemaps (programas 44, obras 3.691);
- las redirecciones www→apex de M09-C;
- Cloudflare, nginx, la publicación editorial y M12.

## 4. Grafo de obras relacionadas

- **Anillos:** para cada semilla (3) y cada género, las obras del conjunto se ordenan en un anillo por `sha1(semilla, género, tipo, id)`, y cada obra enlaza a su sucesora.
- **Ronda garantizada:** la sucesora en el anillo semilla 0 de cada género y la del anillo de todo el tipo. Así, toda obra del conjunto recibe un enlace de otra obra indexable, también las que no tienen géneros o tienen más de 8. Después vienen más obras del mismo género y, al final, el relleno por tipo.
- **Lectura:** el conjunto se lee al arrancar y cada 6 h en segundo plano (`RelatedWorkIndex`); una petición nunca espera esa lectura. Si la lectura falla, se conserva el último conjunto bueno; si no hay ninguno, el rail queda vacío y nunca se rellena con enlaces sin verificar. Tras un fallo se espera 60 s antes de reintentar.

## 5. Tests y calidad

- **Backend:** suite completa con Mongo 7 en Linux: **806 tests, 805 pass, 0 fail, 1 skip** (`RedisPresenceStore`, sin `TEST_REDIS_URL`).
  - Nuevos o ampliados: `ProgrammeSeoPolicy.test` (Modern Family; «indexada con su URL ⇔ standalone»), `RelatedWorks.test` (pertenencia al conjunto, tipo, determinismo, sin huérfanas, profundidad ≤ 6 desde una obra, sin géneros y con más de 8, índice frío/caducado/fallido/backoff), `CatalogService.programme-path.test` (sin enlace al gemelo canonicalizado ni al no verificado; rail solo del conjunto; vacío si no hay conjunto), `CatalogService.program-slug-resolves.test` (standalone, homónimo por pliegue, thin/TMDB/episodio, política off, caché) y `WorkSeoPolicy.mongo.test` (`indexableWorks` = rutas del sitemap, con géneros).
- **Frontend:** 371/371 (Karma). Nuevo `catalog-detail.related.spec` (rail sin consulta de populares, sin rail cuando no hay obras verificadas, el programa conserva su fallback, enlace emisión→programa).
- **SSR:** nuevo `m10b-links-ssr.test.mjs` (bundle real, sin JS: Modern Family `noindex, follow` en la meta y en `X-Robots-Tag`, canonical propio, navegación EPG presente; el rail de la serie en el HTML del servidor; el enlace emisión→programa). Añadido a `seo-regression`. `legacy-enrichment-ssr` y `entity-read-ssr` siguen en verde.
- **Lint:** 0 errores (los avisos son anteriores).
- **CI:**
  - PR: `backend`, `frontend` y `verify` en verde;
  - `main` @ `2f6013d`: «Build, test, and performance budgets» y «SEO regression» en verde.
- **Diferencia con M09-D:** el 793/797 de M09-D era la suite en Windows. Aquí la suite corrió en Linux, donde no aparecen los 3 fallos exclusivos de Windows. No se ejecutó en Windows.
- **Rendimiento** (Mongo 7 desechable, 22.000 filas de catálogo y 300.000 emisiones):
  - `indexableWorks`: unos 540 ms, en segundo plano cada 6 h;
  - `related()`: 0,02 ms;
  - el agregado usa `idx_tvread_tmdbid_date`;
  - el `exists` de M09-D usa `idx_tvread_tmdbid_date` (1 clave, 1 documento);
  - `readWorkRows` usa `normalizedTitle_1`.
  - No hace falta un índice nuevo y no se añadió.
- **Revisión independiente** (subagente, solo lectura): 0 BLOCKER, 0 HIGH. Los 5 MEDIUM se corrigieron en el PR:
  - la lectura completa del catálogo podía ocurrir dentro de una petición;
  - lookup sin caché en las páginas de emisión;
  - rail poco ligado al género;
  - anchor que afirmaba la identidad no verificada;
  - garantía de enlace entrante para obras sin género.
  - LOW aceptados: hasta 6 h de desfase del conjunto; cada instancia refresca por su cuenta.

## 6. Producción

- Despliegue por artefacto, run 40772569024 → `20261028223254` @ `2f6013d`. La salud responde `healthy` (uptime 69 s tras el despliegue, un solo reinicio por la publicación). El smoke de warm-up SSR dio 200 en todo. El sitemap se envió a GSC (204).
- **Modern Family:**
  - `/programas/modern-family` → 200, `noindex, follow` en la meta y en `X-Robots-Tag`, canonical `…/programas/modern-family`, sin enlace «Ficha completa». Conserva el enlace a `/canales/comedy-central` y a sus emisiones;
  - `/series/modern-family` → `index`, canonical propio. Ya no enlaza el programa. Su rail enlaza 8 obras, todas en `sitemap-works.xml`.
- **Gemelos verificados:** `/programas/gladiator` → canonical `/peliculas/gladiator` (sin cambios). `/peliculas/gladiator` ya no enlaza su gemelo, que lo canonicaliza a ella.
- **Rail:** 4 fichas muestreadas (`tv:1421`, `movie:98`, `tv:1399`, `movie:603`) → 32/32 enlaces dentro de `sitemap-works.xml`.
- **Sitemaps:** programas 44 y obras 3.691, sin cambios. Muestra aleatoria de 10 programas y 15 obras del sitemap: **25/25** con 200, `index`, un único canonical igual a la URL y sin `noindex` en la cabecera.

## 7. Métricas antes/después

Crawl BFS desde `/` sobre el HTML SSR, sin JS (`scripts/seo-link-graph.mjs --max 1500`): profundidades 0–2 completas antes (20:43 UTC, release `20261028204652`) y después (21:43 UTC). El sitemap solo se usa para saber qué URL buscar en el grafo, nunca como prueba de que una URL es alcanzable.

| Métrica | Antes | Después |
|---|---:|---:|
| URL de obra indexables (sitemap-works) | 3.691 | 3.691 |
| Emisiones Cine/Series enlazadas a su obra (verificadas) | 289 (28 oct) | 303 (29 oct); la regla de enlace no cambia |
| Emisiones Cine/Series con TMDB sin verificar | 506 | 541 (protegidas: sin enlace y `noindex` en `/programas`) |
| Representaciones canónicas indexables en conflicto (clase `ambiguous`) | todas las `/programas` `ambiguous` (p. ej. Modern Family) | **0** (`ambiguous` ⇒ `noindex`) |
| Enlaces internos a URL no canónicas | **10** | **0** |
| Enlaces internos rotos (destinos) | 3 | 3 (los mismos, anteriores: §8) |
| Destinos `noindex` enlazados | 955 | 597 |
| URL del sitemap a 0/1/2/3 clics | 1 / 35 / 82 / 121 = **239** | 1 / 30 / 105 / 692 = **828** |
| … obras | 0 / 7 / 17 / 119 = 143 | 0 / 2 / 40 / 686 = **728** |
| … programas | 0 | 3 |
| URL del sitemap a más de 3 clics o no alcanzadas | 3.619 | **3.030** |
| URL del sitemap descubiertas en el crawl acotado (≤ 4) | 240 | 2.003 |
| Huérfanas indexables | no medible con el crawl acotado | no medible; cada obra del sitemap tiene garantizado ≥ 1 enlace de otra obra indexable (test) |

La variación de 1–2 clics depende de la parrilla de cada momento (tarjetas del día).

## 8. Rollback

```sh
# En el host: volver a M09-D
sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback 20261028204652
```

No hay interruptor nuevo. `PROGRAMME_SEO_POLICY=off` también revierte M09-B, así que no es la vía recomendada. Las cachés SSR, nginx y `/v2` expiran en 5–30 min.

## 9. Deuda (M10-C)

- **Identidades sin verificar:** se mantienen las 717 obras `ambiguous` y unos 500 `tmdbId` de emisión por búsqueda de título sin `mediaId`, todas protegidas. La desambiguación (vincular `mediaId` con pruebas) no entra en M10-B.
- **Canales duplicados:** 26 URL de canal con sufijo `-tv` en `sitemap-channels.xml` (p. ej. `/canales/telemadrid-tv` junto a `/canales/telemadrid`, ambas indexables con canonical propio) no reciben enlaces internos. Es un posible duplicado de canal y no es de esta fase.
- **Rail de las páginas de programa/emisión:** conserva su fallback de títulos populares, que puede enlazar fichas sin verificar (p. ej. `/peliculas/spider-man-brand-new-day`). Esas páginas son `noindex, follow`.
- **Enlaces rotos anteriores:** `/series/nick` (desde `/guias`), `/series/2020-britains-…` (desde `/plataformas`) y el `/cdn-cgi/l/email-protection` de Cloudflare.
- **Profundidad:** 2.963 obras del sitemap siguen a más de 3 clics, la mayoría a 4–6 por el grafo de relacionadas; 41 programas `standalone` siguen sin alcanzarse en 3 clics.
- **Caché del conjunto de relacionadas:** hasta 6 h de desfase por instancia y, tras un arranque, un hueco de segundos sin rail.

## 10. Siguiente hito

**M10-C**, la entrega mínima independiente:
1. que las 26 URL `-tv` de canal se redirijan o declaren canonical a su canal principal y salgan del sitemap;
2. que el rail de las páginas de emisión y programa use el mismo conjunto verificado;
3. que `/guias` y `/plataformas` dejen de enlazar las dos fichas rotas.

Después, desambiguar en lotes pequeños los `tmdbId` sin `mediaId`, con pruebas por emisión. M12 sigue NO-GO.
