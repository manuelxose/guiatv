# M11-F: operaciones editoriales autónomas

- **Fecha:** 2026-10-28.
- **Base:** `main@9c78ba4`, producción `20261027211302` @ `6d4e40f`.
- **Producción tras el hito:** `20261028111735` @ `e7aaf2b`.
  - El runner ejecuta `main@16f5037`.
  - #112 y #113 solo tocan código del runner: el servidor no las usa y no requieren despliegue.
- **Alcance:** solo M11-F.
  - Sin trabajo de M12 ni páginas programáticas.
  - Sin cambios en la política de canonical de `/programas`, `/peliculas`, `/series` ni `/guias`.
  - Sin dependencias nuevas; `package-lock.json` no cambia.

## 1. Resumen ejecutivo

| Puerta | Estado | Evidencia |
|---|---|---|
| ENGINEERING PASS | **PASS** | PRs #111, #112 y #113 con CI en verde. Revisión independiente: 0 BLOCKER; el HIGH y los MEDIUM se corrigieron, salvo M5, que es decisión del propietario (§12) |
| AUTONOMOUS DISCOVERY PASS | **PASS** | 4 descubrimientos reales con el modelo: 23 propuestas, 10 aceptadas y 13 rechazadas con su motivo (§4–§5). Ya no hay ficheros de temas preparados a mano |
| SCHEDULER PASS | **PASS** | La tarea de Windows `GuiaTV\EditorialCycle` se ejecutó sin terminal (resultado 0). Con la cola sin temas elegibles terminó limpio (§8) |
| MAINTENANCE PASS | **PASS (verificación real + actualización determinista)** | Las 3 guías publicadas por la política se re-verificaron contra el BOE: sin cambios y sin regenerar. La actualización versionada con `revise-by-policy` está probada con Mongo; en producción no ha cambiado ninguna evidencia (§10) |
| SEARCH CONSOLE | **CONNECTED** | 13 inspecciones reales: 0 URLs indexadas. Search Analytics devolvió 0 filas en 28 días, así que la línea base es incompleta (§9) |
| PRODUCTION CANARY PASS | **PASS** | El canario 1 bloqueó correctamente un artículo sin valor demostrable. El canario 2 publicó una guía de forma autónoma, verificada en SSR, listados y sitemap (§6, §14) |
| AUTONOMOUS OPERATIONS ACTIVE | **ACTIVO** | La política está activa y el límite es 10 al día. La tarea programada corre 5 veces al día, con 1 tema por ciclo |
| M12 | **NO-GO**, sin cambios | §16 |

**Lo que hace el sistema sin intervención:**
1. Re-verifica las guías que publicó.
2. Propone temas con un modelo y los acepta o rechaza con reglas deterministas.
3. Escribe y certifica un artículo por ciclo.
4. Lo publica por la política, sin aprobación humana por artículo.
5. Mide en Search Console lo que Google ve de verdad.

Ninguna puerta de calidad se ha relajado. Los dos fallos que encontró el canario se corrigieron endureciendo la selección de temas, no los gates.

## 2. Cambios de arquitectura

Se reutiliza el pipeline de M11-E2 (`runEditorialJob`/`runEditorialBatch`, el diario de gasto, `approve-by-policy`). Lo nuevo:

- **`EditorialTopicQueue.ts`** (backend, lo usa el runner):
  - `proposeTopics`: una llamada al modelo que **solo propone** temas.
  - Funciones deterministas: `screenProposal`, `checkSeeds`, `scoreProposal`, `pickTopics`, `recoverQueue` y `seedPublishers`.
- **CLI `scripts/editorial-agents.mjs`:**
  - `cycle` ejecuta MAINTAIN → DISCOVER → RUN. El descubrimiento solo se lanza con menos de 3 temas en cola y como mucho cada 12 h.
  - `discover` y `maintain --report [--apply]`.
  - Lock con recuperación de locks huérfanos (pid muerto o más de 6 h).
  - Cola, mantenimiento y diario se escriben de forma atómica (tmp + rename) en el mismo directorio que `spend.jsonl`.
  - Auditoría por ciclo en `cycles.jsonl`.
- **`scripts/editorial-scheduled.mjs`:** punto de entrada para el programador del sistema.
  - Usa solo las claves del runner y vacía la clave humana.
  - Escribe el log en `cycle-logs/<día>.log` y tiene un timeout de 3 h.
