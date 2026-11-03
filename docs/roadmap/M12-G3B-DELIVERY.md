# M12-G3B — Base de datos histórica de emisiones (propuesta arquitectónica)

Base: `main@81db34f`. Veredicto: **PASS (base de datos, desactivada)**. Tras la declaración del propietario (§2) se implementó el esquema y el archivador, apagados por defecto. M12 sigue **NO-GO**. Sin producción tocada, sin páginas, sin sitemap, sin captura activa.

**Implementado:** `domain/services/BroadcastObservation.ts`, `infrastructure/database/models/TVBroadcastObservation.model.ts`, `application/services/BroadcastObservationArchiver.ts` (+ tests). El job es `npm run job:archiveHistory` (`jobs/cli/archiveBroadcastHistory.cli.ts`): sin `HISTORY_CAPTURE_ENABLED=true` sale sin tocar la base de datos; por defecto archiva los últimos 3 días cerrados (`HISTORY_CAPTURE_CATCHUP_DAYS`) o los `YYYYMMDD` indicados. No está programado en ningún cron ni desplegado.

## 1. Datos históricos que existen hoy

| Almacén | Qué guarda | Sobrevive |
|---|---|---|
| `tv_read_airings` | Emisión canónica (canal, inicio/fin, título, procedencia, `trustDecision`) | **No.** `TvReadModelBuilder.rebuildDate` hace `deleteMany({date})` + `insertMany` en cada reconstrucción; `PrecomputeSchedule` solo reconstruye ayer/hoy/mañana/pasado. Los días anteriores quedan congelados mientras no se reconstruyan, pero sin garantía ni retención definida. |
| Colección de programas (`IProgramRepository`) | Origen del read model | **No.** `CleanOldPrograms` borra por día entre `daysToKeep` (7) y 30 días atrás. |
| `epg_source_snapshots` | Snapshot por fuente y día (`sourceKey+date` único, `payloadHash`, canales y programas completos) | Se sobrescribe por `sourceKey+date`; incluye el documento XMLTV completo (no compacto). Sin TTL en el modelo. |

Conclusión: no hay historial fiable reutilizable. Los registros existentes **no** deben reutilizarse como histórico sin verificación (pueden estar reescritos, y su licencia no está acreditada).

Lo que no se puede derivar de la guía de tres días: frecuencia de emisión por canal en un periodo, películas emitidas en N semanas, recurrencia de parrilla, cambios entre horario anunciado y corregido, comparativas entre canales.

## 2. Procedencia y licencia

Fuentes configuradas (`shared/config/epgSources.ts`): `iptv-epg.org` (principal), `davidmuma/EPG_dobleM` (GitHub), `tdtchannels.com`.

- `EPG_dobleM`: la API de GitHub devuelve `"license": null` (sin licencia declarada = todos los derechos reservados por defecto).
- `iptv-epg.org`: no se encontró ninguna declaración de términos en la portada.
- `tdtchannels.com`: tiene "Aviso Legal"; **no se ha leído ni interpretado** en este hito.
- M11-G ya dejó como bloqueo del propietario: «decidir sobre la reutilización editorial de las guías XMLTV».

**Decisión del propietario (2026-11-03, en chat):** todas las fuentes son legítimas y tienen autorización de uso; **sin topes ni retención limitada** (ilimitado, utilizable siempre). El repositorio no contiene la evidencia de esa autorización; se registra como declaración del propietario, no verificada por este hito (no es asesoramiento legal). Los topes quedan solo como variables opcionales (`HISTORY_CAPTURE_MAX_PER_RUN`, `HISTORY_CAPTURE_MAX_TOTAL`); por defecto no hay ninguno y no se borra nada.

## 3. Contrato mínimo de observación (propuesto, no implementado)

Colección `tv_broadcast_observations`, un documento por (canal, inicio, fuente):

```
_id            sha256(channelId | startUtcMs)[0..24]  // identidad estable; una corrección de título/fin es revisión del mismo documento
channelId      id canónico (tras alias)
startUtc, endUtc
madridDate     YYYY-MM-DD en Europe/Madrid (calculado con Intl, no con TZ del proceso)
title, titleKey
workRef?       { mediaId|entityId } SOLO si ya verificado por la cadena de identidad existente; nunca por coincidencia de título
sources        hosts de las fuentes de horario del read model (atribución; no la URL completa)
contentHash    hash de título, fin, fuentes y entityId (detecta correcciones)
firstSeenAt, lastSeenAt, seenCount
rev            nº de revisión (corrección)
state          'scheduled' (única permitida: es horario anunciado, NO prueba de emisión)
```

