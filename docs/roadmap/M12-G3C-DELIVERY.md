# M12-G3C — cierre de deuda de G3B

Fecha de redacción: 2026-11-04. Veredicto: **PARTIAL** (A y B hechas; C pendiente de ≥3 ejecuciones reales del timer y de las mediciones en producción).

## 1. Deuda A — `rebuildDate` ya no deja el día vacío (PR #159)

Antes: `deleteMany({date})` + `insertMany`. Un `MongoNetworkTimeoutError` entre ambos (2026-11-04 00:15, día 20261103) dejó el día vacío.

Ahora (`TvReadModelBuilder.replaceDayAirings`): `bulkWrite` de `replaceOne` upsert por `id` (índice único existente, validación de esquema conservada: verificado que `replaceOne` valida `program.entityId`) y, solo si termina bien, `deleteMany({date, id: {$nin: nuevos}})`. Un fallo lanza antes de borrar nada y se registra.

Decisiones:
- **Sin transacción:** el Mongo de producción puede ser standalone; las transacciones exigen replica set. No se comprobó en producción (requería ejecutar código allí). El diseño funciona en ambos.
- **Sin índices nuevos**; la lectura no cambia. Ids deterministas, así que reintentar es idempotente.
- **Serialización por fecha dentro del proceso** (hallazgo de revisión): dos rebuilds de la misma fecha con conjuntos distintos se borraban filas mutuamente. Entre procesos distintos sigue sin cerrojo (`shortcut:` en el código); el precompute es un cron en proceso y el CLI de archivo no reconstruye.
- **Un rebuild con 0 programas ya no vacía el día** (hallazgo de revisión; el código antiguo sí lo hacía): se conserva lo existente y se avisa en el log.
- Un fallo parcial de `bulkWrite` (`ordered:false`) deja el día mezcla de filas viejas y nuevas, sin borrados; el siguiente rebuild converge.

Pruebas (Mongo 8.0 en Docker local, `TEST_MONGO_URI`): fallo simulado entre escritura y borrado (día intacto, error propagado), reemplazo + reintento + otros días + sin duplicados, 0 programas, 3 rebuilds concurrentes con un lector que nunca ve el día vacío, dos conjuntos distintos concurrentes (gana el último). Regresión: `TvReadModelBuilder.test`, `catalogue-link.mongo`, `ContentIdentity*`, `SyncEPGData.year-provenance.mongo` — 44/44.

Rendimiento (12 000 filas, 12 índices, Mongo 8 local, 3 repeticiones, solo la operación de BD):

| | 1 | 2 | 3 |
|---|---|---|---|
| antes (delete+insert) | 3,68 s | 3,63 s | 3,32 s |
| después (upsert+delete) | 3,96 s | 3,21 s | 3,01 s |

Equivalente en tiempo; antes el día estaba vacío todo ese intervalo. No se midió en producción ni la latencia de API/SSR durante un rebuild.

## 2. Deuda B — revisión independiente

Tres revisores de solo lectura (datos/ingeniería, seguridad/operaciones, SEO/producto). Ningún BLOCKER; los HIGH lo eran solo por paridad con el código antiguo.

