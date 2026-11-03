# M11-B1 — Valor editorial original en los rankings de plataformas

Ejecutado el **2026-11-03** (Europe/Madrid) sobre `main@59ecd4f`, con la release `20261103023955` en producción. Rama `m11-b1-platform-ranking-pilot`.

Producción solo se leyó: GET públicos y GET del Admin con la clave de analítica. No hubo escrituras en la base de datos, publicaciones, redirecciones, despliegues ni cambios de flags. `CONTENT_LEGACY_ENRICHMENT_ENABLED` no se tocó.

## 1. Veredicto

| Ámbito | Estado | Por qué |
|---|---|---|
| Auditoría (AC-01–03) | **PASS** | Los cinco rankings se midieron sobre su texto actual con un script reproducible (§3) y cada uno tiene una decisión (§4) |
| Ingeniería | **PASS** (pendiente de CI) | Dos cambios pequeños con test: el modo `revises` del CLI y una URL malformada que tumbaba `requeuePost` (§8) |
| Piloto editorial | **HOLD** (correcto) | El pipeline real produjo una revisión diferenciada (Jaccard 0,002 con los otros cuatro), con todas las puertas deterministas en verde y las 19 afirmaciones citadas verificadas. El crítico independiente pidió `revise` en los 6 borradores, y la revisión editorial independiente coincide (§6–§9) |
| Publicación | **NO PUBLICADO** (bloqueo de autorización) | La guía la aprobó una persona («Arturo Baroja»), y `revise-by-policy` solo revisa guías publicadas por la política. Revisarla requiere al revisor con nombre (§7) |

**M11-B1: PARTIAL.** La ingeniería y la auditoría están completas. El piloto queda en HOLD: lo retienen el crítico y un defecto de la puerta de evidencia que falla en modo seguro (§6.4).

## 2. Baseline

- **Git:** `main` = `origin/main` = `59ecd4f35536a925806c71db778f94b60719edb4`, revalidado con `git fetch`. Los cambios locales sin seguimiento (`artifacts/m09b…m11g`, el borrador local `docs/roadmap/M11B-DELIVERY.md` y `docs/seo/m11b-guide-remediation.md`) no se tocaron.
- **Release:** `20261103023955`, leída de `runner.process.cwd` en `GET /v2/admin/editorial/overview` (`/var/www/guiatv/releases/20261103023955/apps/backend`).
- **Corpus público:** 14 guías en `GET /v2/blog?limit=0`.
- **Política editorial** (overview, 2026-11-03):
  - `envEnabled` y `active`, sin parada de emergencia;
  - cupo de **10/día** y 0 aprobaciones en 24 h;
  - clave de firma configurada; proveedores en vivo: anthropic y openai;
  - gasto de 9,27 USD en 30 días antes de este hito.
- **Search Console** (inspección del Admin, 2026-11-03 05:23 UTC, 14 URL, 0 filas de rendimiento):

  | Ranking | Clase |
  |---|---|
  | Netflix | `not-discovered` |
  | Prime Video | `not-discovered` |
  | HBO Max | `not-discovered` |
  | Disney+ | `discovered-not-indexed` |
  | Movistar Plus+ | `discovered-not-indexed` |

  Sin impresiones ni consultas no hay ninguna evidencia de tráfico ni de canibalización real.
- **Operación (hallazgo, sin corregir):**
  - El worktree `guiatv-runner` de la tarea `GuiaTV\EditorialCycle` ya no existe: `git worktree list` lo marca `prunable`. La tarea sigue habilitada y su último resultado es **1**.
  - El gateway local de modelos (OmniRoute, `127.0.0.1:20128`) estaba parado. Se arrancó ligado solo a loopback (`OMNIROUTE_SERVER_HOST=127.0.0.1`), porque por defecto escuchaba en `0.0.0.0` sin clave.

## 3. Auditoría de los cinco rankings

### Inventario