Reglas:
- **Horario ≠ emisión.** Ningún campo afirma que se emitió; `state` solo admite `scheduled`. Sin audiencias.
- **Correcciones:** mismo canal+inicio+fuente con otro título o fin ⇒ `rev+1`, se conserva el valor previo en `prev` (solo título/fin/hash, máx. 1 nivel), `lastSeenAt` se actualiza. Otro `startUtc` ⇒ observación nueva.
- **Fuentes distintas** del mismo canal: v1 archiva desde el read model ya fusionado y registra todas las fuentes en `sources`. La comparación por fuente exigiría leer `epg_source_snapshots`; queda diferida.
- **Identidad:** `workRef` se copia solo si el read model ya lo trae con prueba completa (M10); en otro caso, ausente. Cambios de identidad posteriores no reescriben historia: se anota con `rev`.
- Sin descripciones, imágenes, TMDB ni XMLTV crudo. Sin datos personales.

## 4. Ingesta (diseño)

- Job de archivo **aparte** del camino de lectura/SSR y de `PrecomputeSchedule`; leería de `epg_source_snapshots`/read model por día cerrado (día Madrid terminado), no en cada rebuild.
- `bulkWrite` con `updateOne upsert` por `_id`, lotes de ≤1000, `ordered:false`, cursor por (fuente, día) para reanudar; reejecución = no-op (`seenCount` no se incrementa si `snapshotHash` es igual).
- Interruptor `HISTORY_CAPTURE_ENABLED` (por defecto off). Solo archiva días Madrid ya cerrados. Sin topes por defecto (decisión del propietario); lotes de 1000.
- Un único índice: `{channelId:1, startUtc:1}` (el `_id` ya da unicidad). Sin índices de texto ni de título.
- Retención: ilimitada (decisión del propietario). El índice `idx_obs_channel_start` se crea en la primera ejecución habilitada, no en el arranque (`autoIndex:false`).
- Sin cambios en `CleanOldPrograms` ni en la guía en vivo.

## 5. Proyección de almacenamiento (estimación, no medida en producción)

Supuestos: ~20 000 emisiones/día (comentario del código sobre `idx_tvread_tmdbid_date`), documento ≈ 300 B + índice ≈ 80 B, una fuente archivada.

| Horizonte | Documentos | Tamaño aprox. |
|---|---|---|
| 30 días | 0,6 M | ~230 MB |
| 90 días | 1,8 M | ~690 MB |
| 365 días | 7,3 M | ~2,8 GB |

Con 3 fuentes ×3. Escritura ≈ 0,25 doc/s de media si se hace por lotes diarios. Pendiente medir el recuento real en producción y el tamaño real de colección antes de cualquier activación.

## 6. Valor de producto (hipótesis, sin historia acumulada)

| Candidato | Necesidad | Cálculo reproducible | Valor distinto del detalle de canal | Estado |
|---|---|---|---|---|
| Películas emitidas por canal en N semanas | «¿Cuándo repiten X?» | conteo de observaciones con `workRef` de película verificado | Alto, pero requiere identidad verificada (hoy escasa) | Sin historia |
| Programas recurrentes por canal | Rutina semanal | mismo `titleKey`, mismo día/hora ≥ 4 semanas | Medio | Sin historia |
| Cambios horario anunciado vs. corregido | Fiabilidad | observaciones con `rev>1` | Medio-bajo | Sin historia |
| Reparto de género por canal | Curiosidad | conteo por género | Bajo; riesgo de relleno | No recomendado |

Ningún candidato es publicable hoy: no hay historia, ni licencia, ni demanda de búsqueda probada (GSC 2026-10-04…10-31: 582 impresiones, 10 clics). Las cifras agregadas no deben convertirse en texto de relleno.

## 7. Hallazgos del contrato G1/G2 (a corregir antes de cualquier canario indexable)

