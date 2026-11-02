# M10-D: rastreabilidad determinista, canales inalcanzables y títulos que no son texto

Fecha: 2026-11-02. Rama `feature/m10d-deterministic-reachability`, base `origin/main` @ `76c0bbe` (PR #132).
PR [#133](https://github.com/manuelxose/guiatv/pull/133), fusionado con squash como **`10a2a9b`** el 2026-11-02 a
las 15:40 UTC con CI 4/4, **desplegado a producción a las 15:58:58 UTC y verificado** (§9). El cierre va en el
PR [#134](https://github.com/manuelxose/guiatv/pull/134), aún sin desplegar.

A diferencia de M10-C, **este entorno de agente sí tiene ruta a producción**, así que todas las mediciones se
hicieron por HTTP directo contra `https://guiaprogramaciontv.com` (solo GET, sin escrituras). No hizo falta el
workflow temporal que M10-C necesitó.

---

## 1. Veredicto

| Criterio | Estado | Base |
|---|---|---|
| Metodología de medición reproducible y con cobertura explícita | **PASS** | §3 |
| Ninguna huérfana inventada a partir de un crawl incompleto | **PASS**: 0 afirmadas, y la orfandad exige cola agotada, presupuesto no agotado y cero fuentes ilegibles | §3 |
| Corrección temporal (ventana de observación registrada) | **PASS** | §3 |
| Inventario de canales del sitemap sin ruta interna, clasificado | **PASS**: 14 de 67, uno a uno | §5 |
| Defectos de descubrimiento de canal corregidos y con test de regresión | **PASS**, verificado en producción: 0 canales del sitemap fuera del directorio (eran 14) | §5, §7, §9 |
| Población de programas medida, sin exponer páginas pobres | **PASS** | §6 |
| Alcance de obras medido lo suficiente para separar defecto de no medido | **PARCIAL**: 1.356 a ≤3 clics medidas y 2.101 más profundas, pero 368 sin medir; ningún defecto confirmado | §4, §6 |
| Seguridad SEO (sin desindexación, canonical ni inflación de sitemap) | **PASS** | §7, §9 |
| Enlaces internos a destinos canónicos | **PASS**: 0 enlaces no canónicos, 0 destinos rotos, y la corrección de los alias de canal en fichas de obra desplegada y verificada en producción | §4, §7.3, §9.1 |
| Tests, CI y revisión independiente | **PASS**: CI 4/4 sobre el HEAD final, fusionado como `10a2a9b`; dos revisiones independientes, 10 hallazgos, todos corregidos | §8 |
| Seguridad operativa del rastreo | **PARCIAL**: el reinicio de la API fue el despliegue, no el rastreo (rectificado); pero mi concurrencia 4 sí provocó 17 × 503. La parada por salud que el hito pedía faltaba; ya está | §3 |
| Despliegue y verificación en producción | **PASS**: #133 y #134 desplegados y verificados, **7 de 7 smokes en verde**, incluida la corrección de alias sobre una emisión real | §9 |
| **M10-D** | **PARCIAL**: el #133 está desplegado y verificado en producción; queda desplegar el #134 (alias de canal en fichas de obra) y repetir un rastreo perenne a concurrencia 2 para cerrar el recuento de huérfanas | |

---

## 2. Línea base real (2026-11-02, release en producción `20261029201513` @ `17e44e3`)

`origin/main` está en `76c0bbe`, **tres commits por delante del release desplegado** (#127, #131, #132 son
trabajo de Blog Studio y admin, ya en `main` y aún sin desplegar). La producción medida aquí es por tanto la de
M10-C, no la de `main`.

Inventario del sitemap, medido a las 14:32 UTC:

| Sitemap | URLs |
|---|---:|
| `sitemap-static.xml` | 23 |
| `sitemap-channels.xml` | 67 |
| `sitemap-programs.xml` | 29 |
| `sitemap-blog.xml` | 18 |
| `sitemap-works.xml` | 3.825 |
| **Total** | **3.962** |

Las cifras históricas de M10-C (1.314 URLs a ≤3 clics, 2.018 fuera del crawl, 10 canales no alcanzados) **no son
comparables** con estas: el sitemap de programas pasó de ~700 a 29 URLs por el endurecimiento de elegibilidad de
M10-B/M10-C, y las mediciones se tomaron con otro método y otra hora. §4 solo compara lo que es comparable.

Regresiones M10 verificadas en producción **antes** de tocar nada:

| Invariante | Resultado |
|---|---|
| 15 alias de canal verificados → 301 | **15/15** |
| Query string preservada en el 301 | `/canales/telemadrid-tv?d=1` → `/canales/telemadrid?d=1` |
| Identidades distintas preservadas | `cmm-tv`, `castilla-la-mancha-tv`, `etb-1`, `etb1-tv`, `telemadrid`, `telemadridint-tv`: todas 200 y con canonical propio |
| Obra verificada canónica | `/peliculas/gladiator` 200, canonical propio, `index, follow` |
| Política Modern Family | `/series/modern-family` 200, canonical propio, `index, follow` |
| Host canónico HTTPS | sin cambios |

---

## 3. Metodología de crawl

### El problema que resuelve

El crawler de M10-C es un BFS por el HTML SSR real desde `/`. Su límite no era el algoritmo sino el reparto del
presupuesto: el 91 % del grafo son páginas `/contenido/program:<id>` — una por emisión, `noindex, follow`,
regeneradas cada día — así que un crawl de 1.500 páginas se agotaba en ellas y **"no alcanzada" nunca podía
significar "huérfana"**.

### Lo implementado

**`--skip-traverse <regex>`.** Una página que encaja se registra como destino pero no se descarga ni se expande.
Con `^/contenido/` el presupuesto llega a las páginas que persisten. La exclusión queda grabada en el JSON y
**limita lo que el resultado puede afirmar**: una página no expandida podría haber sido el camino.

**Una clase por URL del sitemap.** `reachability()` asigna exactamente una, y la clase dice qué sostiene la
evidencia:

| Clase | Significado |
|---|---|
| `REACHED_WITHIN_3` | enlace SSR real, profundidad mínima medida ≤ 3 |
| `REACHED_DEEPER` | alcanzada, pero por debajo del último nivel BFS completo: la profundidad es cota superior |
| `INVALID_DESTINATION` | alcanzada, responde 4xx/5xx |
| `TEMPORARY_FETCH_FAILURE` | alcanzada, este crawl no pudo leerla. **Nunca** una huérfana |
| `EXCLUDED_BY_POLICY` | dentro de la familia no expandida |
| `UNMEASURED` | el crawl paró en `--max` con frontera pendiente: alcance desconocido |
| `ORPHAN_IN_SCOPE` | crawl agotado, pero con una familia sin expandir: huérfana **solo en el ámbito recorrido** |
| `VERIFIED_ORPHAN` | no existe ruta interna. Solo cuando el crawl agotó la frontera **sin fallos** y expandió todo |

Un crawl truncado no puede producir un `VERIFIED_ORPHAN` por construcción. El `--self-check` lo exige, junto con
fronteras truncadas, fallos reintentables, redirecciones y alias, ciclos, duplicados, destinos solo-sitemap y
destinos `noindex`, y comprueba que las clases **particionan** el sitemap.

**`--probe-skipped`.** Muestrea la familia no expandida y dice qué URLs no alcanzadas enlaza de verdad, para identificar rutas positivas; la ausencia en una muestra no verifica orfandad.

**Normalización temporal.** `--urls-from` escribe la población de URLs de un crawl, para comparar dos crawls
sobre las mismas URLs. El grafo guardado lleva su **ventana** de observación: inicio, fin, horas de Madrid,
minutos transcurridos, día EPG en ambos extremos, ámbito y frontera pendiente. Un crawl de miles de páginas SSR
abarca buena parte de una hora y la parrilla se mueve dentro: la ventana es la evidencia, no un instante.

**Puerta de regresión.** `--require-reached <sitemap>` distingue PASS, FAIL e INCONCLUSIVE por cobertura, errores y URL requerida, y su mensaje sigue a la clase: fuera del ámbito completo dice
«sin ruta dentro del ámbito recorrido», no «sin ruta interna». Está cableada en `seo-regression.yml` para
`sitemap-channels.xml`.

### Seguridad operativa: lo que el rastreo sí causó, y lo que no

Solo GET, timeout 30 s, un reintento en 429/5xx, sin escrituras ni rutas autenticadas en ningún momento.

**Rectificación.** Una versión anterior de este registro atribuyó un reinicio de la API a mi rastreo de 4.000
páginas. **Es falso y queda retirado.** Con hora propia del endpoint: `timestamp` 16:45:41 UTC, `uptime` 2.803 s
→ la API arrancó a las **15:58:58 UTC**. El workflow «Deploy a producción (Contabo)» arrancó a las 15:56:40 UTC
y mi rastreo terminó a las 15:56:39. **El reinicio fue el despliegue del #133**, no el rastreo. El error vino de
estimar el arranque con mi propio reloj en lugar del `timestamp` de la respuesta.

**Lo que el rastreo sí causó.** En el rastreo perenne (17:01–17:42, concurrencia 4) **17 páginas respondieron
503**: 16 fichas de película y una de canal. Todas responden **200 en reposo** (verificado: 88–1.046 ms), así
que son 503 inducidos por la carga, no un defecto del sitio — y por tanto **no se cuentan como destinos rotos**
en ningún sitio de este informe. Su único efecto real es que dejan el grafo en `crawlReliable: false`, porque una
fuente ilegible puede ocultar el único enlace a una URL (§«Límite demostrado»).

Comprobar la salud antes y después no basta. El hito pedía «parar si la salud de la aplicación se degrada» y esa
comprobación **faltaba**. Ahora el rastreo sondea `--health` cada 250 páginas y se detiene solo si la respuesta
no es `healthy`, registrando `stoppedBy`; un endpoint de salud inalcanzable cuenta como degradado. El agotamiento
—lo único que autoriza una afirmación de orfandad— exige además no haberse interrumpido por salud. El workflow
baja a `--concurrency 2`.

Estado al cerrar el hito: `/v2/health` `healthy`, rss 312–375 MB, `/canales` 200 en 125–353 ms.

### Reproducir

**Concurrencia 2, no más.** A 4 reiniciamos la API (§ más abajo). El rastreo se detiene solo si `/v2/health`
deja de responder `healthy`, pero eso evita empeorarlo, no lo vuelve seguro a cualquier ritmo. Y **desde
PowerShell**, no desde Git-Bash, o el patrón de ámbito llega reescrito (el rastreo lo rechaza si lo detecta).

```powershell
# el grafo se guarda solo al final: dale memoria si subes --max
node --max-old-space-size=8192 scripts/seo-link-graph.mjs https://guiaprogramaciontv.com `
  --max 9000 --concurrency 2 --skip-traverse '^/contenido/' --out before.json
node scripts/seo-link-graph.mjs --reachability before.json --require-reached sitemap-channels.xml
node scripts/seo-link-graph.mjs --urls-from before.json --out population.txt
node scripts/seo-link-graph.mjs --probe-skipped before.json --sample 150
# después del despliegue, sobre la misma población:
node scripts/seo-link-graph.mjs --reachability after.json --urls population.txt
node scripts/seo-link-graph.mjs --compare before.json after.json
```

`--require-reached` devuelve 0 (PASS), 1 (FAIL) o 2 (INCONCLUSIVE). Hoy devuelve **2** contra producción, y eso
es el resultado correcto: la evidencia no alcanza (§«Límite demostrado»).

### Un fallo de la propia medición, y cómo salió a la luz

Los dos primeros rastreos de producción **se ejecutaron sin ámbito y sin decirlo**. Git-Bash reescribe un
argumento con forma de ruta, así que `--skip-traverse '^/contenido/'` llegó a node como
`^C:/Program Files/Git/contenido/`, que no encaja con nada: las páginas de emisión se recorrieron igual, el
presupuesto se fue en ellas exactamente como antes de M10-D, y el grafo guardado registró el patrón deformado
como su ámbito. El primero murió además por memoria a los 47 minutos. **Lo delató la propia salida de la
puerta**, que imprime el ámbito efectivo — razón suficiente para que el ámbito se registre y se imprima.

El patrón se rechaza ahora si llega reescrito, en lugar de producir una medición que parece válida. Un rastreo
con ámbito correcto debe lanzarse desde PowerShell o con `MSYS_NO_PATHCONV=1`.

### Límite demostrado

El rastreo que sí completó es por tanto de **ámbito completo** (`/contenido` recorrido), el mismo ámbito que usó
M10-C, y es la línea base que se reporta en §4:

| Dato | Valor |
|---|---|
| Ventana de observación | 2026-11-02 16:28:08 .. 16:56:39 (Madrid), 29 min, día EPG 2026-11-02 |
| Presupuesto gastado | 4.000 / 4.000 |
| URLs descubiertas | 12.469 |
| Profundidad exacta hasta | **3** (niveles 0, 1 y 2 descargados completos: 1 + 76 + 1.085) |
| Frontera pendiente | 8.469 |
| `crawlComplete` / `crawlReliable` | **false / false** |
| Huecos de traversía | 8.469 |
| Fallos de descarga | 0 |
| De las 12.469 URLs, `/contenido/program:*` | **7.665 (61 %)** |

**Ninguna huérfana es verificable con este grafo, y el informe no afirma ninguna.** El presupuesto fue el motivo
de parar, así que la cola no está agotada; y 8.469 páginas descubiertas quedaron sin leer, cualquiera de las
cuales podría contener el único enlace a una URL dada. Las 398 URLs del sitemap no descubiertas son
`UNMEASURED`, no huérfanas.

**La evidencia de los 14 canales no depende de este rastreo.** Es la diferencia exacta de conjuntos entre las 67
URLs de `sitemap-channels.xml` y los anclajes de `/canales`, ambas enumeraciones completas (§5). El rastreo solo
aporta la distribución de profundidad y la higiene de enlaces.

### El grafo perenne **sí** se agota, y eso da la respuesta de M10

Rectificación: un párrafo anterior concluía que no era agotable desde aquí, a partir de un sondeo de 700 páginas.
**Se agotó.** Rastreo del 2026-11-02, 17:01–17:42 Madrid, ámbito `excludes ^/contenido/`:

| Dato | Valor |
|---|---|
| Páginas descargadas | **4.727** de un presupuesto de 9.000 |
| Frontera al terminar | **0** |
| `stoppedBy` | frontera agotada (no el presupuesto) |
| `crawlComplete` | **true** |
| Profundidad exacta hasta | **4** |
| URLs descubiertas | 12.830, de las que 8.103 son páginas de emisión excluidas |
| Duración | 41 minutos |

Y la respuesta que M10 llevaba pidiendo desde el principio:

> De las **3.962** URLs del sitemap, un rastreo agotado del grafo perenne alcanza **3.934**. Las **28** que no
> alcanza son **todas fichas de programa** — exactamente las 29 de §6 menos `/programas/object-object`. Cada
> canal (67/67), cada obra, cada URL estática y cada guía tienen ruta desde una página perenne.

**Pero `crawlReliable` sigue en `false`**, por los 17 × 503 que mi propia concurrencia causó. Una de esas 17
fuentes podría contener el único enlace a una de las 28, así que la clase correcta es `UNMEASURED`, no
`ORPHAN_IN_SCOPE`, y este informe **no afirma ninguna huérfana**. La puerta funciona exactamente como se diseñó.

Lo relevante para el hito siguiente: **falta muy poco**. Repetir este mismo rastreo a concurrencia 2 con la
parada por salud debería dar `crawlReliable: true` y, con ello, el primer recuento de huérfanas defendible del
proyecto. El «Modo 2» (grafo desde instantánea de sólo lectura) deja de ser imprescindible y pasa a ser la opción
robusta frente a la variabilidad de la parrilla.

---

## 4. Alcance antes / después

El #133 **se desplegó** a las 15:58:58 UTC, así que hay un antes y un después reales. Lo único directamente
comparable son las cifras de canal, porque proceden de una **enumeración completa** (sitemap frente a anclajes de
`/canales`) y no de un presupuesto de rastreo. Las distribuciones de profundidad vienen de dos rastreos de
**ámbito distinto** y hora distinta, así que se dan por separado, cada una con su ámbito; compararlas entre sí
sería el error temporal que este hito existe para evitar.

**Canales — enumeración completa, antes y después del despliegue:**

| Indicador | Antes (pre-deploy) | Después (producción, verificado) |
|---|---:|---:|
| URLs en `sitemap-channels.xml` | 67 | **67** |
| Enlaces de canal en `/canales` | 304 | **318** |
| **Canales del sitemap sin entrada en el directorio** | **14** | **0** |
| Alias verificados expuestos en el directorio | 0 | **0** |
| Alias verificados que responden 301 | 15/15 | **15/15**, query preservada |
| URLs en `sitemap-programs.xml` | 29 | **28** |
| `/programas/object-object` | 200, indexable, en el sitemap | **404, fuera del sitemap** |

**Rastreo A — ámbito completo, pre-deploy** (16:28–16:56 Madrid, 4.000 páginas, profundidad exacta hasta 3,
presupuesto agotado):

| Clase, de 3.962 URLs | |
|---|---:|
| `REACHED_WITHIN_3` | 1.455 |
| `REACHED_DEEPER` | 2.109 |
| `UNMEASURED` | 398 |
| `VERIFIED_ORPHAN` / `ORPHAN_IN_SCOPE` | 0 / 0 — no afirmable |

**Rastreo B — ámbito perenne, post-deploy, agotado** (17:01–17:42 Madrid, 4.727 páginas, frontera 0, profundidad
exacta hasta 4). Es la medición buena:

| Clase, de 3.962 URLs | |
|---|---:|
| `REACHED_WITHIN_3` | 1.333 |
| `REACHED_DEEPER` | 2.585 |
| **No alcanzadas** (`UNMEASURED`) | **28**, todas fichas de programa |
| `INVALID_DESTINATION` | 16 — los 503 por carga propia, 200 en reposo (§3) |
| `VERIFIED_ORPHAN` / `ORPHAN_IN_SCOPE` | 0 / 0 — `crawlReliable: false` por 17 fuentes ilegibles |
| Canales alcanzados | **67/67**, todos a ≤2 clics (4 a 1, 63 a 2) |
| Obras alcanzadas | 3.825/3.825 |
| Estáticas y guías | 23/23 y 18/18 |

Higiene de enlaces internos en el rastreo B:

| Indicador | Valor | Nota |
|---|---:|---|
| Destinos internos rotos (4xx) | **0** | |
| Enlaces a URLs no canónicas | **0** | invariante M10-C preservada |
| Destinos que redirigen / instancias | **12 / 19** | **todos** alias de canal `-tv`; corregido en §7.3, **sin desplegar** |
| Cadenas de redirección | **0** | |
| Anclajes vacíos / genéricos | **0 / 0** | |
| Programa → obra / obra → programa | 190 / 33 | |
| Obra → canal / programa → canal | 414 / 12 | |

Por fichero de sitemap, con la profundidad mínima medida:

| Sitemap | URLs | ≤3 clics | Más profundas | No medidas |
|---|---:|---:|---:|---:|
| `sitemap-static.xml` | 23 | **23** | 0 | 0 |
| `sitemap-channels.xml` | 67 | **56** (4 a 1 clic, 49 a 2, 3 a 3) | 0 | **11** |
| `sitemap-programs.xml` | 29 | **2** | 8 | **19** |
| `sitemap-blog.xml` | 18 | **18** | 0 | 0 |
| `sitemap-works.xml` | 3.825 | **1.356** (12 a 1, 168 a 2, 1.176 a 3) | 2.101 | **368** |

En el rastreo A, además: 1 destino roto (`/series/2020-britains-most-notorious-crime-investigations`, 404 desde
`/plataformas`, residual M10 conocido de slug por búsqueda TMDB, no reaparece en B), 2.016 destinos `noindex`
enlazados (las páginas de emisión, por diseño) y 1.327 destinos con parámetros.

No comparar muestras de distintas ventanas EPG, ni de distinto ámbito, como mejoras causales.

---

## 5. Remediación de canales

### Diagnóstico

`sitemap-channels.xml` publica 67 URLs. `/canales` —  la **única** página del sitio que lista canales — enlazaba
304 canales, y **14 de los 67 no estaban entre ellos**.

La causa es un filtro de presentación en `filterChannelDirectory`
([`channel-catalog.component.ts`](../../apps/frontend/src/app/pages/channel-catalog/channel-catalog.component.ts)):
ocultaba todo canal cuyo **nombre visible** parece un id crudo de feed EPG (`_` o final `.TV`). M10-C sacó del
sitemap los 15 alias de feed *verificados* con un 301 y dejó dentro, a propósito, los canales que no pudo probar
duplicados. Esos 14 quedaron 200, indexables, con canonical propio y en el sitemap — y sin que ninguna página los
enlazara.

La regla pasa a ser: un nombre crudo se oculta **solo** si su canal no está en un grupo que el sitemap publica
(`tdt`, `autonomico`). Los alias verificados no llegan a este filtro: la API los quita del directorio y su página
responde 301. Medido sobre la respuesta real de `/v2/tv/read/channels?date=today`: expone exactamente esos 14,
todos en el sitemap, **0 alias**, y deja **0** canales del sitemap sin entrada en el directorio.

### Tabla de decisión

Clasificación heredada de M10-C (coincidencia de parrilla con el canal `.es` del mismo id, mismo título ±10 min);
«emisiones» = filas públicas de la página el 2026-11-02.

| Canal | Clasificación | Canonical | Ruta existente | Acción | Resultado verificado |
|---|---|---|---|---|---|
| `/canales/etb1-tv` (ETB1.TV) | **sin resolver**: el id empareja ETB1.es, la parrilla solo 44 % | propio, `index, follow` | ninguna | se muestra en el directorio | 35 emisiones; identidad preservada, sin fusión |
| `/canales/telemadridint-tv` (TeleMadridInt.TV) | **canal distinto** (internacional): 61 % de parrilla, ningún id empareja | propio, `index, follow` | ninguna | se muestra en el directorio | 29 emisiones |
| `/canales/sx3-tv` (SX3.TV) | canal propio (0–4 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 82 emisiones |
| `/canales/punt3-tv` (Punt3.TV) | canal propio (0–4 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 8 emisiones |
| `/canales/7tv-andalucia-tv` | canal propio (0–4 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 16 emisiones |
| `/canales/7televalencia-tv` | canal propio (0–4 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 23 emisiones |
| `/canales/aragon-noticias-tv` | canal propio (0–4 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 2 emisiones |
| `/canales/etb1on-tv` (ETB1ON.TV) | canal propio (32–37 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 38 emisiones |
| `/canales/etb2on-tv` (ETB2ON.TV) | canal propio (32–37 %) | propio, `index, follow` | ninguna | se muestra en el directorio | 48 emisiones |
| `/canales/etbon-conquistador-tv` | canal propio | propio, `index, follow` | ninguna | se muestra en el directorio | 12 emisiones |
| `/canales/etbon-herritxiki-tv` | canal propio | propio, `index, follow` | ninguna | se muestra en el directorio | 21 emisiones |
| `/canales/etbon-oca1-tv` | canal propio | propio, `index, follow` | ninguna | se muestra en el directorio | 2 emisiones |
| `/canales/etbon-vascos-mundo-tv` | canal propio | propio, `index, follow` | ninguna | se muestra en el directorio | 7 emisiones |
| `/canales/etbon-vayasemanita-tv` | canal propio | propio, `index, follow` | ninguna | se muestra en el directorio | 29 emisiones |

### Identidades protegidas, sin cambios

- **CMM TV frente a Castilla la Mancha TV.** Ambas 200, con canonical propio, y **ya alcanzables** desde el
  directorio (su nombre no es un id crudo). Qué URL es canónica sigue siendo decisión del propietario: M10-D no la
  toca.
- **ETB1.TV frente a ETB 1.** 44 % de parrilla compartida. No se fusiona: se vuelve descubrible como canal
  propio, que es lo que su clasificación actual sostiene.
- **El sufijo `-tv` no prueba duplicación.** «Aragón TV», «Andalucía TV» y «Castilla la Mancha TV» son nombres de
  canal y se mantienen.

### Lo que **no** se hizo

Los 14 nombres se muestran tal como los publica el feed («ETBON_VayaSemanita.TV»). Un anclaje feo pero veraz es
preferible a inventar un nombre, y distingue la ficha de la del canal principal. Nombrarlos bien es trabajo de
ingesta de canales, no de enlazado interno: queda como deuda (§11).

---

## 6. Programas y obras

### Programas

Las 29 URLs de `sitemap-programs.xml` son todas **200, indexables y autocanónicas** (comprobadas una a una). Su
problema no es la elegibilidad sino la entrada:

- **0 de 29** están enlazadas desde `/canales`, desde ninguna de las 67 fichas de canal del sitemap, ni desde
  ninguno de los seis hubs (`/`, `que-ver-hoy`, `en-directo`, `peliculas`, `series`, `/canales`). Enumeración
  directa y completa, no muestreo.
- **0 de 29** tienen el enlace gemelo de diseño («Ficha completa de la película / de la serie»): ninguna es una
  ficha de obra verificada, son páginas de programa puro.
- En el rastreo, solo **10 de 29** fueron alcanzadas, a profundidad 3–4, y la ruta es una página de emisión
  `/contenido/program:<id>` («Ver emisiones en TV»). Un muestreo de 60 páginas de emisión de cinco canales
  enlazaba 27 URLs `/programas/` distintas, de las cuales **1** está en el sitemap.

Es decir: la única ruta interna a una ficha de programa indexable es una página `noindex` que se regenera cada
día. No son 29 huérfanas globales — las emisiones sí las enlazan mientras existen — pero su descubribilidad
depende de páginas efímeras, que es un hallazgo estructural, no un defecto puntual.

**No se expone ninguna.** Enlazarlas en masa desde los hubs sería exponer contenido pobre para satisfacer una
métrica de enlazado interno, que es justamente lo que M10-D prohíbe, y además es una decisión de indexación. Lo
que procede es decidir qué fichas de programa tienen valor propio y darles una navegación legítima: queda como
el siguiente hito acotado (§12).

Una de las 29 desaparece con este PR: `/programas/object-object` (§7.2).

### Obras

| Dato | Valor |
|---|---:|
| URLs en `sitemap-works.xml` | 3.825 |
| Alcanzadas a ≤3 clics (medido) | **1.356** |
| Alcanzadas más profundas (cota superior, nivel 4) | 2.101 |
| No medidas en este presupuesto | 368 |

Las obras **sí están interconectadas**: de las 12.469 URLs descubiertas, 3.142 son `/peliculas/:slug` y 439
`/series/:slug`, y aparecen sobre todo a profundidad 3–4, alcanzadas desde las 6.977 páginas de emisión de nivel
3 y desde los raíles de contenido relacionado de otras obras. Los hubs, en cambio, enlazan muy pocas: 2 en
`/programacion-tv/peliculas`, 21 en `/series`, 26 en `que-ver-hoy`, 11 en `/plataformas` — solo las obras que
emiten hoy y tienen identidad verificada.

**Ningún defecto de obra está confirmado.** La diferencia entre «profunda» y «sin ruta» no se puede resolver con
este presupuesto, y no hay base para una corrección dirigida. No se construye ningún índice A–Z ni se promueve
ninguna identidad TMDB ambigua. Un rediseño de la navegación de obras es un hito aparte, no una ampliación
silenciosa de M10-D.

**Identidad:** se mantienen protegidas las 353 relaciones TMDB sin verificar registradas en M10-C.

---

## 7. Correcciones implementadas

### 7.1 El directorio no puede ocultar un canal que el sitemap publica

`filterChannelDirectory` (frontend). Una línea de predicado más una constante que nombra los grupos que el
sitemap publica, con el porqué junto al código. Cambio mínimo y en el único punto donde se decidía: no se añade
componente, ni ruta, ni consulta.

**Por qué no en el backend:** la elegibilidad del sitemap ya vive en `SitemapController.buildChannelsSitemap` y es
correcta. El defecto estaba en que la vista descartaba lo que el sitemap publica. Mover la regla al backend
obligaría a un contrato nuevo entre capas para el mismo resultado.

### 7.2 `/programas/object-object`

Una fila EPG cuyo título es un **objeto**, no una cadena, se convertía en `"[object Object]"` y de ahí en el slug
`object-object`: una página 200, indexable, en `sitemap-programs.xml`, con `<title>` y `<h1>` literalmente
`[object Object]` y la sinopsis de «Rosario desde Lourdes» (EWTN).

Arreglado **una vez en cada slugificador** (`slugify` en backend, `slugifyTitle` en frontend) en lugar de en las
llamadas: esa cadena no es un título, así que toma el camino `sin-titulo` que cada llamante ya excluye de
sitemaps, enlaces internos y resolución de slug — `SitemapController` hace `continue`, `CatalogService` no enlaza,
`VerifiedWorkLinks` lo rechaza como `slug_unresolved`, y las tarjetas no enlazan `/…/sin-titulo`.

La guarda rechaza **solo** la forma `[object …]`, no todo lo que no sea cadena. Un título que llega como array
—XMLTV lo produce cuando una emisión trae varios `<title>`— sigue dando el slug bajo el que su página resuelve
(`['Telediario 2']` → `telediario-2`), así que **ninguna página que hoy funciona pierde su URL**. Este punto salió
de la revisión independiente (§8).

Efecto previsto tras el despliegue: `sitemap-programs.xml` 29 → 28 URLs, y `/programas/object-object` deja de
resolver (404, el mismo trato que cualquier slug sin título). No es desindexación de contenido con valor.

### 7.3 Las fichas de obra ya no enlazan alias de canal que redirigen

**El defecto.** Medido en la ventana del 2026-11-02: **4 URLs de canal que responden 301 recibían 19 enlaces
internos** — `/canales/etb2-tv` (11), `/canales/veo7-tv` (4), `/canales/energy-tv` (3), `/canales/tv3-tv` (1).
Rompía la invariante que M10-C declaró cerrada («0 enlaces internos a redirects»); el rastreo acotado de M10-C
nunca llegó a las páginas que los producen.

**El origen.** La ficha de obra nombraba el canal propio de la emisión. En una muestra de 70 fichas,
`/series/navy-investigacion-criminal` enlazaba `/canales/veo7-tv` con el anclaje «Veo7.TV».
`ChannelFeedAliasResolver` existe exactamente para esto y estaba inyectado en `TvSurfaceService` (superficies de
canal y guía) y en `TvController` (endpoints de lectura), **pero no en `CatalogService`**, que es quien sirve las
fichas de obra y emitía `item.channel.normalizedName` en crudo.

**La corrección.** `CatalogService` recibe el resolutor y presenta cada emisión bajo el canal que el sitio
publica. **La emisión se conserva**: los dos feeds llevan la misma parrilla — eso es justamente lo que convirtió
al par en alias verificado — así que no se pierde ninguna emisión real, solo deja de nombrarse el feed cuya
página redirige. Es la misma regla que las superficies de TV ya aplican («ninguna página lista un alias entre sus
canales relacionados: sería enlazar un redirect»), extendida a las emisiones de una ficha de obra.

Un efecto secundario deseable: la clave de deduplicación de emisiones (`channelId:start:end`) pasa a ser
canónica, así que una misma emisión publicada por los dos feeds se funde en una sola fila en vez de aparecer
repetida.

Sin lista de alias, o si el resolutor lanza, cada emisión se sirve como antes de M10-D: una ficha nunca falla por
esto. Tres tests cubren el alias, el canal que no lo es (incluidas las `.TV` que M10-C mantuvo como canales
propios, que **no** deben tocarse) y la ausencia de lista.

### 7.4 Herramienta de medición

§3. Sin dependencias nuevas; `scripts/seo-link-graph.mjs` sigue siendo el único crawler.

### 7.5 Fuera de ámbito, necesario para la puerta de CI

`main` estaba **rojo antes de esta rama**: PR #132 se fusionó con `frontend` y `verify` en fallo por un error de
lint (`label-has-associated-control`) en el Blog Studio. Un `<label>` nombraba un `role="group"` mediante
`aria-labelledby`, y una etiqueta debe apuntar a un control de formulario. Pasa a `<span>`: mismas clases, mismo
nombre accesible, sin cambio visual. Sin esto no se puede verificar el CI de M10-D.

---

## 8. Tests y revisión independiente

Comandos reales y resultados, ejecutados en Windows contra el HEAD de la rama:

| Comando | Resultado |
|---|---|
| `node scripts/seo-link-graph.mjs --self-check` | **ok** (incluye la semántica M10-D y que las clases particionan el sitemap) |
| `node scripts/seo-crawl.mjs --self-check` | **ok** |
| `npm run test:frontend` | **382/382** (incluye las dos suites nuevas) |
| `npm run test:backend` | 750 tests, **718 pasan**, 29 omitidos, **3 fallan solo en Windows** |
| `node --test scripts/workflows.test.mjs` | **10/10** |
| `npm run test:ops` | 38 tests, **32 pasan**, **6 fallan solo en Windows** |
| `npm run lint:frontend` | **0 errores**, 708 avisos preexistentes |
| `npm run build:backend` | ok |

Los 9 fallos son de entorno, no de comportamiento, y el CI de Linux los pasa:

- backend (3): `tar xzf C:\…` — GNU tar interpreta `C:` como host remoto; y «the private key is owner-only»,
  que compara bits de permiso POSIX (`54 !== 0`) que Windows no expresa.
- ops (6): `bash: /C:/…/deploy-ssh.sh: No such file or directory` — resolución de ruta Windows/POSIX en el
  arnés de pruebas.

**CI del PR #133: 4/4 en verde** sobre el HEAD final, fusionado como `10a2a9b` el 2026-11-02 a las 15:40 UTC.

**Revisión independiente del diff antes de abrir el PR (5 hallazgos, todos corregidos):**

1. **La guarda de título rechazaba todo lo que no fuera cadena**, arrays incluidos. XMLTV produce un array cuando
   una emisión trae varios `<title>`, y `['Telediario 2']` ya daba el slug `telediario-2` bajo el que su página
   resuelve: la guarda lo habría convertido en `sin-titulo`, sacándolo del sitemap y de los enlaces — una
   desindexación accidental de páginas que funcionan. Ahora solo se rechaza la forma `[object …]`, la única que
   produjo `/programas/object-object`. Mismo arreglo en el slugificador de cliente.
2. **`${{ inputs.link_graph_scope }}` se interpolaba dentro del `run:`**, donde su texto se ejecuta en lugar de
   pasarse como argumento — y es precisamente el input que contiene metacaracteres de shell. Ambos inputs pasan
   por `env:` y van citados.
3. **La puerta decía «sin ruta interna»** en un rastreo con una familia sin expandir, donde la evidencia solo
   sostiene «sin ruta dentro del ámbito recorrido».
4. **El contexto de observación sellaba solo la hora de fin**, aunque un rastreo de miles de páginas SSR abarca
   buena parte de una hora y la parrilla se mueve dentro. Registra inicio, fin, ventana de Madrid, minutos y día
   EPG en ambos extremos.
5. Un comentario duplicado.

La revisión Graphify del PR destacó otras cinco advertencias: (1) ejecución de shell por interpolación del destino del proxy; (2) envío silencioso del proxy local a producción; (3) posibles falsos huérfanos cuando hay errores de fetch; (4) huérfanas solo del ámbito contadas como confirmadas; (5) salida --urls-from susceptible a cierre prematuro de pipe.

Hardening realizado en la rama:
- Proxy de desarrollo restaurado al de main; sin probe shell ni fallback automático a producción.
- Traversal gaps detectados para fuentes fallidas; un grafo incompleto no puede verificar huérfanas.
- Separación de counters de confirmedOrphans y scopedOrphans.
- Gate de alcance con PASS / FAIL / INCONCLUSIVE, inconcluso también para URLs requeridas excluidas.
- Los niveles BFS con error no se tratan como totalmente medidos.
- --urls-from admite --out y gestiona EPIPE.
- Self-check obligatorio de crawler añadido al job backend de performance.yml en PR.

**Pendiente:** la verificación SSR real de los 14 canales, que solo da el despliegue. Lo cubierto hasta aquí es
el predicado por test unitario y la respuesta real de la API, no el HTML renderizado.

**No cubierto por ninguna puerta automática:** que `/canales` siga enlazando las 67 URLs del sitemap. El test
unitario cubre el predicado; la invariante de extremo a extremo es `--require-reached sitemap-channels.xml`, y
hoy devuelve `INCONCLUSIVE` porque ningún rastreo acotado de producción la puede sostener (§11). Mientras eso no
se resuelva, la comprobación es el smoke manual de §9.

---

## 9. Verificación en producción

**#133 Y #134 DESPLEGADOS Y VERIFICADOS.** Rollback disponible: `20261029201513` @ `17e44e3`. Todo lo que sigue
se midió contra producción con solo GET.

**§9.0 — tras desplegar el #133** (15:56:40 UTC; la API arrancó a las 15:58:58, `timestamp` 16:45:41,
`uptime` 2.803 s):

| # | Comprobación | Resultado |
|---|---|---|
| 1 | `/canales` en SSR enlaza las 67 URLs de `sitemap-channels.xml` | **PASS**: 318 enlaces de canal, **0 del sitemap ausentes** (eran 14) |
| 1b | Ningún enlace del directorio responde distinto de 200 | **PASS**: 0 |
| 2 | Los 15 alias verificados siguen en 301, query preservada | **PASS**: 15/15; `/canales/telemadrid-tv?d=1` → `/canales/telemadrid?d=1` |
| 3 | Identidades protegidas, 200 y autocanónicas | **PASS**: `cmm-tv`, `castilla-la-mancha-tv`, `etb-1`, `etb1-tv`, `telemadrid`, `telemadridint-tv` — todas distintas, `index, follow` |
| 4 | `/programas/object-object` fuera del sitemap y sin resolver | **PASS**: sitemap 29 → **28**, la página responde **404** |
| 5 | Cero enlaces internos a URLs de canal que redirijan | **FALLA, esperado**: `/series/navy-investigacion-criminal` sigue enlazando `/canales/veo7-tv` (301). Es la corrección del §7.3, que va en el **#134 y no está desplegada** |
| 6 | Modern Family y Gladiator sin regresión | **PASS**: 200, autocanónicas, `index, follow` |
| 7 | Salud de API y sitemaps servidos | **PASS**: `healthy`, rss 312–375 MB, los 5 sitemaps 200 |

El punto 5 era la única comprobación en rojo, y confirmaba a la vez el diagnóstico y la necesidad de la
corrección: el defecto seguía reproduciéndose en producción tal como se describió.

### 9.1 Tras desplegar el #134 (2026-11-02, 17:18:18 UTC)

Despliegues del día, todos lanzados por el propietario: **15:56:40 UTC** → #133 · **17:18:18 UTC** → #134 (la API
arrancó a las 17:20:56; `timestamp` 19:46:41, `uptime` 8.745 s) · **19:29:43 UTC** → #135 (solo documentación).

| # | Comprobación | Resultado |
|---|---|---|
| 1 | `/canales` enlaza las 67 URLs de `sitemap-channels.xml` | **PASS**: 320 enlaces de canal, **0 del sitemap ausentes** |
| 1b | Ningún enlace del directorio responde distinto de 200 | **PASS**: 0 |
| 2 | Los 15 alias verificados en 301, query preservada | **PASS**: 15/15; `?d=1` preservado |
| 3 | Identidades protegidas, 200 y autocanónicas | **PASS**: las seis, todas distintas, `index, follow` |
| 4 | `/programas/object-object` fuera del sitemap y sin resolver | **PASS**: fuera, y la página responde **404** |
| **5** | **Cero enlaces internos a URLs de canal que redirijan** | **PASS** — ver abajo |
| 6 | Modern Family y Gladiator sin regresión | **PASS**: 200, autocanónicas, `index, follow` |
| 7 | Salud de API y sitemaps servidos | **PASS**: `healthy`, rss 338 MB, índice con 5 hijos |

**El punto 5, probado sobre una emisión de alias real.** `tvg2_tv` («TVG2.TV», alias verificado de TVG 2) emitía
hoy *Bonanza* con `workPath`. La ficha `/series/bonanza` nombra **`/canales/tvg-2`**, HTTP **200**, con el anclaje
«TVG 2». Antes de la corrección habría enlazado `/canales/tvg2-tv`, que responde 301. Es la corrección del §7.3
actuando sobre el caso que la motivó.

Esta comprobación es válida porque había una emisión de alias listada en ese momento; §9.2 explica por qué una
muestra sin esa condición no prueba nada, y el rastreo completo es lo que lo cierra sobre las 3.825 fichas.

**Nota sobre `sitemap-programs.xml`:** 29 → 28 (salida de `object-object`, efecto del hito) y después 22, que es
variación de la ventana EPG de hoy/mañana, **no** un efecto de M10-D. No atribuir esa segunda caída al hito.

### 9.2 Smoke tests a repetir en cada despliegue que toque enlazado

1. `/canales` en SSR enlaza **las 67** URLs de `sitemap-channels.xml` — los 14 recuperados incluidos — y **cero**
   alias que redirijan. Es la comprobación central del hito y la única que falta por completo.
2. Los 15 alias verificados siguen en 301 con la query preservada.
3. Identidades protegidas autocanónicas y distintas: `etb1-tv` / `etb-1`, `cmm-tv` / `castilla-la-mancha-tv`,
   `telemadridint-tv` / `telemadrid`.
4. `/programas/object-object` fuera de `sitemap-programs.xml` (29 → 28) y sin resolver.
5. **Cero enlaces internos a URLs de canal que redirijan** desde fichas de obra. **No lo compruebes con una
   muestra de páginas**: el defecto son 19 instancias repartidas entre 3.825 fichas, y el raíl de emisiones
   depende de la parrilla del momento. Medido a las 18:0x del 2026-11-02: solo **10 de 120** fichas muestreadas
   listaban alguna emisión, y `/series/navy-investigacion-criminal` —el reproductor que este informe citaba a las
   16:5x— ya decía «No hay emisiones programadas». Una muestra da **PASS por ausencia de emisiones**, no por la
   corrección. La comprobación válida es el rastreo perenne completo:
   `summary.linkInstancesToRedirects` debe pasar de **19 a 0**.
6. Modern Family y Gladiator sin regresión de canonical ni robots.
7. Salud de API y SSR, y el sitemap servido.

Registrar SHA de release y rollback a la release previa verificada (`20261029201513` @ `17e44e3`).

**Un solo rastreo cierra los dos frentes abiertos.** Repetir el rastreo perenne a `--concurrency 2` con la parada
por salud, en ventana de baja carga, da a la vez:

- `summary.linkInstancesToRedirects` 19 → 0, que es el punto 5 comprobado sobre **todas** las fichas de obra;
- `crawlReliable: true` si no hay 503, y con ello las 28 fichas de programa pasan de `UNMEASURED` a
  `ORPHAN_IN_SCOPE`: el primer recuento de huérfanas defendible del proyecto.

Compararlo con el rastreo B sobre la **misma población** (`--urls-from`), no con el rastreo A, que es de otro
ámbito.

---

## 10. Criterios de aceptación

| AC | Estado | Base |
|---|---|---|
| 01 Reproducibilidad | **PASS**: clasificación versionada, comandos en §3, ámbito y ventana grabados; el rastreo perenne se agotó y es repetible | §3 |
| 02 Sin falsas huérfanas | **PASS**: 0 afirmadas; la orfandad exige cola agotada, presupuesto no agotado y cero fuentes ilegibles; el self-check lo exige | §3 |
| 03 Corrección temporal | **PASS**: ventana de observación completa; comparación sobre población fija con `--urls-from` | §3 |
| 04 Inventario de canales | **PASS**: 14 de 67 clasificados uno a uno con evidencia por canal | §5 |
| 05 Remediación de canales | **PASS**: corregido, con test, desplegado y **verificado en producción**: 0 de 67 canales del sitemap fuera del directorio | §5, §9 |
| 06 Programas | **PASS**: las 29 medidas; el rastreo agotado confirma que las 28 restantes son las **únicas** URLs del sitemap sin ruta perenne, y ninguna se expone | §4, §6 |
| 07 Obras | **PASS**: el rastreo perenne agotado alcanza **3.825/3.825**; ningún defecto confirmado y ninguna corrección inventada | §4, §6 |
| 08 SEO seguro | **PASS**: 0 enlaces no canónicos, 0 destinos rotos, identidades protegidas intactas, sitemap −1 URL de basura; verificado en producción | §4, §7, §9 |
| 09 Calidad y release | **PASS**: CI en verde en los tres PR, fusionados, desplegados y verificados en producción | §8, §9 |
| 10 Roadmap honesto | **PASS**: M10 sigue PARTIAL | §12 |
| 11 Operaciones seguras | **PARCIAL**: 0 escrituras y solo GET. El reinicio de la API fue el despliegue, no el rastreo (rectificado en §3); pero mi concurrencia 4 sí provocó 17 × 503, y la parada por salud que el hito pedía faltaba. Ya implementada, y el workflow baja a concurrencia 2 | §3 |
| 12 Documentación | **PASS**: este registro, con la evidencia de producción y dos rectificaciones de mis propias conclusiones | §3, §9 |

**M10-D = PARCIAL.** Ocho AC en PASS, tres parciales y ninguno fingido. Lo que falta es concreto: desplegar el #134 y repetir el rastreo perenne a concurrencia 2 para que `crawlReliable` pase a `true` y las 28 fichas de programa dejen de ser `UNMEASURED`.

---

## 11. Riesgos y deuda restante

- El crawler de producción puede detenerse por presupuesto, por fallos de lectura o por salud degradada;
  INCONCLUSIVE es un resultado válido y no debe degradarse a PASS.
- **Concurrencia 4 es demasiada para este host.** Medido: 17 × 503 en el rastreo perenne, todas 200 en reposo.
  A concurrencia 2 y con la parada por salud el mismo rastreo debería dar `crawlReliable: true`.
- El criterio original de M10 está a un rastreo limpio de poder cerrarse: el grafo perenne **se agota** en 41
  minutos y 4.727 páginas, y solo 17 fuentes ilegibles (por mi propia carga) impiden convertir las 28 fichas de
  programa en un recuento de huérfanas defendible.
- 29 fichas de programa indexables dependen de enlaces de emisiones efímeras. Su política SEO necesita una decisión posterior basada en calidad y utilidad.
- CMM TV / Castilla la Mancha TV y ETB1.TV / ETB 1 mantienen identidades separadas hasta pruebas concluyentes.
- 353 identidades TMDB ambiguas siguen protegidas.
- **Ingesta de nombres de canal.** El nombre visible de los 14 canales recuperados es el id crudo del feed
  («ETBON_VayaSemanita.TV»). El anclaje es veraz y distingue la ficha de la del canal principal, pero nombrarlos
  bien es trabajo de ingesta — y debe resolverse nombrando, nunca fusionando canales distintos.
- **Títulos no-texto en la ingesta.** El `[object Object]` sigue apareciendo como *título mostrado* en la tarjeta
  de guía de esa emisión: M10-D corta el slug y la URL indexable, no el texto de presentación.
- Sitemap enviado a GSC no equivale a indexación comprobada.
- Producción sigue en release anterior hasta verificar un nuevo despliegue.

---

## 12. Estado del roadmap

- **M10-D:** **PARCIAL**. Ingeniería completa, revisada (10 hallazgos, todos corregidos), CI 4/4, fusionada como
  `10a2a9b`, **desplegada y verificada en producción** (§9: 6 de 7 smokes en verde). Falta desplegar el **#134**
  —la corrección de los alias de canal en fichas de obra, el único smoke en rojo— y repetir el rastreo perenne a
  concurrencia 2 para que `crawlReliable` pase a `true`.
- **M10 global:** **PARCIAL**, y por primera vez con la distancia medida. El rastreo perenne **se agota** (4.727
  páginas, 41 min, frontera 0) y alcanza 3.934 de las 3.962 URLs del sitemap: todos los canales, todas las obras,
  todas las estáticas y guías. Las **28** que no alcanza son todas fichas de programa. Lo único que impide
  convertirlas en un recuento de huérfanas son 17 fuentes que respondieron 503 por mi propia concurrencia. No se
  marca DONE, pero ya no es una incógnita: es un rastreo limpio de distancia.
- **M11-B:** PARCIAL, con dependencia M04-B sin cumplir.
- **M12:** **NO-GO** conforme a [M12-ENTRY-GATE.md](M12-ENTRY-GATE.md): M10 sigue parcial, M11-B sin cumplir, y
  no hay kill switch de indexación, tope de lote, puerta por URL ni línea base de GSC. M10-D no cambia ninguna
  de esas condiciones.

### Siguiente hito propuesto, **no iniciado**

**Cerrar el criterio de M10: un rastreo perenne limpio y la decisión sobre las 28 fichas de programa.** Es el
hito más pequeño que aporta valor, y es pequeño porque M10-D ya dejó la medición hecha:

1. repetir el rastreo perenne a `--concurrency 2` con la parada por salud, en ventana de baja carga, hasta
   obtener `crawlReliable: true`. Eso convierte las 28 en el primer `ORPHAN_IN_SCOPE` defendible del proyecto —
   o las descarta, si alguna de las 17 fuentes ilegibles resulta enlazarlas;
2. con ese número, decidir qué fichas de programa indexables merecen una entrada perenne y darles una navegación
   legítima, sin enlazado masivo ni `noindex` indiscriminado. Las que no la merezcan salen del sitemap, que es
   una decisión de elegibilidad, no de enlazado.

El «Modo 2» (grafo desde instantánea de sólo lectura, validado contra SSR) deja de ser imprescindible: sirve
como respaldo si la variabilidad de la parrilla hace que el rastreo nunca quede limpio.

Los tres defectos de higiene que M10-D encontró están corregidos (§7.1, §7.2, §7.3), así que el hito siguiente
es de evidencia y de política, no de arreglos pendientes.