- **Servidor: `POST /v2/blog/:id/revise-by-policy`** (clave de política):
  - Sustituye una guía que publicó la política por una revisión nueva del pipeline.
  - El candidato se valida en memoria con todos los gates de `approve-by-policy` y solo se guarda si los pasa. La versión anterior queda como revisión, así que el rollback sigue disponible.
  - `expectedDraftHash` protege frente a cambios concurrentes (devuelve 409).
  - Solo aplica campos firmados.
  - Cuenta para el cupo diario.
  - Nunca toca guías aprobadas por una persona.
- **Servidor: canonical obligatoria.** Toda publicación por política debe ser canónica a `/guias/<slug>`.
- **Enlazado interno:**
  - `topic.linkTargets` contiene páginas que el runner ha comprobado: responden 200 sin redirección, tienen canonical propia y no llevan `noindex`.
  - Las candidatas son los hubs del sitemap, los canales, las categorías de guías y las guías. Nunca `/programas`, porque sus metadatos EPG no son fiables.
  - El gate exige entre 1 y 4 enlaces de esa lista, y también revisa los enlaces absolutos al propio sitio.
- **Coherencia SSR:**
  - `/v2/health` envía `X-Editorial-Epoch`.
  - Cuando cambia, el SSR purga solo `/`, `/guias*` y `/deportes/futbol*`.
- **Search Console** (solo lectura, `GSC_MONITOR_ENABLED=true`):
  - URL Inspection y Search Analytics, guardados en las colecciones `editorial_gsc_*`.
  - Tabla en Operaciones IA.
  - No se usa la Indexing API.

## 3. Skills y agentes usados de verdad

- **Orquestador (Opus 5.5):** recuperó el contexto, diseñó la solución, implementó descubrimiento, cola, ciclo, mantenimiento, enlaces, `revise-by-policy` y SSR, ejecutó los canarios, hizo el release y redactó este informe.
- **Agent C, SEO y Search Console** (subagente general-purpose): implementó el monitor GSC, la tabla del Admin y sus tests.
- **Agent D, seguridad y QA independiente** (subagente general-purpose, solo lectura): hizo una revisión completa y encontró 0 BLOCKER, 1 HIGH, 6 MEDIUM y 12 LOW.
- **Agentes A y B del encargo:** las funciones del modelo del pipeline (descubrimiento, investigación, redacción, SEO y crítica) son el «agente A». El orquestador hizo el trabajo del «agente B».
- **Skill:** ponytail (cambio mínimo completo).
- **Playwright:** spec del Admin en navegador real, 5/5.
- **No usados:** Impeccable / UI UX Pro Max (no hubo rediseño) y WebSearch.

## 4. Resultados del descubrimiento

Los 4 descubrimientos usaron `claude-opus-5-5` a través del gateway.

| Ejecución | Propuestos | En cola | Rechazados | USD est. |
|---|---|---|---|---|
| 1 (antes de corregir categorías y enlaces; archivada en `artifacts/m11f/topic-queue-discovery1.json`) | 7 | 5 | 2 | 0,125 |
| 2 | 6 | 4 | 2 | 0,131 |
| 3 (con la regla de dos editores) | 4 | 1 | 3 | 0,112 |
| Previa a la corrección del esquema (`maxItems` no admitido; fallo controlado) | — | — | — | 0 |

**Motivos de rechazo observados (todos deterministas):**
- `source-concentration`: la Ley 13/2022 ya respalda 3 guías, que es el tope por familia.
- `insufficient-evidence`:
  - la semilla del BOE no trataba el tema (2/12 términos);
  - menos de dos editores verificados, porque las páginas de ayuda de Netflix o Prime Video y la página de la UEFA no contenían los términos del tema.
- Al recuperar la cola: 4 temas con un único editor (todo BOE) pasaron a `rejected`.

## 5. Cola de candidatos generada

Puntuación de 0 a 100. Cada componente queda explicado en `scoreExplanation`: evidencia, vida útil, novedad, enlazado interno, diversidad, demanda estimada por el modelo y actualidad.

