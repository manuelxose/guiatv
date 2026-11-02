# M10-E — Elegibilidad compartida de programas y enlazado perenne

Estado: **PASS por aceptación del propietario (2026-11-03)**, con los límites medidos y documentados en §7 y §9.
Desplegado como release `20261102233444` @ `5c849f9` (PR [#138](https://github.com/manuelxose/guiatv/pull/138)) y
verificado en producción (§8).

## 1. Línea base

- HEAD al empezar: `39b7093` (#137). Durante el trabajo `main` avanzó a `22e4405` («feat: improve editorial AI
  operations», trabajo editorial del propietario, ajeno a M10-E). La rama se rebasó sobre él sin conflictos.
- Producción: release de M10-D (#136), el último desplegado y verificado.
- Las 13 modificaciones editoriales locales del checkout principal no se tocaron: M10-E se hizo en un worktree
  aparte (`../guiatv-m10e`). El propietario las publicó después en `22e4405`.

## 2. Medición antes del cambio (producción, 2026-11-02 21:58 UTC)

`scripts/programme-reachability.mjs` (nuevo, secuencial, con parada si `/v2/health` se degrada). Lee el HTML SSR
crudo (sin JS) de las **320** fichas de canal que enlaza el directorio `/canales`, y lee el sitemap al empezar y
al terminar.

| Métrica | Antes |
|---|---:|
| URLs en `sitemap-programs.xml` | 22 |
| Mismo sitemap al empezar y al terminar | sí |
| Programas del sitemap con `<a href>` desde una ficha de canal | **0** |
| Enlaces `/programas/` hacia destinos fuera del sitemap | 0 |

Esto confirma, con un segundo método, el `ORPHAN_IN_SCOPE = 22` de M10-D. Evidencia:
`artifacts/m10e/before-reachability.json`.

¿Dónde se emiten las 22? Sondeo de la API pública, hoy y mañana, sobre los 423 canales:

- **18** tienen alguna emisión **hoy** en algún canal.
- **4** solo se emiten **mañana**:
  - `desmontando-el-cosmos`, `el-enigma-de-los-circulos-marinos` (Odisea)
  - `aunque-la-hormona-se-vista-de-seda`, `pepi-luci-bom-y-otras-chicas-del-monton` (Somos)

## 3. Arquitectura

**`ProgrammeEligibility`** (`apps/backend/src/application/services/ProgrammeEligibility.ts`)

Recoge, sin cambios, el cálculo que hacía `SitemapController`:

- candidatos de hoy y mañana (`getIndexableProgramSitemapRows`);
- slug con `slugifyTitle`, descartando `sin-titulo`;
- la consulta de la propia página (`CatalogService.programSlugPage`, ahora pública), con 8 en paralelo como máximo;
- la regla `standalone` de M09-B allí donde se aplica la política.

Lo que sí es nuevo:

- Cada entrada guarda el título que carga la página.
- Cada entrada lleva un indicador `linkable`: `standalone` con la política aplicada, que es la misma regla de la
  ficha de emisión (`standaloneProgrammePath`).

**Contrato de caché**

- Una instantánea responde por **un día de Europa/Madrid** (TZ del proceso).
- Una instantánea deja de valer con lo primero que ocurra de:
  - su TTL (`SITEMAP_CACHE_TTL_MS`, 6 h);
  - la medianoche siguiente;
  - `invalidateSitemapCache()` sin claves o con `programs`, que llama `PrecomputeSchedule` tras cada
    reconstrucción del read model. Publicar una guía no invalida nada.
- Peticiones simultáneas comparten una sola construcción.
- Una construcción iniciada antes de una invalidación responde solo a quien ya la esperaba: no se guarda ni se
  reutiliza.
- Un fallo de repositorio rechaza la petición; **nunca** produce un conjunto vacío. Si existe una instantánea
  buena del mismo día, se sirve 60 s marcada como `fallback` y después se reintenta. Una de otro día no se sirve
  nunca.
- La caché es por proceso, igual que el resto de cachés del sitemap. Un reinicio la vacía.

**Sitemap**

- `sitemap-programs.xml` se genera a partir de la instantánea.
- Su XML caduca exactamente cuando caduca la instantánea.
- Un XML generado desde un `fallback` no renueva el *last good* de 24 h del sitemap.
- Población, orden, `lastmod` y reglas de política apagada o sin consulta: idénticos a los anteriores.

**Superficie de canal**

`TvSurfaceService.getChannelSurface` añade `program.programmePath` en **cada lectura**. Nunca se guarda en la
caché de 60 s de la superficie. Se añade solo si se cumplen todas estas condiciones:

- el slug es `linkable`;
- el título de la emisión es **exactamente** el título de la página;
- no hay `workPath` verificado.

Cuándo se enlaza:

- `current()` nunca espera.
- Sin instantánea válida no se dibuja ningún enlace de programa; nunca uno adivinado.
- Por eso el sitemap y las fichas de canal leen siempre la misma instantánea, o el canal no muestra ninguno.

**Frontend**

- `normalizeToCard` prefiere `workPath`, luego `programmePath`, luego la ficha de emisión.
- La tarjeta y «Abrir» comparten ese destino. Son `<a href>` reales en SSR.
- Angular no calcula ninguna elegibilidad.

## 4. Pruebas

| Suite | Resultado |
|---|---|
| Backend, nuevas (`ProgrammeEligibility.test.ts`) | 11/11 |
| Backend, relacionadas (sitemap, superficie, alias, CatalogService) | 93 pass, 0 fail, 2 skipped |
| Backend completo en CI (Linux) | 836/837 pass, 0 fail |
| Backend completo en local | 729 pass. 3 fallos solo en Windows (`tar C:\…` en tests de manifiesto ajenos), que pasan en CI |
| Frontend completo | 384/384 |

Las 11 pruebas nuevas cubren:

- paridad exacta entre sitemap e instantánea;
- deduplicación;
- `[object Object]`;
- Modern Family `ambiguous`;
- Gladiator `work`;
- episodio y `thin`;
- títulos de mismo slug pero distintos;
- caducidad por TTL;
- medianoche y ventana del día siguiente;
- invalidación con una construcción pendiente;
- fallo sin conjunto vacío;
- política apagada;
- `fallback` sin renovar *last good*;
- superficie con y sin caché;
- ninguna consulta por fila.

El frontend añade:

- un test DOM: todos los `<a href>` de una fila elegible apuntan a `/programas/aida`, y una fila sin
  `programmePath` no cambia;
- un test de `normalizeToCard`.

## 5. Revisión independiente

| # | Hallazgo | Resolución |
|---|---|---|
| 1 (**bloqueante**) | Una petición posterior a una invalidación reutilizaba la construcción en curso, así que el sitemap podía cachear la población anterior durante horas. | Corregido en `c6957e2`, con test de regresión |
| 2 | Con la política apagada, el canal habría enlazado páginas no `standalone`, al revés que la regla de la ficha de emisión. | Corregido (`linkable`) |
| 3 | Un `fallback` renovaba el *last good* de 24 h del sitemap. | Corregido |
| 4 | Huecos sin enlaces mientras se construye (arranque, invalidación, medianoche), y una construcción más tras cada reconstrucción. | Aceptado por diseño, documentado |

Segunda revisión: sin bloqueantes. Queda una nota menor: una construcción sustituida que falla retrasa hasta 60 s
el reintento en segundo plano de `current()`, pero no afecta al sitemap.

## 6. Metadatos de `/programas/aida` y `/programas/com-si-fos-ahir`

**No se reproduce.** En producción ambas sirven 28 palabras (unos 155 caracteres, cortadas con «…»), igual que
`comicos-nuestros`, con `index, follow` y canonical propio. Sin cambios.

## 7. Límite conocido: programas que solo se emiten mañana

La ficha SSR de un canal muestra el día de hoy. El selector de día es solo de cliente y no tiene URL, así que una
página perenne no puede enlazar un programa que solo se emite mañana.

Las alternativas quedan descartadas:

- Una URL `?dia=manana` enlazaría una URL no canónica.
- Quitar «mañana» del sitemap reduciría la población elegible.
- Una página-hub sería una granja de enlaces.

Consecuencia: los programas que solo se emiten mañana (4 de 22 en la medición) **no tienen ruta perenne hasta la
medianoche**, cuando pasan a ser de hoy y la instantánea nueva los enlaza. Se documenta como `PARTIAL`, sin
debilitar ninguna regla.

## 8. Producción después del despliegue

**Release y pasos previos**

- Antes de fusionar hubo que dejar `main` en verde. `22e4405` había dejado 8 tests de `test:ops` en rojo: en
  `scripts/editorial-agents.mjs`, `activeRoutes`, `generationApi` y `generationPost` se declaraban después del
  `if (command === …)` que se ejecuta a nivel de módulo (TDZ). La corrección mueve las tres declaraciones, sin
  cambios, por encima. PR [#139](https://github.com/manuelxose/guiatv/pull/139), fusionado como `25bac43`. Se hizo
  a petición explícita del propietario.
- #138 se rebasó sobre ese `main`, con CI 4/4 en verde en `67b4fba`, y se fusionó como `5c849f9`.
- Desplegado con «Deploy a producción por artefacto» (`deploy-artifact.yml`, run
  [41538156977](https://github.com/manuelxose/guiatv/actions/runs/41538156977)): build en CI, release unificada
  `20261102233444`. Los smoke checks del host pasaron; los autenticados se omitieron por falta de token, como en
  despliegues anteriores.
- Rollback: release de M10-D (#136).

**Alcance, mismo sitemap al empezar y al terminar cada medición**

| Medición | URLs en el sitemap | Con `<a href>` SSR desde una ficha de `/canales` | Enlaces malos | Enlaces fuera del sitemap |
|---|---:|---:|---:|---:|
| Antes (2026-11-02 22:58 Madrid) | 22 | **0** | 0 | 0 |
| Después (23:43 Madrid) | 22 | **13** | 0 | 0 |
| Tras la medianoche (2026-11-03 00:13) | 14 | **6** | 0 | 0 |

- Todas las URLs del sitemap responden 200, `index` y canonical propio.
- Ningún enlace apunta a una redirección, a una página `noindex` ni a una URL no canónica.
- Evidencia: `artifacts/m10e/{before,after,after-midnight}-reachability.json`.

**Las 22 URLs de M10-D** (medición de las 23:43)

| URL | Resultado | Canal de entrada |
|---|---|---|
| `comicos-nuestros` | enlazada | `/canales/somos` |
| `los-green-en-la-gran-ciudad` | enlazada | `/canales/clan` |
| `aida` | enlazada | `/canales/factoria-de-ficcion` |
| `parques-naturales` | enlazada | `/canales/la-8-burgos` |
| `escritores` | enlazada | `/canales/la-8-burgos` |
| `com-si-fos-ahir` | enlazada | `/canales/tv3` |
| `quien-da-mas` | enlazada | `/canales/mega` |
| `diagnostico` | enlazada | `/canales/la-7` |
| `ben-hur` | enlazada | `/canales/hollywood` |
| `telediario-2` | enlazada | `/canales/la-1` |
| `el-verdugo` | enlazada | `/canales/somos` |
| `manicomics` | enlazada | `/canales/super-3` |
| `mr-cocodrilo` | enlazada | `/canales/nick-jr` |
| `aunque-la-hormona-se-vista-de-seda` | solo mañana; **enlazada tras la medianoche** | `/canales/somos` |
| `pepi-luci-bom-y-otras-chicas-del-monton` | solo mañana; **enlazada tras la medianoche** | `/canales/somos` |
| `el-enigma-de-los-circulos-marinos` | solo mañana; **enlazada tras la medianoche** | `/canales/odisea` |
| `desmontando-el-cosmos` | solo mañana; fuera del sitemap del día siguiente | — |
| `escapate` | enlace solo desde canal de feed | `la8cyl-tv` (*) |
| `un-mundo-por-delante` | enlace solo desde canal de feed | `la8cyl-tv` (*) |
| `el-sueno-eterno` | enlace solo desde canal de feed | `la2-cat-tv` (*) |
| `vietnam-50-years-of-forgetting` | enlace solo desde canal de feed | `aljq-tv` (*) |
| `el-perro-andaluz-by-manu-sanchez` | sin enlace (diseño) | — |

(*) La ficha de ese canal lleva el enlace, pero `/canales` no la lista, y no aparece enlazada en las páginas
perennes muestreadas. En los canales que sí lista, la misma emisión tiene una obra verificada y enlaza
correctamente a ella (`/series/escapate`, `/peliculas/el-sueno-eterno`…).

`el-perro-andaluz-by-manu-sanchez`: la página carga «El Perro Andaluz By Manu Sanchez» y ninguna emisión tiene ese
título exacto. La regla de identidad no la enlaza, por diseño.

Tras la medianoche, `manicomics` y 6 URLs nuevas del sitemap del día (`cazatesoros`,
`los-secretos-del-bunny-ranch`, `una-pareja-perfecta`, `segunda-guerra-mundial-el-desenlace`, `animal-einsteins`,
`el-precio-de-la-historia`) no tenían enlace. No se han diagnosticado una a una: por el patrón anterior,
probablemente son de solo mañana.

**Regresiones históricas** (producción, 23:37 Madrid)

| URL | Resultado |
|---|---|
| `/programas/object-object` | 404 |
| `/programas/modern-family` | `noindex` |
| `/series/modern-family` | `index` |
| `/programas/gladiator` | canonical `/peliculas/gladiator` |
| `/peliculas/gladiator` | `index` |
| `/canales/telemadrid_tv` | 301 → `/canales/telemadrid` |
| `/canales/la-1` | 200, `index` |
| `/programas/comicos-nuestros`, `aida`, `com-si-fos-ahir`, `quien-da-mas` | 200, `index`, canonical propio |

Además:

- `sitemap.xml` con sus 5 hijos.
- `robots.txt` responde 200.
- `/v2/health` daba `healthy` antes del despliegue y la API respondió durante todas las mediciones.

**Rastreo perenne:** se lanzó con concurrencia 2 y se detuvo a petición del propietario a profundidad 3 (unas 1.900
páginas), sin guardar el grafo. **No se afirma un grafo agotado** ni ninguna cifra de huérfanas a partir de él.

## 9. Veredicto y aceptación

El propietario acepta M10-E con estas mediciones. En sentido estricto, AC-04 («0 sin ruta perenne en la misma
instantánea») **no** se cumple. Las URLs sin ruta tienen tres causas conocidas y ninguna debilita una regla:

- programas que solo se emiten mañana: se enlazan al llegar su día, como prueba la medición de la medianoche;
- programas cuyo único enlace está en canales de feed que `/canales` no lista;
- un programa cuyo título no coincide con el de la página, que la regla de identidad no enlaza.

**Deuda no bloqueante**

- **Canales de feed sin entrada.** Las fichas de canal con nombre de feed (`la8cyl-tv`, `la2-cat-tv`, `aljq-tv`…)
  son indexables, pero el directorio no las enlaza. Es el mismo defecto que M10-D corrigió solo para los canales
  del sitemap.
- **`escapate` y `el-sueno-eterno`, posible duplicado.** Tienen ficha `/programas/` indexable y también obra
  verificada (`/series/escapate`, `/peliculas/el-sueno-eterno`). Es una decisión de identidad para otro milestone.
- **Huecos sin enlaces por proceso** durante cada construcción de la instantánea (arranque, invalidación,
  medianoche).
- **Ventana de mañana sin ruta.** Mientras el sitemap incluya mañana, habrá URLs sin ruta perenne hasta su día.
