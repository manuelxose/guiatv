# M11-B1 — Valor editorial original en los rankings de plataformas

Ejecutado el **2026-11-03** (Europe/Madrid) sobre `main@59ecd4f`, con la release `20261103023955` en producción. Rama `m11-b1-platform-ranking-pilot`.

Producción solo se leyó: GET públicos y GET del Admin con la clave de analítica. No hubo escrituras en la base de datos, publicaciones, redirecciones, despliegues ni cambios de flags. `CONTENT_LEGACY_ENRICHMENT_ENABLED` no se tocó.

## 1. Veredicto

| Ámbito | Estado | Por qué |
|---|---|---|
| Auditoría (AC-01–03) | **PASS** | Los cinco rankings se midieron sobre su texto en vivo con un script reproducible (§3) y cada uno tiene una decisión (§4) |
| Ingeniería | **PASS** (CI verde en la PR #144) | `revises`, el 500 de `requeuePost` y dos correcciones de la puerta de evidencia, con revisión de seguridad independiente APPROVE (§8, §9) |
| Piloto editorial | **BORRADOR CERTIFICADO, revisión independiente en HOLD** | El pipeline real lo aprobó (crítico `pass`, 20/20 puestos verificados, todas las puertas deterministas, 0 % de prosa compartida). La revisión editorial independiente lo mantiene en HOLD por tres hallazgos mayores que son de una persona (§7) |
| Publicación | **NO PUBLICADO** | La guía la aprobó una persona (Arturo Baroja): `revise-by-policy` la rechaza, y es lo correcto. Publicarla corresponde a un revisor con nombre por `/approve` |

**M11-B1: PARTIAL.** La parte de ingeniería está completa. El borrador está certificado por el pipeline, pero no se publica ni se declara aceptado editorialmente.


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
  - El worktree `guiatv-runner` de la tarea de Windows `GuiaTV\EditorialCycle` ya no existía (`prunable`). Se recreó después en `main`. Producción ya tiene su propio runner gestionado en el servidor (`m11g-2`, en línea), así que esa tarea local no es el camino principal y su candado no se comparte con el del servidor: desactivarla es decisión de la propietaria.
  - Los pilotos se ejecutaron desde este PC a través de un gateway local temporal de modelos, que se paró al terminar. Ya no se usa: producción llama a Claude desde su propio entorno.

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

**Lo que aportó el borrador final (antes → después):**

| | En vivo | Borrador del piloto |
|---|---|---|
| Palabras | 456 | 413 (338 de prosa) |
| Contenido | Dos tablas de notas de TMDB sin fuente comprobable | Las dos listas completas del Top 10 oficial de Netflix en España (20 puestos), con el formato que rotula Netflix |
| Prosa compartida con los otros cuatro | 70 % | **0 %** |
| Jaccard máximo con los otros cuatro | 0,391 | **0,004** |
| Títulos que también están en otras listas | 9/20 | **0/20** |
| Fuentes externas verificables | 0 (portada de TMDB) | 3 oficiales de Netflix + 2 fichas de GuíaTV |
| Afirmaciones con cita literal verificada | 0 | 31 de 31 citadas |
| Fecha y caducidad | «octubre 2026» | `lastVerifiedAt` 2026-11-03, `nextReviewAt` 2026-12-03 (`catalog-ranking`) |
| Autoría | «Revisión editorial: Arturo Baroja» sobre texto de IA | «Redacción IA de Guía TV» con la divulgación de IA del pipeline |
| Título | «Las mejores series y películas de Netflix en España (octubre 2026)» | «Top 10 de Netflix en España: series y películas de la semana» |

**Lo que no consiguió.** Es una lista semanal oficial, no una selección de «las mejores»: responde a «qué se ve en Netflix en España», no a «qué merece la pena». La parte editorial propia es corta: el género y el año de los dos primeros puestos (con la identidad de las fichas sin confirmar), la nota sobre el plan con anuncios y el enlace a las guías de planes y precios. Los tres hallazgos mayores de la revisión independiente (§7) quedan para la persona revisora.

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

Las 31 afirmaciones citadas son `supported`, con su cita literal verificada por código:

| Afirmaciones | Qué respaldan | Fuente |
|---|---|---|
| c1, c2, c12, c13, c25 | La semana de cada lista, el n.º 1 de cada una y su alcance por países | s1 / s2 |
| c2–c11 | Las diez series, una afirmación por puesto, con su formato | s1 |
| c13–c22 | Las diez películas, una afirmación por puesto | s2 |
| c27 | El buscador de títulos por país y tiempo | s1 |
| c29–c33 | Plan con anuncios (catálogo, candado, paquetes), facturación mensual y cambio de plan | s3 |
| c35, c37 | Género y año de las dos fichas de GuíaTV | g1 / g2 |

`node scripts/editorial-agents.mjs verify <run>` (vuelve a descargar las fuentes y aplica las puertas, sin modelo):
- sale con **0**;
- `changed: []`;
- ningún bloqueo; solo los dos hallazgos `human`.

### 6.3 Afirmaciones descartadas

2 de 38 afirmaciones del paquete del sexto intento se quedaron sin verificar y no se usaron. Ya no hay ninguna posición de las listas entre ellas.

### 6.4 Defecto de la puerta de evidencia (corregido en este hito)

`normalizeForMatch` elimina todos los espacios, y `containsQuote` rechaza una cita que empieza o termina en cifra si el texto contiguo también es una cifra. En la lista de Netflix («… Temporada 1 1 02 Bajo la superficie: Miniserie 3 03 Lupin …») la cita correcta «02 Bajo la superficie: Miniserie 3» se rechazaba por los dos lados. Era un falso negativo (nunca aceptaba una cita falsa), pero impedía citar los puestos de cualquier lista numerada.

Se corrigió en tres commits, con revisión de seguridad independiente:
1. **Rango de la lista** (`aa6feee`, estrechado en `70538c6`). Solo se reintenta con el espacio original cuando la cita **empieza** por un puesto 01–10 y una palabra, tras otro número y un espacio. La primera versión era más amplia y la revisión la bloqueó: el texto descargado convierte el marcado en espacios, así que `12<sup>,99</sup>` o `1<b>2</b>5` se leerían como dos números y «cuesta 12» o «tiene 1» se habrían verificado. Los contraejemplos del revisor están en el test y todos se rechazan. Las citas que terminan en cifra mantienen la regla anterior.
2. **Relleno de ceros** (`456f31c`). Un entero con ceros a la izquierda cuenta también sin ellos («02» respalda «n.º 2»). Solo cambia el lado de la cita.

**Re-verificación en seco del corpus** (`artifacts/m11b1/quote-fallback-dryrun.cjs`, 16 ficheros, 840 citas, con las mismas descargas): 0 citas pasan de verificada a rechazada y 0 cambian fuera del piloto. Fuera del piloto cambia una afirmación de un candidato M11-G no publicado («4 de julio» respaldada por «04/07/2017»). Ninguna guía publicada se ve afectada.

**Riesgo residual aceptado por la revisión de seguridad (APPROVE):** un número partido por marcado o espacio justo antes de un token 01–10 seguido de una palabra («1<b>10</b> minutos» → «10 minutos») sigue verificándose. Es estrecho y no afecta a precios, decimales ni millares.

## 7. Pipeline editorial

**Seis ejecuciones reales del pipeline** sobre el mismo slug, todas como fichero local y sin publicar. El coste es solo un registro de observabilidad y no limitó ningún reintento.

| # | Qué cambió | Resultado |
|---|---|---|
| 1 | Primera versión (planes y precios) | `blocked`, 6 borradores. La puerta rechazó las posiciones 2–10 (§6.4) |
| 2 | Tras corregir la puerta (cita de rangos) | `blocked`: las afirmaciones «n.º 2» no se respaldaban con «02» |
| 3 | Tras la nota del crítico | `blocked`, 6 borradores, sin convergencia |
| 4 | Tras corregir el relleno de ceros | Crítico `pass`. La revisión editorial independiente: HOLD (fechas en el título frente a revisión a 30 días, `más comentados` sin respaldo, una afirmación para dos filas) |
| 5 | Notas de esa revisión | Crítico `pass`, pero con las posiciones 3 y 4 sin verificar |
| 6 | Citas que empiezan en el puesto y acaban en una palabra | **Crítico `pass`**, 3 observaciones `low`; 20/20 puestos verificados, una afirmación por fila |

Estado final: `approved-by-policy` en el pipeline, es decir, **cumple todas las puertas, pero no se publica** (§7, publicación).

- Firma de la procedencia válida; `verify` sale con 0 y `changed: []`.
- Hash del borrador `8a16b5f4…`, hash del paquete `ceeab533…`, `nextReviewAt` 2026-12-03.
- Jaccard con los otros cuatro: 0,002–0,004; 0 % de prosa compartida; 0/20 títulos en otras listas; 413 palabras.
- 31 afirmaciones citadas, todas `supported` con cita literal verificada por código.
- Título sin fechas: «Top 10 de Netflix en España: series y películas de la semana».
- Los ficheros de los intentos 1–5 se conservan en `artifacts/m11b1/runs/`.

**Revisión editorial independiente del sexto borrador: HOLD**, con una vía corta a publicable por una persona.
- **Resuelto:** los puestos (20/20 contra la página en vivo), una afirmación por fila, el «más comentados», el título sin fechas.
- **Mayor 1:** `nextReviewAt` es a 30 días, pero el dato es semanal. La semana está dicha como dato fechado, pero la página quedará desfasada en una semana. Hace falta un plan de actualización semanal, o presentarla como instantánea fechada.
- **Mayor 2:** los datos de género y año de las dos fichas de GuíaTV se emparejan por nombre con los títulos de Netflix. Comprobé las fichas: título y año coinciden, pero GuíaTV no enlaza esos títulos con Netflix (`primaryPlatforms` vacío). La identidad queda sin confirmar.
- **Mayor 3:** el slug y la consulta objetivo siguen diciendo «mejores series y películas», y la página es una lista semanal. El slug no se puede cambiar sin una 301, que está fuera de este hito.
- **Menores:** la celda «—», la redacción de «solo existen», una frase interpretativa de c27, el párrafo del plan, y la fecha en la meta descripción y el resumen.

Una persona revisora debe confirmar el aviso de IA y la firma, comprobar las dos identidades, y decidir cadencia, slug y consulta objetivo antes de publicar por `/approve`.

**Publicación y autorización:**


Coste del intento 1 (los demás, entre 1,1 y 2,7 USD cada uno, están en el diario `artifacts/m11b/runs/spend.jsonl`):

| Rol | Modelo | Llamadas | Tokens (entrada / salida) | USD |
|---|---|---:|---:|---:|
| Investigación | Opus 5.5 | 3 | 158 575 / 35 704 | 1,348 |
| Redacción | Opus 5.5 | 15 | 135 729 / 74 401 | 2,031 |
| Crítico | Opus 5.5 | 6 | 71 215 / 19 314 | 0,671 |
| Evidencia | Opus 5.5 | 3 | — | 0,072 |
| SEO | Haiku 5.5 | 3 | — | 0,001 |

Se lanzó además un intento que se detuvo al minuto; dejó una fila `reserve` de 0 USD sin `settle` y un `run.lock` que el runner recupera solo.

**Por qué no se publica:**
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
4. **`EditorialEvidence.ts`**: la corrección de §6.4 (rango de lista y relleno de ceros), con un test nuevo en `EditorialEvidence.test.ts`.

Tests:
- `editorial-cycle.test.mjs`: un caso nuevo. Rechaza `--report`, un lote y un `revises` distinto del slug, sin llamar a ningún modelo ni escribir.
- `EditorialEvidence.test.ts`: puestos de lista, millares con espacio, números pegados, precios partidos por marcado y el relleno de ceros.
- `EditorialOpsController.mongo.test.ts`: la regresión de #142, con una URL malformada, dominios deshabilitados (FilmAffinity e IMDb) y una afirmación `tv-schedule`.

## 9. Tests y revisión independiente

| Comprobación | Resultado |
|---|---|
| `node --test scripts/editorial-cycle.test.mjs` | 9/9 |
| `EditorialEvidence` + `EditorialAgentPipeline` | 36/36 |
| Controladores, con el cambio de la puerta | 75/75, 3 omitidos (Mongo) |
| Suite completa del backend en Windows | 737/770 antes del último ajuste; de los 4 fallos (manifiestos de canary y modo de fichero de Windows), 3 ya fallan en `main` sin estos cambios y el cuarto es del mismo grupo `content-certify` |
| `tsc --noEmit -p apps/backend` | 0 errores |
| CI de la PR #144 | verde (4/4 comprobaciones) al escribir esto |
| `verify` del piloto final | exit 0, `changed: []` |

**Revisión de ingeniería y seguridad: APPROVE** en dos rondas.
- Ronda 1 (`revises` y `requeuePost`): sin hallazgos bloqueantes; se aplicaron los menores.
- Ronda 2 (puerta de evidencia): **bloqueó** la primera versión del fallback (marcado convertido en espacios). Se estrechó y el mismo revisor la aprobó, dejando el residual de §6.4.

**Revisiones editoriales independientes:** tres, sobre el primer borrador, el cuarto y el sexto.
- Las dos primeras dieron HOLD y sus hallazgos cambiaron el tema entre intentos.
- La tercera, sobre el borrador final, también da HOLD, con los tres mayores de §7 (cadencia, identidad de las fichas, slug y consulta objetivo).
- Ninguna encontró invención, experiencia ficticia ni autoría humana inventada. El aviso de IA está en el HTML (`data-ai-disclosure`).

## 10. Git, CI y producción

- **Rama:** `m11-b1-platform-ranking-pilot`. **PR:** [manuelxose/guiatv#144](https://github.com/manuelxose/guiatv/pull/144), CI verde, sin fusionar.
- **Commits de código:** `34c4a90` (`revises`, `requeuePost`, similitud), `aa6feee` y `70538c6` (puerta, rango de lista), `456f31c` (relleno de ceros), `053573d` (ruta del script del piloto, comentario de revisión). Los demás son documentación y artefactos.
- **Producción:** nada desplegado ni escrito. No hay release nueva ni rollback.
- **Fuera de la rama:** el gateway local de los pilotos ya está parado.

## 11. Criterios de aceptación

| AC | Estado | Evidencia |
|---|---|---|
| AC-01 Auditoría sobre el contenido actual | PASS | §3, texto en vivo del 2026-11-03 |
| AC-02 Duplicación reproducible | PASS | `scripts/ranking-similarity.mjs`, `artifacts/m11b1/similarity-*.json` |
| AC-03 Decisión por ranking | PASS | §4 |
| AC-04 Piloto diferenciado completado | **PASS con reservas** | Ejecución completa del pipeline real con crítico `pass`, 20/20 puestos verificados y 0 % de prosa compartida. Los tres mayores de la revisión editorial son de una persona |
| AC-05 Afirmaciones respaldadas o eliminadas | PASS | 31 afirmaciones citadas, todas con cita literal verificada por código; la revisión confirmó las 20 filas contra la página en vivo. Queda sin confirmar la identidad de las dos fichas de GuíaTV |
| AC-06 Sin experiencia ni autoría humana inventadas | PASS | Byline de IA, divulgación de IA y cero lenguaje de experiencia |
| AC-07 Puertas y crítico aplicados | PASS | El crítico retuvo cuatro intentos y no se saltó nada; las dos correcciones de la puerta tuvieron revisión de seguridad |
| AC-08 Procedencia y autorización preservadas | PASS | Sin `revise-by-policy` sobre una guía humana y sin cambios de `origin`/`reviewedBy` |
| AC-09 Sin duplicado público ni cambio de URL | PASS | Ningún slug nuevo, ninguna escritura |
| AC-10 Tests y CI | PASS | §9; CI 4/4 verde |
| AC-11 Revisión independiente | PASS | Editorial: HOLD con hallazgos de una persona; ingeniería: APPROVE (§9) |
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
- **M11-B1:** PARTIAL (auditoría e ingeniería PASS; borrador certificado por el pipeline; revisión editorial en HOLD; sin publicar).
- **M11-B:** PARTIAL al cerrar esta entrega. El 2026-11-03 la propietaria retiró la dependencia de M04-B y aceptó M11-B como hecho: **DONE por aceptación**, con las excepciones del roadmap (guía de Netflix certificada y sin publicar, otros cuatro rankings sin cambios, URL retiradas sin decidir).
- **M04-B:** NO-GO.
- **M12:** NO-GO.

**Lo que decide la persona revisora** antes de publicar el borrador por `/approve`:
1. Cadencia: el dato es semanal y `nextReviewAt` es a 30 días. Debe ser una actualización semanal o una instantánea fechada.
2. Identidad de las fichas de «Cada día nace un listo» y «Grande de España»: comprobar que son los títulos de Netflix.
3. Slug y consulta objetivo («mejores series y películas») frente a una lista semanal. Cambiarlos necesita una 301, fuera de este hito.

**Comprobación de fuentes de los otros cuatro rankings (2026-11-03, lectura de páginas públicas):** el patrón de Netflix no se generaliza.

| Plataforma | Qué publica y se puede citar |
|---|---|
| Netflix | Top 10 semanal por país (series y películas), con fecha. Es la única lista oficial citable |
| Prime Video | Su portada pública no muestra contenido (solo el aviso de cookies y el menú) |
| Disney+ | Texto de marketing con las marcas del catálogo, sin posiciones ni fechas |
| HBO Max | Precio de entrada del plan en la portada; la página `/top-10` responde 404 |
| Movistar Plus+ | Solo una pantalla de acceso |

Sin una lista oficial, un ranking por plataforma solo podría apoyarse en las notas de TMDB (que no se pueden comprobar) o en descripciones de catálogo planas. No se generaron borradores para estos cuatro, porque habrían vuelto a una plantilla con otro nombre.

**Próximo submilestone recomendado (uno, no ejecutado): M11-B2, decidir el destino de los cuatro rankings sin fuente oficial.**
1. Qué se entrega en su lugar: una sola guía comparativa «qué ver en cada plataforma» (Netflix con su Top 10, y las demás con lo que sí se puede citar: planes, marcas, canales), apoyada en los datos propios de GuíaTV.
2. Si se opta por fusionar, las cuatro URL pasan a `/guias/rankings` por 301. Eso necesita tu autorización, 28 días de datos de Search Console y la entrada en las tablas de redirección de Angular y SSR.
3. Mientras tanto, las cuatro guías actuales siguen publicadas sin cambios.

## PR

- **PR:** [manuelxose/guiatv#144](https://github.com/manuelxose/guiatv/pull/144), base `main`, CI 4/4 verde.
- **Merge:** no hecho; es decisión del propietario.
