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
| Ninguna huérfana inventada a partir de un crawl incompleto | **PARTIAL**: se exige además ausencia de errores de traversal; pendiente CI final | §3 |
| Corrección temporal (ventana de observación registrada) | **PASS** | §3 |
| Inventario de canales del sitemap sin ruta interna, clasificado | **PASS**: 14 de 67, uno a uno | §5 |
| Defectos de descubrimiento de canal corregidos y con test de regresión | **PASS** (ingeniería); pendiente de despliegue | §5, §7 |
| Población de programas medida, sin exponer páginas pobres | **PASS** | §6 |
| Alcance de obras medido lo suficiente para separar defecto de no medido | **PARCIAL**: el grafo perenne excede el presupuesto seguro de un crawl de producción | §4, §6 |
| Seguridad SEO (sin desindexación, canonical ni inflación de sitemap) | **PASS** | §7, §9 |
| Tests, CI y revisión independiente | **PENDIENTE**: CI final y re-review | §8 |
| Despliegue y verificación en producción | **PENDIENTE**: requiere que el propietario lance el workflow | §9 |
| **M10-D** | **PARCIAL**: hardening implementado; aún faltan CI, SSR y producción | |

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

Último avance del rastreo de producción comunicado: **1.841 páginas descargadas**, nivel 4 y **frontera de 8.355 URLs**. No se dispone de un artefacto exhaustivo de resultados; el número de huérfanas globales **NO está verificado**. La lógica se ha endurecido: un crawl terminado pero con errores de descarga tampoco puede verificar huérfanas. Los fallos dejan URLs en UNMEASURED, los ámbitos excluidos quedan en ORPHAN_IN_SCOPE solo si la traversía es fiable; confirmedOrphans cuenta exclusivamente VERIFIED_ORPHAN. El control de canales devuelve PASS (0), FAIL (1) o INCONCLUSIVE (2), sin PASSES engañosos.

---

## 4. Alcance antes / después

| Indicador | Línea base verificada | Tras los cambios |
|---|---:|---|
| Sitemap total, 2026-11-02 | 3.962 | Pendiente de deploy |
| Canales en sitemap | 67 | 67 previstos; sin verificación productiva |
| Canales del sitemap fuera del directorio | **14** | **0 sobre datos reales con el nuevo predicado; SSR pendiente** |
| Alias verificados visibles | 0 | 0 según predicado; SSR pendiente |
| Programas indexables en sitemap | 29 | 28 previstos; sitemap en prod pendiente |
| Obras en sitemap | 3.825 | Pendiente |
| URLs dentro de 3 clics | No comparable con M10-C | Pendiente de crawl fiable |
| Confirmed global orphans | No medido | **No medido** |
| Unmeasured / scoped orphans | No medido | Pendiente de crawl fiable |

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

**Programas:** la evaluación previa identificó **29 fichas indexables** del sitemap sin enlaces entrantes desde páginas perennes; los enlaces observados procedían de emisiones efímeras noindex. Esto no demuestra que sean 29 huérfanas globales, porque el ámbito perenne excluye las emisiones. Se exige decisión posterior sobre contenido realmente valioso y una navegación legítima, sin enlazado masivo ni noindex indiscriminado.

**Obras:** sitemap-works contenía 3.825 URLs. Sin grafo final exhaustivo y libre de errores no hay conteos de profundidad definitivos ni huérfanas verificadas.

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

### 7.3 Herramienta de medición

§3. Sin dependencias nuevas; `scripts/seo-link-graph.mjs` sigue siendo el único crawler.

### 7.4 Fuera de ámbito, necesario para la puerta de CI

`main` estaba **rojo antes de esta rama**: PR #132 se fusionó con `frontend` y `verify` en fallo por un error de
lint (`label-has-associated-control`) en el Blog Studio. Un `<label>` nombraba un `role="group"` mediante
`aria-labelledby`, y una etiqueta debe apuntar a un control de formulario. Pasa a `<span>`: mismas clases, mismo
nombre accesible, sin cambio visual. Sin esto no se puede verificar el CI de M10-D.

---

## 8. Tests y revisión independiente

Resultados reportados por la implementación original, no por la última revisión: frontend 382/382, pruebas de detalle backend, 10 pruebas de workflows y self-check de crawler, con lint frontend limpio. El último HEAD debe superar nuevamente CI.

