# M10-C: canales canónicos, rail de programas seguro, enlaces rotos y rastreabilidad

Fecha: 2026-10-29. Rama `claude/guiatv-m10c-cleanup-qtt7ju`. Producción de partida: `f6ff172` (PR #126, run 40926451726, desplegado hoy a las 17:58 UTC sobre M10-B `20261028223254`).

Evidencia de producción: este entorno de agente no tiene ruta al sitio ni permiso para lanzar workflows, así que las mediciones se hicieron con un workflow temporal de la rama (`m10c-probe.yml`, solo GET, eliminado antes del merge) que ejecuta `scripts/m10c-probe.mjs` y `scripts/seo-link-graph.mjs` en GitHub Actions. Runs: 40927800290 (probe + grafo, 18:07–18:22 UTC), 40928581145 (probe con identidades), 40932232480 (pares de feeds).

## 1. Veredicto

| Criterio | Estado | Base |
|---|---|---|
| Duplicados de canal verificados fuera del sitemap | **PASS en código**: los 15 alias verificados salen (regla + parrilla); 0 duplicados confirmados quedan listados | §2 |
| Comportamiento canónico de canal coherente (sitemap, 301, canonical, enlaces) | **PASS en código y SSR** | §2, §7 |
| Rail de programas sin asociaciones a obras no verificadas | **PASS en código**: 116 enlaces fuera de `sitemap-works` → solo emisiones y `workPath` verificados | §3 |
| Enlaces rotos | 2 conocidos corregidos en el generador, el 3.º (Cloudflare) clasificado | §4 |
| Sin nuevas relaciones falsas | **PASS**: ninguna asociación nueva; los pares de canal exigen id y parrilla | §2–§5 |
| Rastreabilidad | medición mejorada y límites demostrados; sin navegación nueva | §6 |
| Deuda de identidad clasificada con plan | **PASS** | §5 |
| Tests y CI sin fallos nuevos | **PASS** local; CI en el PR | §7 |
| Revisión independiente sin BLOCKER | **PASS** (1 HIGH, 2 MEDIUM y 5 LOW corregidos) | §7 |
| Despliegue y verificación en producción | **PENDIENTE**: requiere lanzar `deploy-artifact.yml` (el agente no tiene permiso: 403) | §8 |
| **M10-C** | **PARTIAL**: ingeniería completa; falta despliegue y verificación | |

## 2. Fase A: canales duplicados (`-tv`)

### Diagnóstico

El proveedor EPG publica varios canales autonómicos en dos feeds XMLTV: `Telemadrid.es` (nombre «Telemadrid») y `Telemadrid.TV` (nombre «Telemadrid.TV»). La ingesta los guarda como dos canales porque nombres y alias difieren, así que el directorio del día tiene `telemadrid` y `telemadrid_tv`, y `sitemap-channels.xml` listaba las dos URL, indexables y con canonical propio.

Evidencia (`/v2/tv/surface/channels/*`, 29 oct):
- `telemadrid-tv` y `telemadrid`: mismos títulos a las mismas horas (00:32 «El análisis», 01:45 «Yo soy de aquí», 02:34 «Sabor a Madrid»).
- Lo mismo en À Punt, Aragón TV, ETB 2, IB3, TPA, TV3 y TVG 2.
- El sufijo no basta: «Aragón TV», «Andalucía TV», «Castilla la Mancha TV» y «CMM TV» son nombres de canal, y `TeleMadridInt.TV` comparte el 61 % de su parrilla con Telemadrid y es otro canal (el internacional).

Comparación de parrillas de cada canal `.TV` con todos los canales TDT y autonómicos (mismo título a ±10 min):

| Canal `.TV` | Mejor coincidencia | Coinciden | Decisión |
|---|---|---:|---|
| `324.TV` | 3 24 (`324.es`) | 16/16 | alias (id) |
| `7RM.TV` | 7 TV Región Murcia | 15/15 | alias (par revisado) |
| `APUNT.TV` | À Punt (`APunt.es`) | 15/17 | alias (id) |
| `AragonTV.TV` | Aragón TV | 18/24 | alias (id) |
| `AragonTV_INT.TV` | Aragón TV Int | 13/16 | alias (id) |
| `CMM TV` (`CMM.TV`) | Castilla la Mancha TV | 21/22 | **sin resolver**: misma parrilla, pero «CMM TV» es una marca propia; qué URL es canónica lo decide el propietario |
| `Canarias.TV` | TV Canaria | 26/26 | alias (par revisado) |
| `ETB2.TV` | ETB 2 | 18/27 | alias (id) |
| `ETBSAT.TV` | EITB Basque | 32/33 | alias (par revisado) |
| `Extremadura.TV` | Canal Extremadura | 26/26 | alias (par revisado) |
| `IB3.TV` | IB3 | 18/20 | alias (id) |
| `TPA.TV` | TPA | 12/14 | alias (id) |
| `TV3.TV` | TV3 | 22/23 | alias (id) |
| `TVG2.TV` | TVG 2 | 38/39 | alias (id) |
| `TVGAL.TV` | TVG - TV Galicia | 27/29 | alias (par revisado) |
| `Telemadrid.TV` | Telemadrid | 20/22 | alias (id) |
| `ETB1.TV` | ETB 1 (`ETB1.es`) | 14/32 (44 %) | **sin resolver**: el id empareja, la parrilla no llega al 50 % |
| `TeleMadridInt.TV` | Telemadrid | 14/23 (61 %) | **canal distinto**: ningún id lo empareja |
| `ETB1ON.TV`, `ETB2ON.TV` | ETB 3 / EITB Basque | 32–37 % | canal propio |
| `Punt3.TV`, `7TV_Andalucía.TV`, `7Televalencia.TV`, `Aragón_Noticias.TV`, `SX3.TV`, `ETBON_*` (5) | ninguna | 0–4 % | canal propio |

### Regla (código)

`ChannelFeedAliases.ts`: un canal es alias de otro solo si se cumplen las dos condiciones.
1. **Identificadores persistentes**:
   - el canal lleva un `sourceId` `<Clave>.TV` y ninguno `.es`;
   - exactamente otro canal lleva `<Clave>.es` (sin tildes, mayúsculas ni separadores) o la clave `.es` del mapa revisado `FEED_KEY_EQUIVALENTS` (5 pares con distinta grafía).
2. **Misma parrilla ese día**: al menos 3 emisiones, y al menos la mitad, con el mismo título a ±10 min.

El sufijo `-tv` no interviene en la regla. Un par que falla cualquiera de las dos condiciones se queda como dos canales.

| Pieza | Antes | Ahora |
|---|---|---|
| `sitemap-channels.xml` | ambas URL | solo el canal; si no se puede leer la lista de alias, el build falla y se sirve la última copia buena (nunca una lista con alias) |
| `/canales/<alias>-tv` | 200, canonical propio, `index` | **301** al canal (SSR, decide la API). Si la API falla, la página se pinta como antes |
| Canonical y breadcrumb de la página | el alias | el canal (`canonicalChannel`) |
| Guía, «canales relacionados» y vistas `/v2/tv/read`, `/read/channels` y `/read/schedule` (guía en directo, «esta noche» de la portada, búsqueda) | listaban el alias (p. ej. `324.TV` con 31 enlaces) y repetían sus emisiones | no lo listan, así que ningún enlace interno apunta a un 301. Un filtro explícito `channelId` sigue devolviendo las filas del alias |
| API `/v2/tv/*`, parrillas e histórico | — | sin cambios: el alias sigue servido y nada se borra |

La lista se calcula sobre el directorio de hoy:
- caché de 10 min por instancia y una sola carga en vuelo;
- las páginas no esperan nunca: usan la última lista y la refrescan en segundo plano (`current`);
- tras un fallo, las páginas esperan 60 s antes de reintentar;
- se precarga al arrancar la API;
- el sitemap sí espera a la lista (`resolve`).

El 301 del SSR conserva la query (`?dia=manana`) y resuelve `/canales/<x>_tv` en un solo salto.

## 3. Fase B: rail de las páginas de programa y emisión

- **Causa:** si la API no devolvía relacionados, el rail de `/programas/:slug` y `/contenido/program:*` caía en `catalogService.query({ types: [película|serie], sort: 'popular' })`. La respuesta mezcla emisiones con resultados TMDB «populares», cuyo slug sale de una búsqueda por título que nadie verificó.
- **Línea base** (79 páginas de programa y emisión, 29 oct): 116 enlaces a obras fuera de `sitemap-works`, en 21 páginas, hacia 12 destinos. Son siempre los mismos populares: `/peliculas/spider-man-brand-new-day`, `/series/sobrenatural`, `/series/wakfu`…
- **Cambio:** el rail de respaldo pide emisiones ordenadas por emisión (`sort: 'airtime'`, sin filtro de plataforma) y conserva solo emisiones (`source: 'program'`). Cada tarjeta enlaza:
  - la obra que la puerta M10 verificó (`workPath`), o
  - su propia emisión.

  Sin emisiones no hay rail; nunca aparece una tarjeta vacía ni rota.
- **Sin cambios:**
  - el rail de obras de M10-B;
  - el rail de relacionados de la emisión (`loadRelatedForTvReadItem`, ya eran emisiones);
  - la puerta `VerifiedWorkLinks`;
  - la política de Modern Family.
- **Casos cubiertos por tests:**
  - **verificado:** enlaza `/peliculas/gladiator`;
  - **ambiguo:** sin `workPath`, enlaza su emisión;
  - **rechazado:** sin `workPath`, enlaza su emisión;
  - **ausente:** solo populares, sin rail.

## 4. Fase C: enlaces rotos

| Destino | Origen | Causa | Resolución |
|---|---|---|---|
| `/series/2020-britains-most-notorious-crime-investigations` | `/plataformas` | Tarjeta TMDB: el slug se deriva del título «20/20 Britain's…» y la página no puede resolverlo con su búsqueda (404 real) | Generador corregido (abajo). Sin redirect: no existe una URL equivalente legítima |
| `/series/nick` | `/guias` (M10-B) | Misma clase: tarjeta TMDB con un slug que la página no resuelve | Ya no aparece en el probe del 29 oct (la lista rota); la misma corrección lo cubre |
| `/cdn-cgi/l/email-protection` | `/prensa`, `/sobre-nosotros`, `/developers`, `/avisolegal`, `/politica-editorial` | Ofuscación de email de Cloudflare: el origen sirve `mailto:` y el borde lo reescribe. No es una página del sitio | **Clasificado**, sin cambios en Cloudflare: el grafo lo cuenta aparte (`edgeInjectedTargets`) |

- **Corrección del generador** (`CatalogService.markUnresolvedWorkPaths`): una tarjeta TMDB del catálogo (`/plataformas`, carriles de `/guias` y de qué ver hoy) no enlaza su ficha cuando se sabe que esa página no muestra esa obra. Hay dos casos:
  - el slug dio 404 en las últimas 6 h, según la caché negativa de la propia página, y ninguna fila local lo resuelve ahora;
  - una fila local de otro TMDB id coincide con el slug, de modo que la página podría mostrar un homónimo.
- **La tarjeta se mantiene:** conserva título, plataforma e imagen, pero sin `href`.
- **Coste:** una lectura de caché por tarjeta de la página y una lectura agrupada del catálogo, antes de cachear la consulta (10 min).
- **Otros «rotos» del grafo** (5 `error terminated`): cortes de conexión del crawler durante la ráfaga. No son 404 ni destinos inexistentes.

## 5. Fase D: identidades TMDB sin verificar

Clasificación con evidencia pública (`/v2/tv/read`, hoy y mañana, Cine y Series; el registro TMDB se lee con `/v2/catalog/tmdb:*`):

| Medida | Valor |
|---|---:|
| Emisiones Cine/Series | 3.387 |
| … con `tmdbId` | 1.838 |
| … enlazadas a su obra (verificadas) | 720 |
| … sin verificar | **1.118** (identidades distintas: **353**) |

| Clase (identidades distintas) | N | Lectura |
|---|---:|---|
| El título coincide con el registro, sin id persistente | 181 | Falta `mediaId`; el título solo no prueba nada (p. ej. «Indomable», TMDB 70435) |
| El título difiere del registro | 83 | Título localizado, recorte o asociación errónea («Mad Movie» → «Grunt! The Wrestling Movie») |
| Un mismo TMDB id para varios títulos | 70 | Conflicto: «Fast & Furious 5/6» → TMDB 168259 (F&F 7) |
| Id externo inválido (404 en el catálogo) | 17 | Episodios con el id de otra serie («Episodio 815» → 921141) |
| Mismo título, otro año | 2 | «La momia (1932)» → TMDB 564 (1999); «Drácula (1931)» → 2025 |

- **Resueltas en M10-C:** 0. Ninguna clase tiene evidencia independiente en los datos públicos: año, duración y reparto no están en la emisión. Enlazarlas exigiría la coincidencia derivada del enlazador M03, que la puerta M10 rechaza a propósito.
- **Protección:** todas las identidades siguen sin `workPath`. Su `/programas` queda `noindex, follow` (M10-B) y el rail ya no las enlaza (§3).
- **Siguiente paso a escala:**
  - activar la procedencia de año del EPG (`EPG_YEAR_PROVENANCE`, apagado) en un canario;
  - ejecutar el enlazador M03 en sombra con año y tipo como evidencia independiente;
  - promover por lotes pequeños y auditados las 181 «el título coincide» que además coincidan en año;
  - marcar como rechazadas las 70 + 17 con conflicto o id inválido.

## 6. Fase E: rastreabilidad

`seo-link-graph.mjs --reachability`: la profundidad solo es exacta hasta el último nivel BFS descargado completo. Cada URL del sitemap cae en una de estas clases:
- **medida a ≤3 clics**;
- **más profunda** (cota superior);
- **omitida por el límite del crawl** (alcance desconocido);
- **huérfana confirmada**: solo si el crawl agotó todos los enlaces.

El sitemap nunca cuenta como arista.

Línea base (producción `f6ff172`, 29 oct 18:07–18:22 UTC, `--max 1500`, niveles 0–2 completos):

| Población | URL | ≤3 clics | Más profundas | Sin medir (límite) | Huérfanas confirmadas |
|---|---:|---:|---:|---:|---:|
| Todo el sitemap | 3.869 | 1.447 | 540 | 1.882 | 0 (crawl incompleto: no medible) |
| `sitemap-works.xml` | 3.716 | 1.347 | 540 | 1.829 | — |
| `sitemap-channels.xml` | 82 | 56 | 0 | 26 | — |
| `sitemap-programs.xml` | 30 | 3 | 0 | 27 | — |
| estáticas + guías | 41 | 41 | 0 | 0 | — |

- **Las 26 URL de canal no alcanzadas son todas del feed `.TV`:** ninguna recibe enlaces internos. 13 son alias verificados por la regla con los datos del 29 oct, que salen del sitemap. Las otras 13 son canales propios o sin resolver (§2), que se quedan.
- **Por qué no se añade navegación:** no se añadieron bloques de enlaces nuevos. El límite real es el presupuesto del crawl: el nivel 3 tiene 8.273 páginas, 6.852 de ellas emisiones `/contenido`. Las obras a 4+ clics dependen de los anillos de relacionadas (M10-B). Un índice A–Z o bloques masivos serían una granja de enlaces.

**Después:** pendiente del despliegue. Comando para repetir la medición sobre la misma población:

```sh
node scripts/seo-link-graph.mjs --max 1500 --out after.json
node scripts/seo-link-graph.mjs --reachability after.json
node scripts/m10c-probe.mjs > after-probe.jsonl
```

Esperado con los datos del 29 oct:
- `sitemap-channels.xml`: 82 → 67 URL (salen 15 alias, 13 de ellos sin enlaces internos);
- URL de canal no alcanzadas: 26 → 13;
- 0 enlaces de rail a obras fuera de `workPath` verificado;
- 0 enlaces a `/series/2020-britains-…` una vez registrado su 404.

## 7. Tests y calidad

- **Backend (Linux, sin Mongo local):** 749 tests, 720 pass, 0 fail, 29 skip. Los 29 son los `*.mongo.test.ts` y Redis, que corren en CI con Mongo 8.
  - Nuevos: `ChannelFeedAliases.test` (claves de feed, nombres «… TV» que no se emparejan, homónimo `.es` ambiguo, internacional, parrilla, resolver con caché, `current` sin espera, backoff tras fallo, sitemap sin alias y sin duplicados, fallo de la lista);
  - `TvSurfaceService.test` (`canonicalChannel`, relacionados y guía sin alias, degradado);
  - `TvController.feed-aliases.test`;
  - `CatalogService.unresolved-work-path.test` (404 probado, homónimo local, caché negativa antigua, fallo).
- **Frontend (Karma):** 378/378. Nuevos:
  - rail verificado, ambiguo, rechazado y ausente, y consulta por `airtime`;
  - canonical de alias y de canal «… TV»;
  - tarjeta y normalizador con `workPathUnresolved`.
- **SSR (bundle real, sin JS):** 30/30. Las suites de `seo-regression` incluyen el nuevo `m10c-ssr.test.mjs`:
  - 301 del alias, con la query y en un salto desde `_tv`;
  - «Aragón TV» se queda en 200 con su canonical;
  - con la API caída no hay redirect;
  - el rail se pinta como anchors y sin obras sin verificar.

  `seo:ssr-resilience` también pasa, igual que `m10b-links-ssr` (Modern Family `noindex, follow`, sin cambios).
- **Otros:**
  - Playwright (`playwright.entity.config.ts`): no ejecutado en local (versión del navegador del entorno); corre en `seo-regression` tras el merge.
  - Lint: 0 errores. `test:ops`: 38/38.
- **Rendimiento:**
  - ninguna consulta nueva por petición de página: la lista de alias se lee cada 10 min en segundo plano;
  - el 301 solo consulta la API para slugs `-tv` (superficie cacheada en Redis 60 s);
  - `markUnresolvedWorkPaths`: una lectura de caché por tarjeta (máx. 200) y una lectura agrupada por `normalizedTitle` (índice `normalizedTitle_1`), antes de cachear la consulta 10 min;
  - sin índices nuevos.
- **Revisión independiente** (subagente, solo lectura), sin BLOCKER. Corregido:
  - **HIGH:** CMM TV fuera del mapa curado;
  - **MEDIUM:** el rail de respaldo quedaba vacío con `popular`; ahora usa `airtime`;
  - **MEDIUM:** alias visibles en `/tv/read*`;
  - **LOW:** query en el 301; cadena `_tv`; backoff; precarga; tope de 200 tarjetas; tests del canonical de alias y del backoff.
- **Aceptados:**
  - la página `-tv` hace una lectura extra de la superficie (cacheada);
  - las marcas de `workPathUnresolved` llegan con hasta 10 min de retraso;
  - `suggest` (§9).

## 8. Producción y rollback

- **Producción actual:** `f6ff172` (PR #126, run 40926451726), sobre M10-B `20261028223254`. El id exacto de la release de hoy no se pudo leer desde aquí (sin SSH): está en el log del run 40926451726 y en `readlink -f /var/www/guiatv/current`.
- **Despliegue de M10-C: no realizado.** El agente no puede lanzar workflows (`POST …/dispatches` → 403) ni llegar al host.
  - **Procedimiento:** tras el merge, el propietario lanza `deploy-artifact.yml` en `main` y comprueba que el run compiló el commit del merge.
  - **Verificación:**
    - `curl -sI https://guiaprogramaciontv.com/canales/telemadrid-tv` → `301` a `/canales/telemadrid`;
    - `/canales/aragon-tv` → `200` con canonical propio;
    - `sitemap-channels.xml` sin los 15 alias;
    - `node scripts/m10c-probe.mjs` (rail y enlaces rotos);
    - el grafo de §6.
- **Rollback:**
  - **A la release previa:** `sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback <release previa>`, que hoy es la de `f6ff172`. Hay que leerla en el host antes de desplegar.
  - **A M10-B:** `20261028223254`, si la de hoy no está disponible.
  - **Compatibilidad:** no hay migración ni datos escritos (la lista de alias vive en memoria y la marca de tarjetas en la respuesta), así que cualquier release anterior lee los mismos datos.
  - **Cachés:** SSR, nginx y `/v2` expiran en 5–30 min. Los 301 son permanentes en los navegadores que ya los vieron; Google vuelve a rastrear la URL.

## 9. Deuda restante

- **ETB1.TV:** el id lo empareja con ETB 1, pero solo coinciden 14/32 emisiones. Se queda indexable hasta que la regla lo confirme otro día.
- **CMM TV y Castilla la Mancha TV:** comparten el 95 % de la parrilla, pero no se unen sin una decisión del propietario sobre la URL canónica.
- **Búsqueda:** las sugerencias del buscador (`suggest`) aún pueden navegar a un slug TMDB conocido como 404. No son enlaces rastreables.
- **13 canales `.TV` propios sin enlaces internos** (`SX3.TV`, `ETBON_*`, `Punt3.TV`…): siguen en el sitemap, pero la guía no los enlaza. Hay que decidir si la guía los lista o si salen del sitemap (política, no identidad).
- **Ingesta:** el segundo feed sigue creando canales aparte. Unirlos en la ingesta (alias de canal) es más limpio, pero cambia parrillas y la deduplicación del modelo de lectura; no entra en este hito.
- **Identidades:** 353 identidades sin verificar (1.118 emisiones en dos días), todas protegidas (§5).
- **Profundidad:** 1.829 obras del sitemap fuera del crawl acotado y 540 a más de 3 clics; 27 programas `standalone` sin alcanzar. Para medir huérfanas reales hace falta un crawl completo (≈10–15 k páginas, por la noche) o un grafo construido desde la base de datos.
- **Cloudflare:** `/cdn-cgi/l/email-protection` desaparece si se desactiva la ofuscación de email en la zona, o si los emails se publican sin `mailto:`. Lo decide el propietario.
- **Tarjetas TMDB nuevas:** su primer 404 ocurre antes de que la caché negativa lo registre. La corrección se aplica en la siguiente reconstrucción de la consulta (≤10 min).