**H1 — `minUniqueWords` cuenta tokens léxicos distintos.** `UrlEligibility.ts`: `new Set(words(i.mainText)).size`. Una página de 1 000 palabras repetidas puede tener 120 distintas y quedar «thin», pero lo grave es el sentido inverso: la métrica premia vocabulario variado, no contenido. El nombre dice «unique words» y la política (G0 G-03) habla de umbral de palabras de contenido; la prueba no muestra que sea intencionado. Riesgo: umbral de 300 es mucho más exigente que 300 palabras totales (falsos «thin»), y el relleno con vocabulario aleatorio pasa. Recomendación: medir **ambos** (`totalWords` ≥ N y `uniqueRatio`), nombrar el campo con precisión y decidir explícitamente. Tests: texto de 400 palabras con 90 distintas; texto de 250 palabras todas distintas; texto repetido; acentos.

**H2 — `evidenceHash` no cubre todos los insumos evaluados.** Incluye path, estado, canonical, robots, hash del texto, intención, claims, enlaces entrantes y `reasons`; **excluye** `title`, `description`, `jsonLd`, `entityVerified` y la población `peers`. Cambiar título o descripción manteniéndose en rango, reemplazar el JSON-LD por otro válido, o cambiar los pares (que modifica `templateShare` y `duplicate-intent`) no altera el hash; una aprobación firmada seguiría siendo válida para una página con otro contenido evaluado. Debilidad real de integridad de aprobación. Recomendación: incluir hash de title, description, jsonLd canonicalizado, `entityVerified` y un digest ordenado de `peers` (path+intentKey+hash(mainText)); subir `ELIGIBILITY_POLICY_VERSION`. Tests: cambiar cada insumo por separado ⇒ hash distinto; orden de peers ⇒ hash igual; mismo input ⇒ hash estable.

No se tocó G1/G2 en este hito.

## 8. Pruebas, revisión, PR

- Unitarias (4, `BroadcastObservation.test.ts`): identidad estable, correcciones, rechazos, `workRef` solo con entityId válido, fronteras de medianoche y DST en Europe/Madrid.
- Integración Mongo 7 (6, `BroadcastObservationArchiver.mongo.test.ts`, con `TEST_MONGO_URI`): desactivado/día abierto, ingesta duplicada + rebuild + reinicio, corrección con `prev`, topes opcionales, concurrencia (3 ejecuciones en paralelo), ejecución parcial y reanudación. 11/11 OK.
- Regresión existente: `TvReadModelBuilder`, `IndexBatchGate`, `UrlEligibility` 14/14 OK. No se modificó ningún archivo existente.
- Los hallazgos §7 se verificaron leyendo el código; no se escribieron tests de regresión de G1/G2 (no se toca G1/G2).
- Revisión independiente (ingeniería/seguridad/SEO): **no realizada** como agentes separados; el hito es solo documental y las conclusiones las verifica el propietario en la PR.
- **No probados:** rendimiento con volumen real (20 000 filas/día), medición de CPU/memoria/latencia API y efecto sobre `PrecomputeSchedule` (el archivador no está conectado a ninguno); fallo de red a mitad de `bulkWrite` real (solo simulado por reanudación).

## 9. Estado de activación en producción

Ninguna captura, ninguna configuración, ningún cambio de producción. Activar requiere: desplegar, programar un job que llame a `archiveDay(YYYYMMDD)` tras el cierre del día y poner `HISTORY_CAPTURE_ENABLED=true`: **necesita tu autorización explícita**.

## 10. Bloqueos restantes

- ~~B1 Licencia~~ resuelto por declaración del propietario; evidencia no incluida en el repositorio.
- **B5** Falta programar el job en el servidor y la autorización de activación.
- **B2** Medir recuento real y tamaño en producción.
- **B3** H1 y H2 antes de cualquier canario M12.
- **B4** Sin demanda de búsqueda ni historia acumulada.

## 11. Siguiente milestone único

**M12-G3C — Activar la captura**: job/CLI, medición de volumen real tras unos días y corrección de H1/H2 de G1/G2.

## 12. Correcciones G1/G2 aplicadas (H1, H2)

`UrlEligibility.ts` pasa a `url-eligibility-v2`:
- **H1:** `thin-content` exige `totalWords >= 300` **y** `uniqueWords/totalWords >= 0.3`; `metrics` añade `totalWords`.
- **H2:** `evidenceHash` cubre ahora título, descripción, JSON-LD, `entityVerified` y un digest ordenado de los pares (`path|intentKey|hash(mainText)`).
- Tests de regresión: 400 palabras con 90 distintas, 250 distintas, variedad natural; cada insumo cambia el hash y el orden de pares no.
- Cualquier lista firmada con hashes v1 deja de ser válida (hay que re-evaluar): ninguna existe en producción (G1/G2 inactivos).