| Tema | Categoría | Estado | Puntuación | Familias de fuente |
|---|---|---|---|---|
| `descargar-series-netflix-grabar-tele-copia-privada` | Tecnología | **published** | 80 | `boe.es:BOE-A-1996-8930`, `help.netflix.com` |
| `es-ilegal-ver-futbol-iptv-pirata` | Tecnología | rejected (un solo editor; antes, bloqueado en el canario 1) | 81 | BOE (Código Penal, LPI) |
| `cuota-de-pantalla-cine-europeo-salas` | Cine | rejected (un solo editor) | 74 | `boe.es:BOE-A-2007-22440` |
| `calificacion-por-edades-peliculas-espana` | Cine | rejected (un solo editor) | 71 | `boe.es:BOE-A-2007-22440` |
| `derechos-baja-plataformas-paquetes-tv` | Streaming | rejected (un solo editor) | 69 | BOE (consumidores, telecomunicaciones) |
| 5 más | — | rejected en el cribado | — | §4 |

**Cola actual:** 1 publicado y 9 rechazados, sin temas pendientes. El siguiente ciclo con descubrimiento será a partir de las 22:37 UTC.

## 6. Estadísticas de publicación y rechazo (2026-10-28)

**Artículos generados:** 2.

- **Publicado:** `/guias/descargar-series-netflix-grabar-tele-copia-privada`.
  - 2 revisiones; 23 afirmaciones verificadas de 2 editores; 2 tablas.
  - 11 llamadas al modelo (8 Opus, 3 Haiku); 0,710 USD.
- **Bloqueado:** `es-ilegal-ver-futbol-iptv-pirata`.
  - 5 revisiones, 21 llamadas, 2,307 USD.
  - Al final el crítico dio PASS, pero los gates deterministas bloquearon el texto:
    - `no-distinct-value`: un solo editor;
    - `figure-in-words`: cifras escritas con letras en penas del Código Penal.
  - No se publicó nada; la versión bloqueada queda en el fichero de ejecución.

**Publicaciones por política en 24 h:** 4 de 10, contando las 3 de M11-E2.

## 7. Diversidad de temas y fuentes

- **Corpus público antes del hito:** 13 guías.
  - Rankings/Streaming: 5. Fútbol: 3. Televisión: 3, todas con la Ley 13/2022.
- **Primera guía de la categoría Tecnología.** Sus fuentes (Ley de Propiedad Intelectual y ayuda de Netflix) son familias que no se habían usado antes.
- **Reglas activas:**
  - como mucho 3 temas por familia de fuente;
  - como mucho 3 temas en cola por categoría;
  - 1 tema por categoría y ciclo, y 2 al día;
  - semillas solo de dominios primarios (oficiales o dataset);
  - al menos dos editores verificados, o datos propios de GuíaTV.
- **Sin diversidad artificial:** si no hay evidencia suficiente, la cola se queda vacía (§8).

## 8. Configuración del scheduler y ejecución observada

- **Host:** el PC del propietario. El gateway de modelos es local (`127.0.0.1:20128`) y el servidor no tiene credenciales de modelo.
- **Tarea:** `GuiaTV\EditorialCycle`.
  - Se ejecuta a diario a las 08:00 y se repite cada 3 h durante 14 h: 08, 11, 14, 17 y 20 h, hora local de Madrid gestionada por el sistema, con DST incluido.
  - Ejecuta `node C:\…\guiatv-runner\scripts\editorial-scheduled.mjs cycle`.
  - Modo «Solo interactivo», igual que el gateway, que vive en la sesión del usuario.
  - Una instancia a la vez, y además el lock propio.
- **Checkout del runner:** un worktree aparte en `main` (`guiatv-runner`), distinto de la copia de desarrollo.
- **Estado:** `GUIATV_EDITORIAL_STATE` apunta a `guiatv/artifacts`, donde están el diario, la cola y los ficheros de ejecución.
- **Secretos:** `~/.guiatv/runner.env` y `~/.guiatv/gateway.env`. Nunca se imprimen.
- **Valores conservadores y su justificación:**
  - **1 tema por ciclo**, hasta 5 al día como máximo, por debajo del cupo de 10. Así las publicaciones se reparten, el cupo nunca se agota de una vez y queda tiempo para detectar problemas y pulsar la parada de emergencia.
  - **Descubrimiento como mucho cada 12 h.** Cada uno es una llamada al modelo y la cola no necesita más.
  - **Mantenimiento:**
    - como mucho 2 guías re-verificadas por ciclo;
    - hechos estables cada 30 días; volátiles cada 7 o menos;
    - siempre que se pasa `nextReviewAt`.
