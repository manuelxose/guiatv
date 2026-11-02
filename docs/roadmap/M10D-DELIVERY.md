# M10-D: rastreabilidad determinista, canales inalcanzables y títulos que no son texto

Fecha: 2026-11-02. Rama `feature/m10d-deterministic-reachability`, base `origin/main` @ `76c0bbe` (PR #132).
PR [#133](https://github.com/manuelxose/guiatv/pull/133).

A diferencia de M10-C, **este entorno de agente sí tiene ruta a producción**, así que todas las mediciones se
hicieron por HTTP directo contra `https://guiaprogramaciontv.com` (solo GET, sin escrituras). No hizo falta el
workflow temporal que M10-C necesitó.

---

## 1. Veredicto

| Criterio | Estado | Base |
|---|---|---|
| Metodología de medición reproducible y con cobertura explícita | **PASS** | §3 |
| Ninguna huérfana inventada a partir de un crawl incompleto | **PASS**: `VERIFIED_ORPHAN` solo lo emite un crawl que agotó la frontera *y* expandió todo lo que encontró | §3 |
| Corrección temporal (ventana de observación registrada) | **PASS** | §3 |
| Inventario de canales del sitemap sin ruta interna, clasificado | **PASS**: 14 de 67, uno a uno | §5 |
| Defectos de descubrimiento de canal corregidos y con test de regresión | **PASS** (ingeniería); pendiente de despliegue | §5, §7 |
| Población de programas medida, sin exponer páginas pobres | **PASS** | §6 |
| Alcance de obras medido lo suficiente para separar defecto de no medido | **PARCIAL**: el grafo perenne excede el presupuesto seguro de un crawl de producción | §4, §6 |
| Seguridad SEO (sin desindexación, canonical ni inflación de sitemap) | **PASS** | §7, §9 |
| Tests, CI y revisión independiente | **PASS** | §8 |
| Despliegue y verificación en producción | **PENDIENTE**: requiere que el propietario lance el workflow | §9 |
| **M10-D** | **PARCIAL**: ingeniería completa y revisada; producción pendiente de despliegue del propietario | |

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
| `VERIFIED_ORPHAN` | no existe ruta interna. Solo cuando el crawl agotó la frontera **y** expandió todo |

Un crawl truncado no puede producir un `VERIFIED_ORPHAN` por construcción. El `--self-check` lo exige, junto con
fronteras truncadas, fallos reintentables, redirecciones y alias, ciclos, duplicados, destinos solo-sitemap y
destinos `noindex`, y comprueba que las clases **particionan** el sitemap.

**`--probe-skipped`.** Muestrea la familia no expandida y dice qué URLs no alcanzadas enlaza de verdad, para
subir (o no) `ORPHAN_IN_SCOPE` sobre evidencia en lugar de suposición.

**Normalización temporal.** `--urls-from` escribe la población de URLs de un crawl, para comparar dos crawls
sobre las mismas URLs. El grafo guardado lleva su **ventana** de observación: inicio, fin, horas de Madrid,
minutos transcurridos, día EPG en ambos extremos, ámbito y frontera pendiente. Un crawl de miles de páginas SSR
abarca buena parte de una hora y la parrilla se mueve dentro: la ventana es la evidencia, no un instante.

**Puerta de regresión.** `--require-reached <sitemap>` falla solo con evidencia — una URL no alcanzada en un
crawl agotado — nunca por falta de presupuesto, y su mensaje sigue a la clase: fuera del ámbito completo dice
«sin ruta dentro del ámbito recorrido», no «sin ruta interna». Está cableada en `seo-regression.yml` para
`sitemap-channels.xml`.

### Seguridad operativa

Solo GET, concurrencia 4, timeout 30 s, un reintento en 429/5xx, sin escrituras ni rutas autenticadas. Ritmo
medido: ~1,7 páginas/s. `/v2/health` siguió `healthy` durante toda la medición.

### Reproducir

```sh
node scripts/seo-link-graph.mjs https://guiaprogramaciontv.com \
  --max 9000 --concurrency 4 --skip-traverse '^/contenido/' --out before-evergreen.json
node scripts/seo-link-graph.mjs --reachability before-evergreen.json --require-reached sitemap-channels.xml
node scripts/seo-link-graph.mjs --urls-from before-evergreen.json > population.txt
node scripts/seo-link-graph.mjs --probe-skipped before-evergreen.json --sample 150
# después del despliegue, sobre la misma población:
node scripts/seo-link-graph.mjs --reachability after-evergreen.json --urls population.txt
node scripts/seo-link-graph.mjs --compare before-evergreen.json after-evergreen.json
```

### Límite demostrado

PENDIENTE_CRAWL_LIMITE

---

## 4. Alcance antes / después

PENDIENTE_TABLA_ALCANCE

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

PENDIENTE_PROGRAMAS_OBRAS

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

### 7.3 Herramienta de medición

§3. Sin dependencias nuevas; `scripts/seo-link-graph.mjs` sigue siendo el único crawler.

### 7.4 Fuera de ámbito, necesario para la puerta de CI

`main` estaba **rojo antes de esta rama**: PR #132 se fusionó con `frontend` y `verify` en fallo por un error de
lint (`label-has-associated-control`) en el Blog Studio. Un `<label>` nombraba un `role="group"` mediante
`aria-labelledby`, y una etiqueta debe apuntar a un control de formulario. Pasa a `<span>`: mismas clases, mismo
nombre accesible, sin cambio visual. Sin esto no se puede verificar el CI de M10-D.

---

## 8. Tests y revisión independiente

PENDIENTE_TESTS

---

## 9. Verificación en producción

PENDIENTE_PRODUCCION

---

## 10. Criterios de aceptación

PENDIENTE_AC

---

## 11. Riesgos y deuda restante

PENDIENTE_RIESGOS

---

## 12. Estado del roadmap

PENDIENTE_ROADMAP