La revisión Graphify del PR destacó cinco advertencias: (1) ejecución de shell por interpolación del destino del proxy; (2) envío silencioso del proxy local a producción; (3) posibles falsos huérfanos cuando hay errores de fetch; (4) huérfanas solo del ámbito contadas como confirmadas; (5) salida --urls-from susceptible a cierre prematuro de pipe.

Hardening realizado en la rama:
- Proxy de desarrollo restaurado al de main; sin probe shell ni fallback automático a producción.
- Traversal gaps detectados para fuentes fallidas; un grafo incompleto no puede verificar huérfanas.
- Separación de counters de confirmedOrphans y scopedOrphans.
- Gate de alcance con PASS / FAIL / INCONCLUSIVE, inconcluso también para URLs requeridas excluidas.
- Los niveles BFS con error no se tratan como totalmente medidos.
- --urls-from admite --out y gestiona EPIPE.
- Self-check obligatorio de crawler añadido al job backend de performance.yml en PR.

**Pendiente:** CI verde del nuevo HEAD, revisión final y verificación SSR real de los 14 canales. No hay declaración de tests completos sin esas evidencias.

---

## 9. Verificación en producción

**NO DESPLEGADO**. PR #133 continúa abierto a fecha de esta actualización. No hay release M10-D verificada ni ID de rollback asignado. El agente no dispone de disparo del workflow deploy-artifact.yml.

Smoke tests exigidos tras el despliegue: directorio SSR enlaza los 14 canales recuperados y cero alias; 15 redirecciones 301 y parámetros preservados; identidades ETB1.TV, CMM TV y Telemadrid internacional autocanónicas; /programas/object-object excluida del sitemap; Modern Family y Gladiator sin regresiones; sitemap, robots, canonical y salud de la API y SSR. Registrar SHA de release y rollback a la release previa verificada.

---

## 10. Criterios de aceptación

| AC | Estado provisional |
|---|---|
| 01 Reproducibilidad | PARTIAL: no artefacto completo |
| 02 No falsos huérfanos | PARTIAL: corrección pendiente de CI |
| 03 Temporalidad | PASS de implementación |
| 04 Inventario de canales | PASS de diagnóstico: 14/67 |
| 05 Remediación canales | PARTIAL: SSR real pendiente |
| 06 Programas | PARTIAL: 29 dependientes de emisiones |
| 07 Obras | PARTIAL: crawl no exhaustivo |
| 08 SEO seguro | PARTIAL: producción sin validar |
| 09 Calidad y release | PARTIAL: CI/merge/deploy pendientes |
| 10 Roadmap honesto | PASS: M10 sigue PARTIAL |
| 11 Operaciones seguras | PARTIAL: pruebas actualizadas pendientes |
| 12 Documentación | PARTIAL: falta evidencia final |

**M10-D = PARTIAL**, sin fingir implementación ni despliegue completos.

---

## 11. Riesgos y deuda restante

- El crawler de producción puede detenerse por presupuesto o fallos de lectura; INCONCLUSIVE es un resultado válido y no debe degradarse a PASS.
- 29 fichas de programa indexables dependen de enlaces de emisiones efímeras. Su política SEO necesita una decisión posterior basada en calidad y utilidad.
- CMM TV / Castilla la Mancha TV y ETB1.TV / ETB 1 mantienen identidades separadas hasta pruebas concluyentes.
- 353 identidades TMDB ambiguas siguen protegidas.
- Los nombres crudos de feeds deben mejorar en la ingesta, sin resolverlo con fusiones incorrectas.
- Sitemap enviado a GSC no equivale a indexación comprobada.
- Producción sigue en release anterior hasta verificar un nuevo despliegue.

---

## 12. Estado del roadmap

- **M10-D:** PARTIAL; hardening subido a PR #133, faltan tests finales, review independiente, merge, deploy, SSR y evidencias de crawl.
- **M10 global:** PARTIAL; criterio original de páginas indexables sin rutas internas no cerrado globalmente.
- **M11-B:** PARTIAL, con dependencia M04-B sin cumplir.
- **M12:** NO-GO conforme a M12-ENTRY-GATE.md.
- **Siguiente milestone propuesto, no iniciado:** decisión acotada sobre navegación y elegibilidad SEO de programas indexables sin entrada perenne. No comenzar hasta el cierre de M10-D.