| Guía | Slug | Origen / aprobación | Procedencia M11-B | Verificado | Canonical / robots |
|---|---|---|---|---|---|
| Netflix | `mejores-series-y-peliculas-netflix-espana` | `ai-assisted`, `reviewedBy` = Arturo Baroja, `approved` | ninguna (el Admin responde «AI editorial post not found») | 19-oct (cuerpo) / 20-oct (`publish.json`) | propia `/guias/…`, `index, follow` |
| Prime Video | `…-prime-video-espana` | igual | ninguna | igual | igual |
| Disney+ | `…-disney-plus-espana` | igual | ninguna | igual | igual |
| HBO Max | `…-hbo-max-espana` | igual | ninguna | igual | igual |
| Movistar Plus+ | `…-movistar-plus-espana` | igual | ninguna | igual | igual |

Los cinco se publicaron el 2026-10-19 y no tienen revisiones.
- **Canonical:** el `seo.canonicalUrl` guardado apunta a `/editorial/<slug>`, que responde 301 a `/guias/<slug>`. El HTML servido declara la canonical propia.
- **Correcciones de M11-A:** el texto en vivo es la versión sin corregir de M11-A. No acredita a JustWatch, y el `metaDescription` dice «(octubre 2026)». Las correcciones siguen solo en `docs/seo/editorial-drafts` (06–10).

### Similitud (reproducible)

`node scripts/ranking-similarity.mjs --json artifacts/m11b1/similarity-before.json` lee la API pública y mide dos cosas:
- **Prosa compartida:** líneas de prosa (sin tablas) idénticas en las cinco guías tras sustituir el nombre de la plataforma por un marcador. Es el método de M11-A.
- **Jaccard de 4-gramas:** la misma medida de la puerta `near-duplicate` (0,35 / 0,8).

| Guía | Palabras | Prosa | Compartida con las 4 | Con alguna | Títulos de la tabla que están en otra lista |
|---|---:|---:|---:|---:|---:|
| Netflix | 456 | 317 | **70 %** | 70 % | 9/20 |
| Prime Video | 440 | 318 | **70 %** | 70 % | 11/20 |
| Disney+ | 475 | 328 | **67 %** | 67 % | 10/20 |
| HBO Max | 466 | 324 | **68 %** | 73 % | 16/20 |
| Movistar Plus+ | 455 | 321 | **69 %** | 74 % | 16/20 |

- **Jaccard por pares:** de 0,359 (Prime ~ Disney+) a **0,482** (HBO Max ~ Movistar Plus+). Los **10 pares** superan el umbral `near-duplicate` de 0,35.
- **Títulos:** 65 títulos distintos en 100 huecos.
- **Comparación con M11-A:** M11-A midió ≈ 71 % sobre los borradores. Sobre el texto en vivo hoy sale 67–70 %, así que el hallazgo sigue vigente.

### Calidad, fuentes y huecos (común a los cinco)

- **Estructura:** las cinco guías comparten las mismas secciones (Respuesta corta → Cómo se ha hecho esta lista → dos tablas → Antes de suscribirte → Fuentes). Lo único específico de cada plataforma son las tablas y tres frases rellenadas en huecos.
- **Fuentes:** la única fuente externa es `https://www.themoviedb.org/` (la portada). Las páginas de título de TMDB ya no muestran la nota en texto (se comprobó con *Breaking Bad*: TMDB usa ahora «Vibes»). **Ninguna nota ni recuento de votos de las tablas se puede verificar** con la puerta de evidencia de M11-B.
- **Afirmaciones con fecha:**
  - el catálogo del 20 de octubre, con volatilidad `catalog-ranking` (30 días): revisión vencida el **2026-11-19**;
  - el precio «desde X €» de cada plataforma.