| # | Sev. | Hallazgo | Estado |
|---|---|---|---|
| 1 | MEDIA | Rebuilds concurrentes de la misma fecha pierden filas | Corregido (PR #159, en proceso) |
| 2 | ALTA* | Rebuild con 0 programas vacía el día (paridad con el antiguo) | Corregido (PR #159) |
| 3 | MEDIA | `find({date}).sort({id})` del archivador sin índice `{date,id}`: orden en memoria de un día completo | Corregido: sin `sort` (el lote no necesita orden) |
| 4 | MEDIA | El CLI usaba el contenedor completo (siembra colecciones ajenas, conecta Redis y registra su URL) | Corregido: solo `connectMongoDB` |
| 5 | BAJA | `closedDays` restaba 24 h, no días: salta un día si corre cerca de medianoche en el cambio horario | Corregido + tests (23 h y 25 h) |
| 6 | MEDIA | Unidad systemd sin límites de CPU/E-S ni `NoNewPrivileges`/`PrivateTmp` | Corregido en el repo; **aplicar en el servidor requiere autorización** |
| 7 | BAJA | `evidenceHash`: JSON-LD/claims sin orden canónico de claves; pares `path\|intentKey\|hash` con colisión por separador | Corregido, política → `url-eligibility-v3` |
| 8 | MEDIA | `IndexBatchGate` no compara versión de política ni recalcula el hash (el doc G3B §12 decía lo contrario) | Doc corregido; el rechazo por versión **no se implementa** (G1/G2 inactivos, sin consumidores) |
| 9 | MEDIA | El id de emisión (`buildTvReadAiringId`) usa hora local: el día de 25 h (último domingo de octubre) dos emisiones 02:xx CEST/CET del mismo canal colapsan en una fila y una no llega a archivo | **No corregido**: cambiar el id regenera todas las filas y puede afectar a URLs. Próxima ocurrencia 2027-10-31. Candidato a milestone propio |
| 10 | MEDIA | `contentHash` incluye `sources`: una fuente que aparece/desaparece genera revisiones indefinidas | **No corregido**: cambiar el hash revisaría de golpe los 28 378 documentos. Medido: 1 doc con rev>1 de 28 378. Disparador: si `docsWithRevGt1` crece |
| 11 | MEDIA | `prev` guarda un solo nivel; A→B→A→B pierde el primer título | **No corregido**: decisión de diseño (G3B §3); ver 10 para el disparador. Alternativa: `revs[]` acotado por cambios reales |
| 12 | BAJA | `workRef` no se elimina si desaparece `entityId`; `raced` mezcla duplicados y updates con guarda de `rev`; contadores perdidos si un día lanza | No corregido, sin impacto medido |
| 13 | BAJA | Watchdog sin alerta de frescura del archivo ni de disco; kill-switch sale con 0 sin alerta | No corregido (operaciones; proponer en G3D) |
| 14 | BAJA | Unidad corre como root con el `MONGODB_URI` de la API (lectura/escritura total) | No corregido: igual que `guiatv-api.service`; rol dedicado = trabajo de operaciones |
| 15 | MEDIA | Umbral de variedad 0,3 penaliza prosa larga legítima; 300 tokens aleatorios lo pasan; `peers` vacío salta duplicate-intent/template-share; entradas `undefined` lanzan | No corregido: G2 sin consumidores; revisar al conectarlo a una familia |
| 16 | INFO | Verificado: G1/G2 no conectados a rutas/sitemaps (`IndexBatchGate` sí está referenciado en `SitemapController`, inactivo salvo `INDEX_BATCH_ENABLED=true` con lista firmada; `isIndexable()` sin consumidores); `tv_broadcast_observations` sin ruta ni API; sin secretos ni IPs en el árbol revisado | — |

\* Alta solo por paridad con el comportamiento previo.

Cola de revisión sin hacer: el contenido de `ensureMongoCollectionsAndIndexes` y la versión real de Mongo de producción.

## 3. Deuda C — seguimiento medido: PARTIAL

Medido hoy (solo lectura, `journalctl`/`systemctl show` vía SSH, 2026-11-04 ~00:50 CET):
- El timer **nunca se ha disparado solo**: `LAST` vacío; primera ejecución programada 2026-11-04 03:30 CET. Solo existe una ejecución manual (00:37): 3 días en ~9 s de reloj, 13,1 s de CPU, `Result=success`; los tres días `inserted 0 / revised 0`; `unchanged` 8 144 / 8 649 / 11 585 y `outOfDay` 0 / 3 / 214 (suman las 8 144 / 8 652 / 11 799 leídas).
- `MemoryPeak` no está disponible (`MemoryAccounting` desactivado en la unidad).

**Bloqueado:** la colección (count/avgObjSize/almacenamiento/índices), los documentos con rev>1, la comparación por día contra el read model, la latencia de `/api/health` y de 3 endpoints antes/después de las 03:30 y la carga de Mongo durante el job requieren ejecutar código o sondas contra producción. El sistema de permisos denegó ejecutar `scripts/m12g3c-followup.cjs` en el servidor (la primera tentativa falló por un ajuste de pool, la segunda fue denegada), y no se ha eludido. Quedan pendientes de autorización explícita.

Comando reproducible (solo lectura; imprime recuentos, sin títulos):

```
cat scripts/m12g3c-followup.cjs | ssh root@109.123.248.164 'systemd-run --wait --pipe -q \
  -p EnvironmentFile=/etc/guiatv/api.env -p WorkingDirectory=/var/www/guiatv/current/apps/backend \
  -p Nice=19 -E MONGODB_MAX_POOL_SIZE=2 -E MONGODB_MIN_POOL_SIZE=0 node -'
journalctl -u guiatv-history-archive --no-pager -o short-iso --since 2026-11-04
systemctl show guiatv-history-archive.service -p ExecMainStartTimestamp,ExecMainExitTimestamp,CPUUsageNSec
```

Criterio de cierre: ≥3 ejecuciones del timer (03:30 de 2026-11-04, 05 y 06 → primer momento posible de concluir: **2026-11-06 tras las 03:30**) con `Result=success`, `missing = 0` por día en la salida del script y sin cambio de latencia respecto a la línea base.

## 4. Estado y siguiente paso

- M12 sigue **NO-GO**: sin historia acumulada ni demanda probada (GSC 2026-10-04..10-31: 582 impresiones, 10 clics); la captura empezó el 2026-11-01.
- Siguiente único milestone: **M12-G3D** — cerrar la deuda C con ≥3 ejecuciones reales y decidir entonces los hallazgos 9–11 con datos (revisiones observadas, día de 25 h).
- No se han tocado GSC, claves, páginas, rutas ni sitemap. Nada de esto está desplegado ni mergeado.
