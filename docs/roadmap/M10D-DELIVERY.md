# M10-D: rastreabilidad determinista, canales inalcanzables y títulos que no son texto

Fecha: 2026-11-02. Rama `feature/m10d-deterministic-reachability`, base `origin/main` @ `76c0bbe` (PR #132).
PR [#133](https://github.com/manuelxose/guiatv/pull/133), fusionado con squash como **`10a2a9b`** el 2026-11-02 a
las 15:40 UTC, con CI 4/4 en verde. Producción sigue en el release de M10-C: el despliegue lo lanza el
propietario.

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
| Defectos de descubrimiento de canal corregidos y con test de regresión | **PASS** (ingeniería); pendiente de despliegue | §5, §7 |
| Población de programas medida, sin exponer páginas pobres | **PASS** | §6 |
| Alcance de obras medido lo suficiente para separar defecto de no medido | **PARCIAL**: 1.356 a ≤3 clics medidas y 2.101 más profundas, pero 368 sin medir; ningún defecto confirmado | §4, §6 |
| Seguridad SEO (sin desindexación, canonical ni inflación de sitemap) | **PASS** | §7, §9 |
| Enlaces internos a destinos canónicos | **PASS**: 0 enlaces no canónicos; los 4 alias de canal que recibían 19 enlaces desde fichas de obra, corregidos | §4, §7.3 |
| Tests, CI y revisión independiente | **PASS**: CI 4/4 sobre el HEAD final, fusionado como `10a2a9b`; dos revisiones independientes, 10 hallazgos, todos corregidos | §8 |
| Seguridad operativa del rastreo | **FAIL en la ejecución, corregido**: el rastreo a concurrencia 4 coincidió con un reinicio de la API y un 503 en `/canales`; faltaba la parada por salud, ya implementada | §3 |
| Despliegue y verificación en producción | **PENDIENTE**: requiere que el propietario lance el workflow | §9 |
| **M10-D** | **PARCIAL**: ingeniería completa, revisada, con CI verde y fusionada; la verificación en producción falta porque el despliegue lo lanza el propietario | |

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

### Seguridad operativa: el rastreo degradó producción

Solo GET, timeout 30 s, un reintento en 429/5xx, sin escrituras ni rutas autenticadas. Pero **la concurrencia 4
fue demasiada para este host y hay que decirlo**:

- A las 14:30 UTC `/v2/health` daba `uptime` 279.265 s (3,2 días). Tras el rastreo de 4.000 páginas
  (15:28–15:56 UTC) el `uptime` era de **2.177 s**: la API **se reinició** al final de esa ventana. El
  `CatalogService` ya documenta en sus comentarios episodios previos de OOM en bucle.
- En un rastreo posterior, `/canales` respondió **503** con 26 instancias de enlace entrantes. Es la única
  página del sitio que lista canales, así que ese rastreo solo descubrió 13 fichas de canal en lugar de ~300:
  **un 503 en una página central invalida silenciosamente la medición completa**.

Comprobar la salud antes y después no basta. El hito pedía «parar si la salud de la aplicación se degrada» y
esa comprobación **faltaba**. Ahora el rastreo sondea `--health` cada 250 páginas y se detiene solo si la
respuesta no es `healthy`, registrando `stoppedBy`; un endpoint de salud inalcanzable cuenta como degradado. El
agotamiento —lo único que autoriza una afirmación de orfandad— exige además no haberse interrumpido por salud.
El workflow baja a `--concurrency 2`.

Estado al cerrar el hito: `/v2/health` `healthy`, `/canales` 200 en 125–353 ms, rss 668 MB. No hubo escrituras
en producción en ningún momento.

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

### ¿Se puede agotar el grafo perenne? Medido: no desde aquí

Un rastreo con ámbito correcto (`excludes ^/contenido/`, 746 páginas de emisión excluidas, lo que prueba que la
exclusión funciona) gastó 700 páginas y dejó **frontera de 1.553** con 2.253 URLs perennes ya descubiertas. El
grafo perenne está dominado por las obras y es de varios miles de páginas; al ritmo observado (~1,1 páginas/s)
agotarlo son más de 90 minutos de carga sostenida — y a concurrencia 4 ya reiniciamos la API.

**Conclusión: el criterio original de M10 no se puede cerrar con un rastreo HTTP de producción.** Hace falta el
«Modo 2» que M10-D no implementó: construir el grafo desde una instantánea de sólo lectura y validarlo contra una
muestra de SSR. Eso es §12, y es una conclusión medida, no una excusa.

Ese mismo rastreo es además el que sufrió el 503 de `/canales`, así que **sus cifras de canal no se usan en
ningún sitio de este informe**; sirve solo para la forma de la frontera.

---

## 4. Alcance antes / después

Línea base medida en la ventana 16:28–16:56 (Madrid) del 2026-11-02, ámbito completo, profundidad exacta hasta 3.
La columna «después» solo puede llenarse con un rastreo sobre la **misma población** (`--urls-from`) tras el
despliegue; nada de lo que hay aquí se compara con las cifras de M10-C, tomadas con otro método y otra hora.

| Clase (de las 3.962 URLs del sitemap) | Línea base | Tras los cambios |
|---|---:|---|
| `REACHED_WITHIN_3` (hecho medido) | **1.455** | pendiente de despliegue |
| `REACHED_DEEPER` (cota superior) | 2.109 | pendiente |
| `UNMEASURED` | 398 | pendiente |
| `VERIFIED_ORPHAN` | **0, y no afirmable** (§3) | no afirmable sin rastreo agotado |
| `ORPHAN_IN_SCOPE` | 0 | pendiente |
| `INVALID_DESTINATION` | 0 | pendiente |
| `TEMPORARY_FETCH_FAILURE` | 0 | pendiente |
| Canales del sitemap sin entrada en el directorio | **14** | **0** sobre la API real; SSR tras el despliegue |
| Destinos internos que redirigen / instancias | **4 / 19** | **0 / 0** previstos (§7.3) |

Por fichero de sitemap, con la profundidad mínima medida:

| Sitemap | URLs | ≤3 clics | Más profundas | No medidas |
|---|---:|---:|---:|---:|
| `sitemap-static.xml` | 23 | **23** | 0 | 0 |
| `sitemap-channels.xml` | 67 | **56** (4 a 1 clic, 49 a 2, 3 a 3) | 0 | **11** |
| `sitemap-programs.xml` | 29 | **2** | 8 | **19** |
| `sitemap-blog.xml` | 18 | **18** | 0 | 0 |
| `sitemap-works.xml` | 3.825 | **1.356** (12 a 1, 168 a 2, 1.176 a 3) | 2.101 | **368** |

Higiene de enlaces internos en la misma ventana:

| Indicador | Línea base | Nota |
|---|---:|---|
| Destinos internos rotos | **1** | `/series/2020-britains-most-notorious-crime-investigations` (404) desde `/plataformas`: residual M10 conocido, slug de búsqueda TMDB |
| Enlaces a URLs no canónicas | **0** | invariante M10-C preservada |
| Destinos que redirigen / instancias | **4 / 19** | alias de canal verificados enlazados desde fichas de obra: **corregido** en §7.3, 0 previstos tras el despliegue |
| Cadenas de redirección | **0** | |
| Anclajes vacíos / genéricos | **0 / 0** | |
| Destinos `noindex` enlazados | 2.016 | las páginas de emisión, por diseño |
| Destinos con parámetros | 1.327 | filtros de plataforma y `/v2/affiliate/go/*` |
| Programa → obra / obra → programa | 151 / 20 | |
| Obra → canal / programa → canal | 235 / 133 | |

No comparar muestras de distintas ventanas EPG como mejoras causales.

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

**NO DESPLEGADO**. PR #133 continúa abierto a fecha de esta actualización. No hay release M10-D verificada ni ID de rollback asignado. El agente no dispone de disparo del workflow deploy-artifact.yml.

Smoke tests exigidos tras el despliegue:

1. `/canales` en SSR enlaza **las 67** URLs de `sitemap-channels.xml` — los 14 recuperados incluidos — y **cero**
   alias que redirijan. Es la comprobación central del hito y la única que falta por completo.
2. Los 15 alias verificados siguen en 301 con la query preservada.
3. Identidades protegidas autocanónicas y distintas: `etb1-tv` / `etb-1`, `cmm-tv` / `castilla-la-mancha-tv`,
   `telemadridint-tv` / `telemadrid`.
4. `/programas/object-object` fuera de `sitemap-programs.xml` (29 → 28) y sin resolver.
5. **Cero enlaces internos a URLs de canal que redirijan** desde fichas de obra. Muestra mínima:
   `/series/navy-investigacion-criminal` debe nombrar `/canales/veo7`, no `/canales/veo7-tv`.
6. Modern Family y Gladiator sin regresión de canonical ni robots.
7. Salud de API y SSR, y el sitemap servido.

Registrar SHA de release y rollback a la release previa verificada (`20261029201513` @ `17e44e3`). El rastreo
posterior debe hacerse sobre la **misma población** (`--urls-from`) y a concurrencia ≤ 2.

---

## 10. Criterios de aceptación

| AC | Estado | Base |
|---|---|---|
| 01 Reproducibilidad | **PASS**: clasificación versionada, comandos en §3, ámbito y ventana grabados en el artefacto | §3 |
| 02 Sin falsas huérfanas | **PASS**: 0 afirmadas; la orfandad exige cola agotada, presupuesto no agotado y cero fuentes ilegibles; el self-check lo exige | §3 |
| 03 Corrección temporal | **PASS**: ventana de observación completa; comparación sobre población fija con `--urls-from` | §3 |
| 04 Inventario de canales | **PASS**: 14 de 67 clasificados uno a uno con evidencia por canal | §5 |
| 05 Remediación de canales | **PARTIAL**: corregido y con test; 0 canales fuera del directorio sobre la API real; **SSR en producción sin verificar** | §5, §9 |
| 06 Programas | **PASS**: 29 medidas, con la ruta identificada (emisiones efímeras) y sin exponer ninguna | §6 |
| 07 Obras | **PARTIAL**: 1.356 a ≤3 clics medidas, 2.101 más profundas, 368 no medidas; ningún defecto confirmado, ninguna corrección inventada | §6 |
| 08 SEO seguro | **PARTIAL**: 0 enlaces no canónicos, 0 cambios de canonical/robots/elegibilidad, sitemap −1 URL de basura; producción sin validar | §4, §7 |
| 09 Calidad y release | **PARTIAL**: CI 4/4 y merge `10a2a9b`; **despliegue y verificación pendientes** | §8, §9 |
| 10 Roadmap honesto | **PASS**: M10 sigue PARTIAL | §12 |
| 11 Operaciones seguras | **FAIL en la ejecución, corregido en la herramienta**: 0 escrituras y solo GET, pero el rastreo a concurrencia 4 coincidió con un reinicio de la API y un 503 en `/canales`. Faltaba la parada por salud que el hito pedía; ya está, y el workflow baja a concurrencia 2 | §3 |
| 12 Documentación | **PARTIAL**: este registro; falta la evidencia de producción | — |

**M10-D = PARTIAL**, sin fingir implementación ni despliegue completos.

---

## 11. Riesgos y deuda restante

- El crawler de producción puede detenerse por presupuesto, por fallos de lectura o por salud degradada;
  INCONCLUSIVE es un resultado válido y no debe degradarse a PASS.
- **Este host no aguanta un rastreo exhaustivo de producción.** Medido: reinicio de la API a concurrencia 4 y un
  503 en `/canales`. La parada por salud evita repetirlo, pero no convierte el rastreo en exhaustivo.
- Con `crawlReliable` exigiendo cero huecos de traversía y cero fallos de descarga, **un rastreo acotado de
  producción casi nunca podrá sostener una afirmación de orfandad**. Es correcto, y significa que el criterio
  original de M10 («ninguna página de detalle indexable huérfana») necesita o un rastreo con ámbito que agote el
  grafo perenne, o un grafo construido desde una instantánea de sólo lectura de la base de datos y validado
  contra SSR. Ese es el trabajo que queda, no una afirmación que se pueda cerrar con la herramienta actual.
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

- **M10-D:** **PARCIAL**. Ingeniería completa, revisada (10 hallazgos, todos corregidos), CI 4/4 y fusionada
  como `10a2a9b`. Falta el despliegue — lo lanza el propietario — y con él la verificación SSR de los 14 canales
  y la columna «después» de §4 sobre la misma población.
- **M10 global:** **PARCIAL**. Su criterio original — «ninguna página de detalle indexable huérfana» — sigue sin
  cerrarse, y ahora se sabe *por qué* no se puede cerrar con la herramienta actual: un rastreo acotado de
  producción nunca reúne la evidencia que una afirmación de orfandad exige (§11). No se marca DONE.
- **M11-B:** PARTIAL, con dependencia M04-B sin cumplir.
- **M12:** **NO-GO** conforme a [M12-ENTRY-GATE.md](M12-ENTRY-GATE.md): M10 sigue parcial, M11-B sin cumplir, y
  no hay kill switch de indexación, tope de lote, puerta por URL ni línea base de GSC. M10-D no cambia ninguna
  de esas condiciones.

### Siguiente hito propuesto, **no iniciado**

**Alcance perenne de obras y programas: construir el grafo desde una instantánea de sólo lectura.** Es lo único
que convierte el criterio de M10 en algo demostrable, y lo que desbloquea los dos defectos que M10-D midió pero
no pudo cerrar:

1. construir el grafo de enlaces desde los modelos del repositorio y los datos de navegación generados, validado
   contra una muestra de respuestas SSR — el «Modo 2» que M10-D no implementó — para que la orfandad se decida
   sobre un grafo completo en lugar de un presupuesto de HTTP;
2. con ese grafo, decidir qué fichas de programa indexables merecen una entrada perenne y dar a esas una
   navegación legítima, sin enlazado masivo ni `noindex` indiscriminado.

Los dos defectos de higiene que M10-D encontró ya están corregidos aquí (§7.1, §7.2, §7.3), así que el hito
siguiente es de evidencia, no de arreglos pendientes.