- **Valor original:** no hay análisis editorial. El orden es el de la nota de TMDB, sin datos propios de GuíaTV ni comparación entre fuentes. Con la puerta de M11-B no pasarían `no-distinct-value` ni `near-duplicate`.
- **Afiliación:** no hay enlaces de afiliado en el cuerpo. El riesgo comercial es bajo; el problema es de valor, no de sesgo.
- **Enlaces internos:** las guías de precios y de planes y la programación de hoy. Todos responden 200.
- **Diferencias por plataforma:**
  - HBO Max y Movistar Plus+ comparten 16 de 20 títulos con otras listas, y entre ellas tienen el Jaccard más alto.
  - Netflix es la que menos comparte (9/20).

## 4. Estrategia editorial

Hay cinco intenciones de búsqueda distintas: cada consulta lleva la marca («mejores series Netflix», «mejores series HBO Max»…). Con las cinco en `not-discovered` o `discovered-not-indexed` y sin impresiones, no hay ninguna evidencia que justifique retirar URLs. Se conservan las cinco y no se ejecuta nada en este hito.

| Guía | Decisión | Valor propio verificable para diferenciarla | Si la diferenciación falla |
|---|---|---|---|
| **Netflix** | **Conservar y diferenciar (piloto)** | El Top 10 oficial de Netflix por país (semanal, con fecha) y las condiciones de cada plan en la ayuda oficial (en el plan con anuncios no está todo el catálogo) | — |
| Prime Video | Conservar y diferenciar | Qué entra en la suscripción y qué es alquiler o compra (GuíaTV distingue `flatrate`/`rent`/`buy`); canales de Prime Video | Fusionar en `/guias/rankings` |
| Disney+ | Conservar y diferenciar | Las marcas del catálogo (Disney, Pixar, Marvel, Star Wars, Star), sacadas de la web oficial; perfiles familiares | Fusionar en `/guias/rankings` |
| HBO Max | Conservar, **riesgo alto** | Las producciones propias de HBO, citadas de fuentes oficiales; quitar los títulos que comparte con Movistar Plus+ | Fusionar con Movistar Plus+ en `/guias/rankings` |
| Movistar Plus+ | Conservar, **riesgo alto** | Lo que GuíaTV tiene y las demás no: la programación EPG de sus canales lineales (hechos propios, `/v2/editorial/facts`), la producción propia y el deporte | Fusionar en `/guias/rankings` |

**Plan de URL futuro (no ejecutado; necesita autorización aparte):**
- Destino de una posible fusión: `/guias/rankings`, que hoy responde 200, con canonical propia y `CollectionPage`.
- Ninguna 301 antes de que se cumplan tres condiciones:
  1. un intento de diferenciación de esa plataforma falla con las puertas actuales;
  2. hay al menos 28 días de datos de GSC con impresiones;
  3. el propietario lo autoriza.
- La 301 iría de `/guias/<slug>` a `/guias/rankings#<plataforma>`, con la entrada en las tablas de redirección de Angular y SSR (el test de deriva de M11-A ya las compara).

## 5. Piloto seleccionado: Netflix

**Por qué Netflix:**
- Es la intención con más demanda del grupo.
- Es la que menos títulos comparte con las otras listas (9/20).
- Es la única plataforma con una fuente oficial, con fecha y por país, de lo que se ve: el Top 10 de Tudum para España. Además, esa página se descarga como texto citable.
- Su página de ayuda en España publica, en texto literal, los precios y las limitaciones del catálogo según el plan.
- Riesgo comercial bajo: sin afiliación en el cuerpo.

**Cómo se ejecutó.** Un tema con `revises` del mismo slug (`artifacts/m11b1/topic-netflix.json`), con:
- semillas oficiales: el Top 10 de series, el Top 10 de películas y los planes y precios;
- dos fichas internas del catálogo de GuíaTV;
- seis destinos internos verificados (200, canonical propia, `index`);
- notas que prohíben las notas de TMDB, cualquier experiencia de visionado y las audiencias, posiciones o disponibilidad sin fuente.

**Lo que aportó el borrador (antes → después):**