- **Cupo:** se aplica en el servidor sobre 24 h móviles, igual en cualquier zona horaria y con DST. El runner lo relee antes y después del mantenimiento.
- **Ejecuciones observadas:**

  | Hora (UTC) | Disparo | Mantenimiento | Descubrimiento | Resultado |
  |---|---|---|---|---|
  | 10:30 | manual (canario 1) | 2 verified | — | IPTV `blocked`; tema reencolado |
  | 10:37 / 10:40 | manual (canario 2) | 1 verified + 10 `not-policy` | 1 en cola | **published** |
  | 10:47 | **Programador de tareas** | — | no tocaba (menos de 12 h) | `no-eligible-topics`, salida 0 |

- **Escenarios probados de forma determinista** (`scripts/editorial-cycle.test.mjs`, 7 en CI con `test:ops`):
  - parada de emergencia o política inactiva: no se escribe nada y no se llama al modelo;
  - Admin ilegible: el ciclo se detiene (fail closed);
  - lock activo: se rechaza el segundo runner; lock huérfano: se recupera;
  - cupo diario agotado;
  - caída del proveedor durante el descubrimiento y con la cola vacía;
  - interrupción: el tema se reintenta una vez y luego pasa a `held`, sin publicar;
  - clave humana: se rechaza en `cycle`, `discover` y `maintain`.

## 9. Search Console: conexión y resultados reales

- **Credenciales:**
  - La cuenta de servicio que ya estaba en el servidor (`GOOGLE_APPLICATION_CREDENTIALS`, `sc-domain:guiaprogramaciontv.com`) funciona con el scope `webmasters.readonly`.
  - No hay ningún bloqueo de configuración externa.
- **Activación:**
  - `GSC_MONITOR_ENABLED=true` en `/etc/guiatv/api.env` (backup en `api.env.bak-m11f-20261028T102056Z`).
  - Tras reiniciar `guiatv-api`: health 200, `NRestarts=0`.
  - El monitor corre después de cada envío del sitemap, unas 4 veces al día.
- **Primera ejecución manual (2026-10-28 10:19 UTC):** estado `ok`, 13 URLs inspeccionadas, 0 errores.

  | Estado en Google (URL Inspection) | Guías |
  |---|---|
  | NEUTRAL · «Google no reconoce esta URL» | 11, entre ellas las 3 guías de M11-E2 |
  | NEUTRAL · «Descubierta: actualmente sin indexar» | 2 (`mejores-series-y-peliculas-disney-plus-espana`, `netflix-hbo-max-disney-prime-video-que-plan-elegir`) |
  | Indexada (PASS) | **0** |

- **Search Analytics:**
  - 0 filas para `/guias/` en 28 días, con línea base 0/28 marcada como incompleta.
  - No se rellenan días: «sin datos de Google» no equivale a «0 clics».
- **Conclusión:** ninguna guía está indexada en Google según su propia API. HTTP 200, `index,follow` y sitemap no implican indexación, y este informe no afirma ninguna.

## 10. Verificación del mantenimiento

**Verificación real en producción.** El ciclo re-descargó las fuentes BOE y CNMC de las 3 guías publicadas por la política y re-verificó cada cita:

- `subtitulos-…`: 33 afirmaciones verificadas, sin cambios.
- `limite-anuncios-…`: 22, sin cambios.
- `horario-proteccion-menores-…`: 25, sin cambios.

No hubo regeneración ni llamada al modelo. La próxima comprobación es el 2026-11-27, a 30 días porque son hechos estables. Las otras 10 guías no las publicó la política, así que las revisa una persona; se vuelven a comprobar a los 30 días.

**Actualización versionada** (`BlogController.revise.mongo.test.ts`, contra Mongo real):
- una revisión certificada se publica en el sitio, conserva URL y fecha de primera publicación, y guarda la versión anterior;
- una revisión con el crítico en `block` se rechaza y lo publicado queda intacto;
- el hash obsoleto da 409;
- no se puede cambiar el slug ni quitar la procedencia;
- una firma falsificada se rechaza;
- la parada de emergencia se aplica;
- los campos sin firmar (canonical, afiliación) se ignoran;
- repetir la misma revisión se rechaza, y cuenta para el cupo;
- el rollback funciona;
- una guía aprobada por una persona no se puede tocar.

**Fallos de fuente:** una fuente caída se reintenta hasta 3 días antes de contar como cambio.

**Cambio confirmado:** si un cambio se confirma en 2 comprobaciones diarias y la revisión no se certifica, la guía pasa a borrador. Es la retención reversible ya establecida: sale del sitio y del sitemap, y la versión publicada queda como revisión. Cada resultado relevante se notifica a la lista de trabajos del Admin.