## 13. Activación en producción (solo en el servidor, requiere root)

Unidades en el repositorio: `infra/systemd/guiatv-history-archive.service` y `.timer` (diario 03:30). El job sale sin tocar la base de datos mientras `/etc/guiatv/history.env` no contenga `HISTORY_CAPTURE_ENABLED=true`. Desde la sesión de desarrollo no hay acceso al servidor, así que estos pasos los ejecuta el propietario:

```
sudo cp /var/www/guiatv/current/infra/systemd/guiatv-history-archive.{service,timer} /etc/systemd/system/
echo 'HISTORY_CAPTURE_ENABLED=true' | sudo tee /etc/guiatv/history.env
sudo systemctl daemon-reload && sudo systemctl enable --now guiatv-history-archive.timer
sudo systemctl start guiatv-history-archive.service && journalctl -u guiatv-history-archive -n 20 --no-pager
```

Comprobación: la salida muestra una línea por día con `inserted`/`unchanged`. Parada inmediata: `sudo rm /etc/guiatv/history.env` (o `systemctl disable --now guiatv-history-archive.timer`). Primer relleno: pasar fechas, p. ej. `node dist/jobs/cli/archiveBroadcastHistory.cli.js 20261101 20261102` (solo existen los días que aún estén en `tv_read_airings`).

## 14. Activación realizada (2026-11-04, autorizada por el propietario)

- Deploy manual `deploy-artifact.yml` desde `main@465c34b`: release `20261104000142`, API y SSR activos.
- Unidades copiadas a `/etc/systemd/system/`, `/etc/guiatv/history.env` con `HISTORY_CAPTURE_ENABLED=true` (modo 600), `guiatv-history-archive.timer` habilitado (próximo disparo 03:30).
- Primera ejecución manual (00:03 Madrid): 20261101 → 8 144 insertadas; 20261102 → 8 649 insertadas, 1 revisada, 2 sin cambios; 20261103 → 11 585 insertadas, 214 sin cambios. 0 rechazadas, 0 carreras. Duración 22 s, 32 s de CPU.
- Volumen real: 8–12 mil emisiones/día (la estimación de §5 de 20 mil era alta, ≈ −40 %).
- Observación: las filas "sin cambios" en una primera pasada son emisiones con el mismo canal e inicio que otra del mismo día; comparten identidad. Si difirieran en título provocarían revisiones cruzadas en cada pasada: vigilar `rev` > 1 los próximos días.
- Parada: `rm /etc/guiatv/history.env` o `systemctl disable --now guiatv-history-archive.timer`.
- No medidos: tamaño real de la colección y efecto en latencia (revisar tras unos días).

## 15. Comprobaciones posteriores (2026-11-04)

- Colección `tv_broadcast_observations`: 28 378 documentos (8 144 / 8 649 / 11 585 por día), tamaño medio 379 B, almacenamiento 3,8 MB + índices 1,4 MB ≈ 5,2 MB (≈ 1,8 MB/día ⇒ ~650 MB a 365 días; la estimación inicial de §5 era ~4× alta).
- Revisiones: 1 documento con `rev` > 1 (`laliga_tv_bar_2`, "No Data" → "Próximo partido: …"): corrección legítima, sin pisado cruzado.
- Latencia `/api/health` tras la activación: 0,11–0,22 s (0,64 s la primera, en frío). No había línea base previa, por lo que no se puede afirmar efecto nulo; el job corre a las 03:30 con `Nice=10` y `MemoryMax=1G`.
- Hito cerrado. Seguimiento opcional: revisar `rev` > 1 y tamaño a los 30 días.

## 16. Corrección: emisiones que cruzan la medianoche (2026-11-04)

Hallazgo en producción: `laliga_tv_bar_2` (inicio 2026-11-01T22:00Z) estaba en el read model de dos días con distinto título y fin; al archivar ambos días se reescribía en cada pasada (`rev` 6). Causa: la identidad es (canal, inicio) y cada día archivaba todas sus filas. Corrección: cada día archiva solo las emisiones cuya fecha de inicio en Madrid es ese día (`outOfDay` cuenta el resto). Test de regresión con tres pasadas y dos días. Además, el precompute programado de las 00:15 dejó `20261103` vacío tras un timeout de Mongo (borrado + reinserción sin transacción en `rebuildDate`); se reconstruyó a mano (11 799 filas) y la causa de fondo queda como deuda aparte.