| | En vivo | Borrador del piloto |
|---|---|---|
| Palabras | 456 | 881 |
| Prosa compartida con los otros cuatro | 70 % | **0 %** |
| Jaccard máximo con los otros cuatro | 0,391 | **0,002** |
| Jaccard con las guías de planes / precios | — | 0,003 / 0,002 |
| Fuentes externas verificables | 0 (portada de TMDB) | 3 oficiales de Netflix + 2 fichas de GuíaTV |
| Afirmaciones con cita literal verificada | 0 | 19 de 19 marcadores |
| Fecha y caducidad | «octubre 2026» | `lastVerifiedAt` 2026-11-03, `nextReviewAt` 2026-12-03 (`catalog-ranking`) |
| Autoría | «Revisión editorial: Arturo Baroja» sobre texto de IA | «Redacción IA de Guía TV» con la divulgación de IA del pipeline |

**Lo que no consiguió:**
- **Títulos:** nombra **un solo título** (el n.º 1 de series, «Grande de España: Temporada 1»).
- **Enfoque:** el **65 %** del texto trata de planes y precios. Para la consulta «mejores series y películas de Netflix» es una deriva de intención, y canibaliza parcialmente las dos guías de planes y precios.

## 6. Evidencias y fuentes

### 6.1 Fuentes recuperadas

Una sola descarga por fuente, el 2026-11-03 a las 08:07 UTC:

| Id | URL | Tipo |
|---|---|---|
| s1 | https://www.netflix.com/tudum/top10/es/spain/tv | oficial |
| s2 | https://www.netflix.com/tudum/top10/es/spain | oficial |
| s3 | https://help.netflix.com/es-es/node/24926 | oficial |
| g1 | `/v2/catalog/tmdb:movie:1446912` | interna |
| g2 | `/v2/catalog/tmdb:tv:335535` | interna |

### 6.2 Afirmaciones citadas en el borrador

Las 19 afirmaciones son `supported`, con su cita literal verificada por código:

| Afirmación | Fuente |
|---|---|
| r2-c8 n.º 1 de series (semana 19/10/26–25/10/26); c1 y c2 fechas de las dos listas; r2-c34 «más comentadas»; c7 buscador histórico; c6 disponibilidad por región | s1 / s2 |
| r2-c29 género y año de «Grande de España» | g2 |
| c30 y c31 plan con anuncios (catálogo «casi todas», candado, 2 dispositivos, 1080p); c33 y c34 Estándar y Premium; c35 precios (8,99 / 14,99 / 21,99 €); c36 y c37 suscriptores extra (5,99 / 6,99 €); c38 facturación mensual sin planes anuales; c39 hogar; c40 Básico no disponible; c32 y c41 paquetes de operador e impuestos | s3 |

`node scripts/editorial-agents.mjs verify <run>` (vuelve a descargar las fuentes y aplica las puertas, sin modelo):
- sale con **0**;
- `changed: []`;
- ningún bloqueo; solo los dos hallazgos `human`.

### 6.3 Afirmaciones descartadas

68 de 97 se quedaron en `unverified` y no se usaron. Entre ellas están las posiciones 2–10 de series y todas las de películas.

### 6.4 Defecto de la puerta de evidencia (comprobado, falla en modo seguro, sin corregir)

`normalizeForMatch` (`EditorialEvidence.ts:149`) elimina todos los espacios, y `containsQuote` (`:176`) rechaza una cita que empieza o termina en cifra si el texto contiguo también es una cifra. En la lista de Netflix («… Temporada 1 1 02 Bajo la superficie: Miniserie 3 03 Lupin …») queda así:
- **Final:** la cita correcta «02 Bajo la superficie: Miniserie 3» se rechaza, porque detrás viene «03» y la regla lo lee como «…303».
- **Principio:** citarla sin la cifra final tampoco sirve, porque detrás de «…Temporada 1 1» aparece «02» y la regla lo lee como «…102».
- **Por qué pasó el n.º 1:** su cita empieza en «Ranking 01», precedida de letras.
- **Comprobación:** el snapshot tiene el mismo hash (`a3e39268…`) que una descarga posterior, así que la página no cambió.

