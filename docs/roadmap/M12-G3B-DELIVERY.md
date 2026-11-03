# M12-G3B — Base de datos histórica de emisiones (propuesta arquitectónica)

Base: `main@81db34f`. Veredicto: **PASS (base de datos, desactivada)**. Tras la declaración del propietario (§2) se implementó el esquema y el archivador, apagados por defecto. M12 sigue **NO-GO**. Sin producción tocada, sin páginas, sin sitemap, sin captura activa.

**Implementado:** `domain/services/BroadcastObservation.ts`, `infrastructure/database/models/TVBroadcastObservation.model.ts`, `application/services/BroadcastObservationArchiver.ts` (+ tests). Nada lo invoca: hace falta un job/CLI explícito y `HISTORY_CAPTURE_ENABLED=true`.

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
- **B5** Falta el job/CLI que invoque `archiveDay` y la autorización de activación.
- **B2** Medir recuento real y tamaño en producción.
- **B3** H1 y H2 antes de cualquier canario M12.
- **B4** Sin demanda de búsqueda ni historia acumulada.

## 11. Siguiente milestone único

**M12-G3C — Activar la captura**: job/CLI, medición de volumen real tras unos días y corrección de H1/H2 de G1/G2.
