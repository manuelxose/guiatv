# M10-F — Canales de feed en el directorio y navegación segura a programas

Estado: **en curso (2026-11-03)**. Seguimiento acotado de M10, que sigue **DONE por aceptación del propietario**.
No reabre M10 ni cambia sus resultados históricos de AC-04.

## 1. Línea base

- `main` al empezar: `1b50814` (entrega de M10-E). Producción: release `20261102233444`.
- Rama `m10f-feed-channel-discoverability`. Los ficheros sin seguimiento del checkout (artefactos de otros
  milestones, documentos editoriales) no se tocan.

## 2. Investigación (producción, 2026-11-03, solo GET)

Fuentes: `/v2/tv/read/channels`, `/v2/tv/read/schedule?itemsPerChannel=200` (388 canales del día),
`/v2/tv/surface/channels/:id` y el HTML SSR crudo. Evidencia: `artifacts/m10f/before-investigation.json`.

Solapamiento = emisiones con el mismo título normalizado que empiezan a ±10 min en otro canal (la misma regla 2 de
`ChannelFeedAliases`).

| Canal | Ruta | HTTP / robots / canonical | Emisiones hoy | Mayor solapamiento | ¿Alias verificado? |
|---|---|---|---:|---|---|
| `la8cyl_tv` «La8CYL.TV» | `/canales/la8cyl-tv` (`la8cyl_tv` → 301) | 200 · `index, follow` · propio | 25 | Cuatro 2/25, La 7 1/25 | no (sin id `.es`) |
| `la2_cat_tv` «La2_CAT.TV» | `/canales/la2-cat-tv` | 200 · `index, follow` · propio | 1 | **LA 2 1/1** | no (`La2_CAN.TV` sí lo es de LA 2; `La2_CAT.TV` no) |
| `aljq_tv` «AlJQ.TV» | `/canales/aljq-tv` | 200 · `index, follow` · propio | 8 | **Al Jazeera English 8/8** | no (clave `aljq` sin par `.es`) |

Antes del cambio, el SSR de `/canales` enlaza 298 fichas de canal y **ninguna** de las tres.

**Clasificación**

- **`la8cyl_tv` — canal propio, se expone.** Programación regional de Castilla y León (*Buenos días Castilla y
  León*, *La 8 Noticias*, *CyLTV Noticias*, *Parques Naturales*, *Escápate*…). Ningún canal del directorio comparte
  su parrilla, y el directorio no ofrece otra ruta equivalente (`la-8-burgos`, que M10-E usó como entrada, hoy
  responde 404: no está en el EPG del día). Es la ficha que llevaba `escapate` y `un-mundo-por-delante`.
- **`la2_cat_tv` — se mantiene oculto.** Su única emisión es *El sueño eterno* a la misma hora que LA 2. En LA 2 esa
  emisión tiene obra verificada (TMDB 910) y enlaza `/peliculas/el-sueno-eterno`; en el feed no tiene `tmdbId` y
  enlaza `/programas/el-sueno-eterno`. Exponerlo añadiría un canal casi vacío y duplicado cuya única aportación
  sería una ruta hacia el duplicado programa/obra (§6). No se fusiona con LA 2: una emisión no es evidencia de
  identidad y La 2 Catalunya tiene desconexiones propias.
- **`aljq_tv` — se mantiene oculto.** Sus 8 emisiones son las 8 primeras franjas de Al Jazeera English, que ya está
  en el directorio y emite también *Vietnam - 50 Years of Forgetting*. Exponerlo duplicaría AJE. Tampoco se
  convierte en alias: la clave `aljq` no tiene par `.es` y añadir una equivalencia a `FEED_KEY_EQUIVALENTS` con un
  solo día de parrilla sería decidir un 301 nuevo sin la revisión que tuvieron los 15 actuales. Queda como
  candidato documentado.

**Otros feeds ocultos.** Se leyó la superficie de los 90 canales con nombre de feed que `/canales` oculta. Solo 4
llevan un enlace `/programas/`:

| Programa | Feed | ¿Ruta desde un canal listado? |
|---|---|---|
| `com-si-fos-ahir` | `bondiatv_cat_tv` | sí: `tv3`, `tv3_cat` |
| `aida` | `mitele_comedia_tv` | sí: `fdf` |
| `el-sueno-eterno` | `la2_cat_tv` | no: LA 2 enlaza la obra (§6) |
| `manicomics` | `c33_tv` | no: Super 3 emite «Manicòmics (?)» con obra `/series/manicomics` |

`manicomics` es el mismo patrón programa/obra que `el-sueno-eterno`; exponer `c33_tv` sería abrir una ruta hacia
ese posible duplicado, así que queda fuera, documentado en §6.