Es un falso negativo: nunca da por buena una cita falsa. Pero en la práctica impide citar posiciones de cualquier lista numerada que se aplana en texto. Fue la causa de que el borrador perdiera las listas y derivara hacia los planes.

No se corrigió en este hito: cambiar la normalización afecta a la re-verificación de mantenimiento de todo el corpus publicado por la política. Es el próximo paso recomendado (§12).

## 7. Pipeline editorial

| Paso | Resultado |
|---|---|
| Versión | `m11g-1` (dist de `main@59ecd4f` + este cambio), backend `anthropic` vía el gateway local, procedencia **firmada** |
| Investigación | 3 llamadas (inicial y 2 reinvestigaciones), 97 afirmaciones |
| Evidencia | código + 3 llamadas del modelo (solo puede degradar afirmaciones) |
| Redacción ⇄ crítico | 6 borradores (máximo de 5 revisiones). Veredictos: `revise` en todos, con 13 → 7 → 7 → 9 → 8 → 6 problemas y **ningún `blocking`** |
| Último crítico | 2 `medium`: el texto repite cifras de la tabla de planes, y la sección «Qué incluye cada plan» duplica una columna. 4 `low`: fechas repetidas; una coletilla vacía; el título y el `metaTitle` prometen el Top 10 y solo hay un título; una inferencia sobre regiones que va más allá de su cita |
| Puertas deterministas | sin bloqueos: metadatos, enlaces internos verificados, fuentes en el bundle, frescura, divulgación de IA y byline, `no-distinct-value` superado (1 dato interno, 2 editores, 1 tabla) |
| Estado final | `blocked`, «agotados los ciclos de revisión (5)». Fichero: `artifacts/m11b1/runs/2026-11-03-mejores-series-y-peliculas-netflix-espana.json` (`draftHash e0fd299f…`, `bundleHash cc058e76…`) |
| Coste | **4,1243 USD**, apuntado en `artifacts/m11b/runs/spend.jsonl` (`reserve` + `settle`) |

Coste por rol:

| Rol | Modelo | Llamadas | Tokens (entrada / salida) | USD |
|---|---|---:|---:|---:|
| Investigación | Opus 5.5 | 3 | 158 575 / 35 704 | 1,348 |
| Redacción | Opus 5.5 | 15 | 135 729 / 74 401 | 2,031 |
| Crítico | Opus 5.5 | 6 | 71 215 / 19 314 | 0,671 |
| Evidencia | Opus 5.5 | 3 | — | 0,072 |
| SEO | Haiku 5.5 | 3 | — | 0,001 |

**Segundo intento abortado.** Se lanzó con notas para el crítico, pero se detuvo al minuto al ver que la cita propuesta también caía en el defecto de §6.4. Dejó en el diario una fila `reserve` de **0 USD sin `settle`** y un `run.lock` del PID muerto, que el runner recupera solo. El fichero de ejecución no se sobrescribió. Si alguna llamada de investigación llegó a gastar tokens en ese minuto, no quedó apuntada.

**Publicación y autorización:**
- `revise-by-policy` (`BlogController.ts:456`) solo acepta `reviewedBy === 'policy:m11b-evidence-gate'`, y `enrich` aplica la misma regla. Esta guía la aprobó Arturo Baroja: la política no puede revisarla, y así debe ser.
- `save-draft` rechaza el slug existente, y un PUT dejaría la guía viva como borrador.
- Revisarla corresponde a una persona con nombre, por la vía humana (`/approve`).
- No se publicó nada, no se creó ningún slug paralelo y no se cambió `origin` ni `reviewedBy`.

## 8. Cambios de código

1. **`scripts/editorial-agents.mjs`, `run` con `revises`.** Un tema `revises: <su propio slug>` genera una revisión de una guía aprobada por una persona como **fichero local**:
   - corre solo y rechaza `--report`, y por tanto también `--autopublish`;
   - quita ese único slug del corpus, porque si no la puerta de metadatos lo bloquea con «slug ya publicado»;
   - la comparación de duplicados con las demás guías sigue intacta, y la propia ya se saltaba (`EditorialReviewPolicy.ts:203`).