**Sin demostrar en producción:** una actualización real, porque ninguna evidencia ha cambiado. No se forzó una regeneración innecesaria.

## 11. Gasto estimado y volumen de peticiones

**Total del 2026-10-28, según el diario de la máquina:** 3,385 USD estimados a precio de lista. Son llamadas por la suscripción a través del gateway: es una estimación, no una factura.

| Concepto | Llamadas | Tokens entrada / salida | USD est. |
|---|---|---|---|
| Descubrimientos (3 con respuesta) | 3 | — | 0,368 |
| Artículo publicado | 11 (8 Opus, 3 Haiku) | 77 300 / 22 496 | 0,710 |
| Artículo bloqueado | 21 (18 Opus, 3 Haiku) | 268 784 / 63 791 | 2,307 |

- **Intentos del día:** 5 trabajos en el diario, frente a un tope de 30.
- **Presupuesto:** `unlimited`, por decisión del propietario para las pruebas. Sigue registrándose por llamada y modelo, y se ve en el panel «Hoy» del Admin.

## 12. Tests y revisiones independientes

**Resultados:**

| Suite | Resultado |
|---|---|
| Backend lint | limpio |
| Suite backend completa con Mongo (Windows) | 755/761; fallan 5 tests conocidos de Windows (`tar C:\` y modo de fichero POSIX) y 1 está omitido. CI en Linux en verde |
| Tests nuevos: cola de temas | 9 |
| Tests nuevos: enlaces internos | 5 |
| Tests nuevos: ciclo del scheduler | 7 |
| Tests nuevos: caché SSR | +1 (6) |
| Tests nuevos: `revise-by-policy` | 1 integral |
| Tests nuevos: monitor Search Console | Mongo, 5 subcasos (indexada y no indexada, credenciales ausentes, sin datos, 429, 403) |
| Editorial en total | 86/86 |
| Frontend | lint con 0 errores; 360/360 |
| Playwright del Admin | 5/5 (nuevo: la tabla de Search Console separa «indexada» de «publicada» y no muestra ceros inventados) |

**CI:** los PRs #111, #112 y #113 pasaron backend, frontend y verify. En `main` (`e7aaf2b`, `0d1faa7`, `16f5037`) pasaron Build/test/perf (incluido `test:ops`) y SEO regression.

**Incidencia de proceso:** el #113 se fusionó antes de que arrancara su CI, porque `gh pr checks --watch` no encontró checks y devolvió control enseguida. Luego se comprobó que el CI del PR y el de `main` terminaron en verde, así que no hizo falta revertir.

**Revisión independiente (Agent D):** 0 BLOCKER, 1 HIGH, 6 MEDIUM y 12 LOW.

Corregidos en `262796f`:
- **H1:** las guías con evidencia perdida se notifican al Admin y, si el cambio se confirma, pasan a la retención reversible.
- **M1:** solo se aplican campos firmados y la canonical es fija.
- **M2:** los enlaces absolutos al propio sitio pasan por el gate.
- **M3:** el cupo se relee tras el mantenimiento.
- **M4:** la clave humana se rechaza también en los comandos nuevos.
- **M6:** la etiqueta del Admin es veraz.
- **LOW 1, 2, 8 y 10.**

No corregidos:
- **M5:** el presupuesto ilimitado por defecto en el runner desatendido es la decisión del propietario para las pruebas.
- **LOW pendientes:**
  - 3: carrera con tres procesos en la recuperación del lock; la probabilidad es muy baja.
  - 4: la cola no excluye slugs ya públicos tras un fallo al guardar; regenera, pero nunca publica dos veces.
  - 5: las revisiones no suben portada; hoy no hay imágenes.
  - 6: el epoch revela la hora de arranque y cuenta las escrituras editoriales.
  - 7: otras páginas SSR que muestran guías esperan al TTL.
  - 9: las semillas siguen redirecciones.
  - 11: las entradas rechazadas no se purgan.
  - 12: posible 403 en una propiedad de tipo URL-prefix.

## 13. PRs y commits

| PR | Squash | Contenido |
|---|---|---|
| #111 | `e7aaf2b` | `revise-by-policy` y epoch SSR (`1690428`); monitor GSC (`e7cda5e`); cola, ciclo, mantenimiento y enlaces (`e81fb92`); correcciones de la revisión (`262796f`) |
| #112 | `0d1faa7` | Hallazgo del canario: dos editores verificados por tema |
| #113 | `16f5037` | Hallazgo del canario: la regla general del redactor contradecía la lista de enlaces; ahora hace falta al menos un enlace interno verificado |
| docs | (este PR) | Este informe, `GUIATV-MILESTONES.md` (M11-B, M11-F) y `CURRENT-STATE.md` |

## 14. Release de producción y smoke tests

**Despliegue:** `deploy-artifact.yml`, ejecución 40670688741, release `20261028111735`. El `gitSha` `e7aaf2b…` está verificado en el host. `guiatv-api` y `guiatv-ssr` están activos con `NRestarts=0`, también tras el reinicio por el flag GSC.

**Smoke:**
- **Páginas:** `/`, `/guias`, `/guias/categoria/television`, `/politica-editorial`, `/sitemap.xml`, `/v2/health` y una guía responden 200, con canonical propia e `index, follow`.
- **Cabeceras y rutas:** `X-Editorial-Epoch` está presente. `revise-by-policy` sin claves responde 403.
- **Política:** `envEnabled`, `activated` y `active` en true; no está pausada; límite 10.
- **Guía nueva:**
  - 200, canonical propia, `index, follow`, declaración de IA y `Article`;
  - aparece en `/guias` y en `/guias/categoria/streaming` **en la primera lectura**: el defecto de caché SSR de M11-E2 queda corregido;
  - está en `sitemap-blog.xml`.
  - Su cuerpo enlaza solo `/politica-editorial`: se publicó antes de #113 (§15).

**Parada de emergencia:** está disponible y probada con tests en el servidor, el runner, el ciclo y el descubrimiento. No se pulsó en producción.

**Rollback:** release `20261027211302`. El flag GSC se retira restaurando el backup de `api.env`.

## 15. Limitaciones conocidas

- **Host del runner:** necesita el PC del propietario encendido, con sesión iniciada y el gateway activo. Si falta, el ciclo no corre o falla de forma controlada; no hay ningún runner en el servidor.
- **Primera guía autónoma sin enlaces internos:** el cuerpo no enlaza ninguna página de GuíaTV. Ya está corregido para las siguientes (#113). No se regeneró solo para añadir enlaces.
- **Sin datos propios en los temas descubiertos:** los temas no traen `internalSources`, así que el valor se apoya en comparar dos editores. Los datos EPG siguen sin ser fiables para metadatos de películas.
- **`figure-in-words` puede ser demasiado estricto con textos legales:** en el canario 1 marcó «una obra» y las penas escritas con letras. No se tocaron las reglas de evidencia.
- **Disparadores de mantenimiento no implementados:** cambios de rendimiento en GSC, peticiones de mantenimiento desde el Admin y cambios de disponibilidad en streaming más allá de la re-verificación de fuentes.
- **Mantenimiento sin fichero de ejecución local:** las guías publicadas por la política sin su fichero de ejecución solo se notifican (`maintenance-unverifiable`).
- **Search Console:** sin indexación y sin datos de rendimiento todavía; la línea base de 28 días acaba de empezar.
- **Descubrimiento:** sin acceso web en el gateway. Las URLs semilla salen del conocimiento del modelo y solo se aceptan después de leerlas.

## 16. Bloqueos pendientes del roadmap

- **M11-B: PARTIAL.**
  - Se registra el requisito revisado del propietario: una publicación automática certificada puede cumplir el criterio editorial sin revisor nombrado. Ya hay evidencia de ello.
  - Se conserva el criterio original.
  - Sigue PARTIAL porque **M04-B no está cumplido** (todo ○, NO-GO) y porque quedan sin cerrar los rankings de plataforma, el calendario de mantenimiento y las URLs retiradas.
- **M12: NO-GO.**
  - M10 está parcial y M11-B parcial.
  - Falta un kill switch a nivel de índice y un gate por URL para familias programáticas.
  - GSC muestra 0 guías indexadas.

## 17. Siguiente hito (uno solo)

**M11-G: indexación y valor de las guías autónomas.**

Usar las observaciones de Search Console para decidir:
- por qué Google no reconoce las URLs: rastreo, enlazado desde hubs indexados, calidad;
- dar a los temas descubiertos datos propios de GuíaTV (`internalSources`) cuando existan;
- medir durante 28 días con la línea base completa antes de subir la cadencia.

Sin trabajo de M12.