**Situación de los cuatro programas hoy** (el sitemap del día tiene 14 URLs)

| Programa | En el sitemap hoy | Página | Emisión de hoy |
|---|---|---|---|
| `escapate` | no | 200, `index` | La8CYL 13:05 («Escápate»); La 7 emite «Escápate de viaje» (otro título) |
| `un-mundo-por-delante` | no | **404** | ninguna |
| `el-sueno-eterno` | sí | 200, `index` | LA 2 y La2_CAT 22:30 (2 nov) |
| `vietnam-50-years-of-forgetting` | no | 200, **`noindex`** | Al Jazeera English 13:00 |

Hoy La8CYL no lleva ningún enlace `/programas/` porque ninguno de sus programas está en la instantánea del día: es
ausencia de emisión elegible, no un fallo de navegación. La ficha enlazará el programa el día en que vuelva a ser
elegible, con la regla de M10-E sin cambios.

## 3. Cambio

`apps/frontend/src/app/pages/channel-catalog/channel-catalog.component.ts`: `REVIEWED_FEED_CHANNELS`, una lista
por **id** (nunca por nombre ni sufijo) de feeds revisados como canal propio. Hoy contiene solo `la8cyl_tv`. La
regla general (ocultar nombres de feed fuera de `tdt`/`autonomico`) no cambia.

No cambia: sitemap (programas y canales), `ProgrammeEligibility`, alias verificados y sus 301, reglas TMDB, regla
de título exacto, robots/canonical de ninguna página, nombres de canal.

## 4. Pruebas

| Suite | Resultado |
|---|---|
| Frontend completo (Karma) | 386/386 (2 nuevas) |
| Build SSR (`build:ssr`) | OK |
| Backend relacionado (`ChannelFeedAliases`, `ProgrammeEligibility`, `TvSurfaceService`, `SitemapController`) | 43/43 |

Las nuevas pruebas cubren:

- `la8cyl_tv` se lista;
- `la2_cat_tv`, `aljq_tv` y un id parecido (`la8cyl_tv_hd`) siguen ocultos;
- un test DOM comprueba que el directorio dibuja el `<a href="/canales/la8cyl-tv">` real, que es la URL sin
  redirección.

Con la lista vacía, las dos pruebas fallan (mutación comprobada).

Los alias verificados no llegan a este filtro: `TvController.readChannels` los quita antes. Sus pruebas
(`ChannelFeedAliases.test`) siguen en verde. `ProgrammeEligibility` no cambia y sus 11 pruebas pasan.

## 5. Revisión independiente

Ningún hallazgo bloqueante ni alto.

- La lista va por id, así que ningún otro feed entra por nombre.
- Un futuro alias de `la8cyl_tv` se seguiría quitando en `TvController`.
- El enlace usa `channelCanonicalPath`, que da `/canales/la8cyl-tv` (200).
- La caché y la clave de petición no cambian.
- La tarjeta sigue siendo un `<a>` real con nombre accesible.

| Hallazgo | Resolución |
|---|---|
| Medio: el mock del DOM ignora el `group`, así que no prueba la pestaña «Online» | Aceptado: el filtro no depende del grupo. En producción, `?group=online` incluye `la8cyl_tv` |
| Bajo: el patrón negativo `/hd/` del test era demasiado amplio | Corregido |
| Bajo: `access: unknown` oculta el canal en «En abierto» y «De pago» | Igual que los demás canales con acceso desconocido; sin cambios |
| Nota: hay otros feeds online ocultos (`ptv_linares_tv`, `mitele_*`…) que podrían ser canales propios | Fuera de alcance: requieren la misma revisión uno a uno |

## 6. Cuestión de identidad aparte (no resuelta aquí)

Hay programas con ficha `/programas/` indexable cuya misma emisión, en otro canal, tiene obra verificada:

- `el-sueno-eterno`: `/programas/el-sueno-eterno` y `/peliculas/el-sueno-eterno` (TMDB 910), ambas `index` con
  canonical propio. Misma película (1946, misma sinopsis) emitida a la vez en LA 2 y en el feed.
- `manicomics`: `/programas/manicomics` (en el sitemap) y `/series/manicomics`.
- `escapate`: `/programas/escapate` (`index`) y `/series/escapate` (`noindex`, TMDB de 2019). No está demostrado
  que la serie TMDB sea el programa de La 8; hay que verificarlo antes de enlazar o canonicalizar nada.

Decidir el canonical exige una regla de identidad programa↔obra, no un ajuste de navegación. Se deja para un
milestone propio.

## 7. Producción

Pendiente de despliegue autorizado.

## 8. Rollback

Revertir el commit de M10-F (solo frontend) o redesplegar la release `20261102233444`.