2. **`EditorialOpsController.requeuePost`.** Una URL de fuente guardada malformada (`https://exa mple/x`) pasaba el regex `^https://` y `new URL()` lanzaba una excepción: un 500 que dejaba el borrador atascado. Ahora se descarta.

   Se conservan los dos arreglos de #142: la volatilidad del tema es un valor aceptado, y las semillas son de dominios habilitados.
3. **`scripts/ranking-similarity.mjs`** (nuevo). Medida de solo lectura sobre la API pública; `--candidate` sustituye una guía por un borrador.

Tests:
- `editorial-cycle.test.mjs`: un caso nuevo. Rechaza `--report`, un lote y un `revises` distinto del slug, sin llamar a ningún modelo ni escribir.
- `EditorialOpsController.mongo.test.ts`: la regresión de #142, con una URL malformada, dominios deshabilitados (FilmAffinity e IMDb) y una afirmación `tv-schedule`.

## 9. Tests y revisión independiente

| Comprobación | Resultado |
|---|---|
| `node --test scripts/editorial-cycle.test.mjs` | **9/9** (nuevo: M11-B1 revision run) |
| `tsc --noEmit -p apps/backend` | 0 errores |
| `EditorialOpsController.mongo.test.ts` | Necesita `TEST_MONGO_URI`. Docker no está activo en local, así que lo ejecuta CI (`performance.yml`) |
| `verify` del fichero del piloto | exit 0, evidencia sin cambios |

**Revisión editorial independiente** (agente aparte, solo lectura): **HOLD**.
- **Hechos:** limpios. Comprobó las 19 afirmaciones contra las páginas en vivo, sin invenciones ni experiencias, y con el byline correcto.
- **Bloqueante:**
  - no responde a «mejores series y películas»: nombra una serie y ninguna película, aunque las dos listas completas se descargaron;
  - unos dos tercios del texto son planes y precios, que canibalizan las dos guías existentes;
  - el H1 y el `metaTitle` prometen un Top 10 que el texto no da.
- **Mayor:**
  - la columna de semanas en el Top 10 no se usa, y el texto reconoce que no sabe qué es;
  - la tabla cita c31 para «dos dispositivos», pero esa cita no contiene ese dato.
- **Menor:**
  - la inferencia de c6;
  - dos frases factuales sin marcador;
  - repeticiones.
- **Descartado:** dudaba si la divulgación de IA estaba en el cuerpo. Sí está: `<p data-ai-disclosure>` al final del HTML.
- **Sobre el crítico:** el `revise` está justificado, aunque infravaloró como `low` el problema de intención.

**Revisión de ingeniería y seguridad independiente:** **APPROVE**, sin hallazgos bloqueantes ni mayores.
- **Guard `revises`:** confirma que no se puede saltar. Los casos de un tema que no es el primero, un valor vacío o distinto del slug, `--report`/`--autopublish` y un `save-draft` o `publishRun` posterior fallan en modo seguro.
- **Duplicados:** las comprobaciones contra las demás guías siguen activas.
- **`requeuePost`:** conserva los dos arreglos de #142.
- **Defecto de §6.4:** confirma la causa raíz y que solo da falsos negativos.
- **Menores aplicados:**
  - en el test Mongo sobraba un `$set` de volatilidad, porque el fixture ya trae `tv-schedule`;
  - el test del CLI ahora exige cero peticiones.
- **Menores no aplicados:**
  - no hay test del camino aceptado de `revises`; lo cubre la ejecución real del piloto;
  - `requeuePost` devuelve 400 si se descartan todas las fuentes, que es lo esperado.

## 10. Git, CI y producción

- **Rama:** `m11-b1-platform-ranking-pilot`.
- **Commits:**
  - `34c4a90`, código y tests;
  - un segundo commit con este informe, el roadmap y `artifacts/m11b1/`.
- **PR y CI:** ver la sección «PR» al final.
- **Producción:** nada desplegado ni escrito. No hay release nueva ni rollback que hacer.
- **Fuera de la rama:** el gateway OmniRoute queda corriendo en `127.0.0.1` y se para con `omniroute stop`.

## 11. Criterios de aceptación

| AC | Estado | Evidencia |
|---|---|---|
| AC-01 Auditoría sobre el contenido actual | PASS | §3, texto en vivo del 2026-11-03 |
| AC-02 Duplicación reproducible | PASS | `scripts/ranking-similarity.mjs`, `artifacts/m11b1/similarity-*.json` |
| AC-03 Decisión por ranking | PASS | §4 |
| AC-04 Piloto diferenciado completado | **PARTIAL** | Ejecutado de punta a punta y diferenciado (0 % / 0,002), pero en HOLD por el crítico y la revisión editorial (intención no cumplida) |
| AC-05 Afirmaciones respaldadas o eliminadas | PASS con reservas | 19/19 verificadas por código y 68 descartadas. Lo que la revisión señaló (c31, c6, dos frases sin marcador) bloquearía la publicación si se aprobara este borrador |
| AC-06 Sin experiencia ni autoría humana inventadas | PASS | Byline de IA, divulgación de IA y cero lenguaje de experiencia |
| AC-07 Puertas y crítico aplicados | PASS | El crítico retuvo los 6 borradores y no se saltó nada |
| AC-08 Procedencia y autorización preservadas | PASS | Sin `revise-by-policy` sobre una guía humana y sin cambios de `origin`/`reviewedBy` |
| AC-09 Sin duplicado público ni cambio de URL | PASS | Ningún slug nuevo, ninguna escritura |
| AC-10 Tests y CI | ver PR | Local: 9/9 y tsc limpio; el test Mongo, en CI |
| AC-11 Revisión independiente | PASS | §9 |
| AC-12 Estado de publicación exacto | PASS | No publicado; §1 y §7 |
| AC-13 M04-B y dependencias de M11-B | PASS | Abajo |

## 12. Roadmap, M04-B y siguiente paso

**M04-B** sigue **NO-GO** (todo ○ en el roadmap canónico). La dependencia protege dos cosas:
1. que no se despliegue nada ajeno mientras dura la vigilancia del rollout del enriquecimiento heredado;
2. que la producción original de M11-B se apoye en páginas de detalle ya enriquecidas.

| ¿Bloquea? | Respuesta |
|---|---|
| Redactar | No |
| Publicar | No: una publicación editorial es una escritura en la base de datos, no un despliegue |
| Cierre formal de M11-B | **Sí** |

No se activó `CONTENT_LEGACY_ENRICHMENT_ENABLED` ni se inició ningún rollout.

**Estados:**
- **M11-B1:** PARTIAL (auditoría e ingeniería PASS, piloto HOLD, sin publicar).
- **M11-B:** PARTIAL. Siguen abiertos los rankings, el calendario de mantenimiento, las URL retiradas y M04-B.
- **M04-B:** NO-GO.
- **M12:** NO-GO.

**Próximo submilestone recomendado (uno, no ejecutado): M11-B2a, corregir el falso negativo de §6.4 y repetir el piloto de Netflix.**
1. **Fallback en `containsQuote`:** solo cuando la frontera de cifras rechaza, se reintenta con los espacios colapsados a uno. La regla sigue rechazando grupos de millares separados por espacio.
2. **Re-verificación del corpus:** `verify` de todos los ficheros de ejecución, y `maintain --report … --force` sin `--apply`, antes y después del cambio, para ver qué hashes cambian.
3. **Una ejecución nueva del piloto** con la nota de la revisión editorial:
   - las diez series y las diez películas, con sus semanas en el Top 10;
   - de los planes, solo la diferencia de catálogo del plan con anuncios, con enlace a las dos guías de planes y precios.
4. **Publicación:** si pasa el crítico, la decide el revisor con nombre por `/approve`.

## PR
