# M12-G3D — validación operativa del archivo histórico

Fecha de redacción: 2026-11-04 (reloj local 01:27–01:50 Madrid, **antes** de la primera ejecución programada de las 03:30).
Base verificada: `origin/main` = `81d82329ffa66d23ee52e476adbb12fe52a826ac` (PR #159 `f703577`, PR #160 `81d8232`).
Veredicto: **PARTIAL**. Hecho: reconciliación por claves, tests, análisis de A/B/C, plan de despliegue de la unidad. **No hecho, por calendario y por permisos:** las tres ejecuciones del timer, y toda medición en producción.

## 1. Qué es G3D y qué no es

G3C dejó el código de A y B mergeado y desplegado (release `20261104010920`, run `41744415726`) y C pendiente. Esa es la única parte operativa abierta. G3D no abre ninguna familia de páginas, no toca producción, no activa `INDEX_BATCH_ENABLED`, no expone el archivo en rutas públicas, no cambia identificadores ni el algoritmo de `contentHash`.

## 2. Estado Git y producción

| Elemento | Valor | Cómo se comprobó |
|---|---|---|
| `origin/main` | `81d8232` | `git fetch` + `git log` |
| Checkout `guiatv` (`main`) | `30cdf72`, **por detrás** de origin; con ficheros sin seguir | No se ha tocado |
| Worktrees y stash previos | 6 worktrees y `stash@{0}: m11b-review-fixes` | Intactos |
| Rama de trabajo | `docs/m12-g3d-validation` en worktree `../guiatv-m12g3d` | Creada desde `origin/main` |
| Release en producción | `20261104010920` (run `41744415726`) | **Dato del encargo y de G3C; no re-verificado hoy** |
| Estado del servidor hoy | **No verificado** | SSH de lectura denegado (§12) |

## 3. Tres ejecuciones del timer (AC-01)

El timer es `OnCalendar=*-*-* 03:30:00`, `RandomizedDelaySec=120`, `Persistent=true`. Al redactar esto el reloj marcaba 01:27 del 2026-11-04: **ninguna ejecución programada ha ocurrido todavía**. Aunque se hubiera autorizado el acceso, no habría datos que leer. Las manuales no cuentan.

| Fecha | Disparado por timer | Inicio / fin reales | Result / exit | Duración | CPU | Memoria | Días procesados | inserted / revised / unchanged / rejected | Reintentos | Solape | Archivo previo intacto |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-04 | **PENDIENTE** | — | — | — | — | — | — | — | — | — | — |
| 2026-11-05 | **PENDIENTE** | — | — | — | — | — | — | — | — | — | — |
| 2026-11-06 | **PENDIENTE** | — | — | — | — | — | — | — | — | — | — |

Referencia no válida para AC-01 (manual, G3C §3, 2026-11-04 00:37): 3 días, ~9 s de reloj, 13,1 s de CPU, `Result=success`, `inserted 0 / revised 0`, `unchanged` 8 144 / 8 649 / 11 585, `outOfDay` 0 / 3 / 214.

Cómo rellenar la tabla (lectura, tras cada 03:30; requiere autorización de acceso al servidor):

```
journalctl -u guiatv-history-archive --no-pager -o short-iso --since "2026-11-04"
systemctl list-timers guiatv-history-archive.timer --no-pager
systemctl show guiatv-history-archive.service -p Result,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp,CPUUsageNSec,MemoryPeak,NRestarts
```

Aviso de medición: `systemctl show` solo conserva **la última** invocación. Hay que leerlo cada día entre las 03:35 y las 23:59; el 05/11 sobrescribe el 04/11. El `journalctl` sí conserva las tres. `MemoryPeak` salía vacío en G3C (ver §7).

## 4. Integridad del histórico por fecha (AC-03, AC-04)

**Defecto del procedimiento anterior.** `m12g3c-followup.cjs` calculaba `missing = max(0, readModelOwnUnique - observations)`. Con el mismo número de filas pero claves distintas devolvía `missing = 0`: un falso PASS. Además la clave que usaba, `channel.id|airing.start` en texto, no es el contrato de identidad del archivo (`sha256(channelId|startUtcMs)`).

**Sustituto (PR de G3D).**
- `apps/backend/src/domain/services/BroadcastObservationReconcile.ts`: `reconcileDay(day, filasReadModel, claveArchivada[])` pura, sin escrituras. Compara por `_id` = `observationId(channelId, startUtc)` (exportado ahora desde `BroadcastObservation.ts`, misma función que usa el archivador).
- `scripts/m12g3d-reconcile.cjs`: acotado (`--days` entero 1–14, 7 por defecto; una consulta por día en cada colección, con proyección y `maxTimeMS`), bajo `readOnlyGuard` (cualquier escritura termina el proceso con 97), sin títulos en la salida, con 5 ids de muestra por categoría.

| Categoría | Qué significa |
|---|---|
| `missing` | el read model posee la emisión ese día Madrid y el archivo no la tiene |
| `extra` | el archivo tiene un id sin fila en el read model (revisión de una fila retirada, o defecto) |
| `duplicateSourceRows` / `conflictingSourceRows` | varias filas del read model con el mismo canal+inicio; cuántas con título distinto |
| `archiveIdentityDefects` | dos documentos con mismo canal+instante, o `_id` ≠ hash de identidad |
| `outOfDay` | el inicio cae en otro día Madrid: lo posee la ejecución de ese día; **no es** `missing` |
| `rejected` | filas que el archivador rechaza por diseño (`no-channel`, `invalid-time`, `no-title`, `no-source`) |
| `archivedWithoutWorkRef` | evidencia, no inferencia: filas sin identidad de obra verificada |
| `archivedRevised` | `rev > 1` ese día |
| `status: not-reconcilable` | el read model ya no conserva ese día: **no se asume paridad** |

Fecha local: la comparación usa `madridDate(startUtc)` (`Intl`, zona Europe/Madrid), independiente de la TZ del proceso.

**Limitaciones declaradas.**
1. El read model **no es un registro histórico**: se reconstruye, y G3C ya mostró que puede reemplazar o vaciar un día. Un día sin filas se informa como `not-reconcilable`; un día con filas parciales produciría `extra`, no `missing`. La paridad solo prueba que el archivo cubre lo que el read model tiene **hoy** para ese día; no prueba que el read model fuese completo cuando se archivó.
2. Los `extra` tras una corrección de fuente son esperables (la fila corregida conserva clave y cambia contenido: eso es revisión, no `extra`); un `extra` solo aparece si la fila desapareció del read model.
3. La lectura de observaciones se hace por `madridDate`, sin índice: recorrido de colección (~5 MB hoy). Aceptable; ver `shortcut:` en el script.
4. **Solo claves**: una corrección de título o fin que el archivo no hubiera aplicado no se detecta. `extra` mezcla «fila retirada aguas arriba» con «defecto»: cualquier `extra` exige mirar.
5. El script emite un `verdict` por día (`PASS` solo con `missing`, `extra`, `archiveIdentityDefects` y `outOfDayUnarchived` en 0; `NOT-RECONCILABLE` si el read model no tiene filas). La lista de días es el rango de los últimos `--days` días cerrados (entero 1–14), **no** los días presentes en el archivo: un día que el archivador nunca escribió aparece como `missing`, no desaparece. Las filas `outOfDay` se comprueban contra el archivo del día propietario.

**Validado en local (Mongo 8.0.34 en Docker, base desechable):** el script corre de punta a punta bajo el guard (10 comandos, todos lectura) y devuelve `reconciled`, `missing 0`, `extra 0`.

**Estado en producción: BLOQUEADO** (§12). No se ha ejecutado nada contra el servidor real.

## 5. Tamaño y crecimiento (AC-05)

No medido hoy. Última medición registrada (G3B §activación, 2026-11-03): 28 378 documentos, 379 B de media, 3,8 MB de almacenamiento + 1,4 MB de índices, ≈ 1,8 MB/día ⇒ ≈ 650 MB a 365 días; 1 documento con `rev > 1` (corrección cross-midnight ya impedida por PR #158). Es una extrapolación lineal de tres días, no una tendencia. El script nuevo emite `count`, `avgObjSize`, `storageSize`, `totalIndexSize`, distribución de `rev`, observaciones por día y `fsUsedSize/fsTotalSize`.

## 6. Rendimiento API, SSR y Mongo (AC-06)

**No evaluable hoy.** No hay mediciones antes/durante/después de la ventana, y no se generará carga artificial. G3B registró `/api/health` en 0,11–0,22 s **sin línea base**: no sirve para afirmar efecto nulo. Para G3D la sonda primaria es `/v2/health` (ruta real en `health.routes.ts`).

Preparado, sin ejecutar: `scripts/m12g3d-probe.mjs` (GET secuenciales, 20 rondas, 1 s de pausa, solo lectura; reporta n, errores, p50, p95, máx). Ejecutarla tres veces con los mismos argumentos: ~03:00 (antes), ~03:31 (durante), ~04:00 (después), por ejemplo `PROBE_ORIGIN=https://<host> node scripts/m12g3d-probe.mjs antes 20 1000 /v2/health <ruta-lectura-1> <ruta-lectura-2> <ruta-ssr>`. Carga de Mongo durante el job: dos snapshots de `opcounters`/`connections` del script de reconciliación (antes y justo después) y su diferencia.

## 7. Configuración systemd efectiva (AC-07)

**La unidad instalada NO se ha inspeccionado** (SSH denegado). Lo único que consta es G3C §3: la unidad instalada no tenía `MemoryAccounting` (`MemoryPeak` vacío), es decir, **es anterior a los cambios del repositorio**.

Unidad del repositorio (`infra/systemd/guiatv-history-archive.service`), a verificar contra la instalada:

| Control | Repo | Notas |
|---|---|---|
| `User` | `root` | igual que `guiatv-api.service`; ver rol dedicado |
| `EnvironmentFile` | `/etc/guiatv/api.env` + `-/etc/guiatv/history.env` | el `-` hace opcional el segundo; sin él el job termina con 0 sin tocar la BD |
| `MemoryMax` | `1G` | con `NODE_OPTIONS=--max-old-space-size=512` |
| `CPUQuota` / `CPUWeight` / `Nice` | `50%` / `20` / `10` | solo limitan el proceso node, no `mongod` |
| `CPUAccounting` / `MemoryAccounting` / `IOAccounting` | `yes` (añadido en G3D) | para poder leer `CPUUsageNSec`, `MemoryPeak` e I/O tras cada ejecución |
| `IOSchedulingClass` | `idle` | |
| `NoNewPrivileges` / `PrivateTmp` | `yes` / `yes` | |
| `TimeoutStartSec` | `1800` | |
| Solape | `Type=oneshot`: systemd no arranca una segunda instancia de la misma unidad mientras la primera está activa | |

**Comprobación de lectura (pendiente de autorización):**

```
systemctl cat guiatv-history-archive.service guiatv-history-archive.timer
systemctl show guiatv-history-archive.service -p FragmentPath,DropInPaths,User,CPUQuotaPerSecUSec,CPUWeight,MemoryMax,MemoryAccounting,NoNewPrivileges,PrivateTmp,IOSchedulingClass,TimeoutStartUSec
ssh … 'systemctl cat guiatv-history-archive.service' | diff - infra/systemd/guiatv-history-archive.service
```

**Plan mínimo de despliegue (NO ejecutado; requiere autorización explícita del propietario):**

```
# 1. copia de seguridad y diff
cp -p /etc/systemd/system/guiatv-history-archive.service /root/guiatv-history-archive.service.bak-20261104
# 2. instalar solo la unidad (el timer no cambia)
install -m 0644 infra/systemd/guiatv-history-archive.service /etc/systemd/system/guiatv-history-archive.service
systemd-analyze verify /etc/systemd/system/guiatv-history-archive.service
systemctl daemon-reload            # no reinicia API, SSR ni Mongo; el oneshot no debe estar activo
# 3. verificar
systemctl show guiatv-history-archive.service -p CPUQuotaPerSecUSec,CPUWeight,MemoryMax,NoNewPrivileges,PrivateTmp,IOSchedulingClass
```

Rollback: restaurar la copia y `systemctl daemon-reload`. Ventana: nunca entre 03:30 y 03:35 ni con el servicio `activating`. Si se despliega **después** de la primera ejecución, la ejecución 1 se midió con la unidad antigua y el resultado de AC-07 debe indicarlo.

**Rol Mongo dedicado.** Apropiado. El job solo necesita `find`/`insert`/`update` sobre `tv_broadcast_observations`, `createIndex` (una vez; ya existe) y `find` sobre `tv_read_airings`. Hoy corre como `root` con la URI de la API (lectura/escritura sobre toda la base). Un rol `historyArchiver` limitaría el daño de un defecto en el archivador. **No se crea** sin autorización: implica credencial nueva en `/etc/guiatv/history.env`.

## 8. Hallazgo A — colisión DST del id de emisión (AC-08)

**Regla exacta.** `buildTvReadAiringId` (`apps/backend/src/shared/utils/tvMetadata.ts`) construye `${viewDate}_${canal}_${startToken}` con `getFullYear/Month/Date/Hours/Minutes/Seconds` del `Date`, es decir, **hora local del proceso** (en producción `TZ=Europe/Madrid`; los tests la fijan en `test-setup.cjs`). En el día de 25 h (último domingo de octubre) las 02:00–02:59 existen dos veces (CEST y CET); dos emisiones del mismo canal con la misma hora local producen el **mismo id**. El id es único en `tv_read_airings`, de modo que `replaceOne` upsert (PR #159) conserva solo una.

**Identidad del archivo.** `observationId = sha256(channelId|startUtcMs)`: instante UTC, **no** colisiona. El archivo hereda la pérdida solo porque la fila ya no existe en el read model. Test: ambas ocurrencias (2026-10-25 00:30Z y 01:30Z) producen el mismo id de read model y ids de archivo distintos, y `reconcileDay` los acepta a ambas cuando el read model las presenta.

**Consumidores del id** (grep): `tv.routes`/`TvController` (detalle de emisión), `EpgFootballDataProvider` (`findOne({ id })`), `FootballBroadcastMapping`, `EntityBroadcastService`, `ContentIdentityIngestion`, frontend (`tv-api.service`, `entity-broadcast-list`). Cambiar el id de **todas** las filas rompería esas referencias persistidas.

**Identidad futura compatible: viable.** Solo la segunda pasada de la hora repetida necesita un sufijo (`_cet`); regla candidata en test: `d.getTimezoneOffset() > new Date(d.getTime() - 3600000).getTimezoneOffset()`. Las demás emisiones del año mantienen su id actual (test con 4 instantes ordinarios). No se aplica en G3D.

| Impacto real | Evidencia | Severidad | Recomendación | ¿Milestone propio? |
|---|---|---|---|---|
| Una emisión del 02:xx CET se pierde (read model y archivo) una vez al año; afecta a canales con emisiones distintas en esa hora | Test de regresión; regla del id; sin datos de producción (la fecha 2025-10-26 ya no está en el read model) | MEDIA, **baja urgencia**: próxima ocurrencia **2027-10-31** | Sufijo condicional solo en la segunda pasada; migración innecesaria (los ids existentes no cambian) | **Sí, pequeño**, antes de octubre de 2027 |

## 9. Hallazgo B — `contentHash` incluye `sources` (AC-09)

El hash es `sha256([title, endMs, sources, entityId])`. Una fuente que aparezca o desaparezca entre dos pasadas revisa el documento sin cambio editorial.

| Impacto real | Evidencia | Severidad | Recomendación | ¿Milestone propio? |
|---|---|---|---|---|
| Sin impacto medido | 1 documento con `rev > 1` de 28 378 (G3B), causado por flip-flop cross-midnight ya corregido (PR #158). En G3C los tres días dieron `revised 0`. **Sin estadística de producción de hoy** | BAJA hoy | No cambiar el hash. Vigilar `revisionDistribution` y `archivedRevised` de cada día. Disparador: `rev > 1` > 1 % de los documentos de un día **y** revisiones cuyo único cambio sea `sources`. Cambiar el hash exige migración (revisaría de golpe todos los documentos) | No ahora |

## 10. Hallazgo C — `prev` de un solo nivel (AC-10)

| Impacto real | Evidencia | Severidad | Recomendación | ¿Milestone propio? |
|---|---|---|---|---|
| A→B→A→B pierde el primer título; el contrato conserva solo el valor anterior | 1 revisión observada en total; ningún patrón repetido | BAJA | **Aceptable bajo el contrato actual** (`seenCount`, `rev` y `prev` bastan para detectar inestabilidad). No introducir historial ilimitado. Si el disparador de B se cumple, evaluar un `revs[]` acotado (p. ej. últimos 3 cambios reales) | No ahora |

## 11. Quality gate e indexabilidad (AC-13)

G1 (`IndexBatchGate`) y G2 (`UrlEligibility`) se mantienen **inactivos**; `INDEX_BATCH_ENABLED` no se toca, no hay lote de sitemap, no hay ruta pública del archivo. Las seis preocupaciones documentadas siguen **abiertas y deben cerrarse antes de conectar G1/G2 a cualquier familia indexable**: compatibilidad de versión de política (`IndexBatchGate` no la compara), integridad del hash de evidencia (ya canonizado en `url-eligibility-v3`, pero el gate no lo recalcula), umbrales de similitud de plantilla (0,3 penaliza prosa larga legítima), poblaciones de pares ausentes (`peers` vacío salta las comprobaciones), entradas indefinidas (lanzan) y validación JSON-LD incompleta.

**Revisión SEO/producto (independiente, solo lectura):** G1/G2 sin consumidor no-test (`evaluateUrlEligibility`, `isIndexable` sin llamadas); `IndexBatchGate` solo en `SitemapController`, apagado por defecto; `tv_broadcast_observations` solo la tocan el modelo, el archivador y el CLI: ningún registro histórico llega a ruta, API, sitemap ni JSON-LD. **Matiz:** el gate está atado al sitemap, no a páginas; con `INDEX_BATCH_ENABLED=true` emitiría cualquier ruta firmada sin comprobar que exista, dé 200 o sea canónica. Las seis preocupaciones existen tal como se documentaron, todas latentes. Producto: **sin base hoy** para ninguna familia (≈3 días de archivo, 582 impresiones / 10 clics en 4 semanas, contenido propio de EPG con riesgo de fino/plantilla; el entry gate exige 28 días de línea base de GSC).

## 12. Operaciones bloqueadas por permisos (AC-11)

| Operación | Dónde | Resultado |
|---|---|---|
| `ssh root@<host> 'date; systemctl list-timers …; systemctl show guiatv-history-archive.service -p Result,ExecMainStatus,…,FragmentPath'` (metadatos de solo lectura de la unidad y del timer) | Producción | **Denegada** por el sistema de permisos (`[Production Reads]`) en esta sesión. No se reintentó por otra vía |
| `scripts/m12g3c-followup.cjs` en el servidor (G3C) | Producción | Denegada (heredado) |

Todo lo que depende de esas lecturas queda **bloqueado, no inferido**: tabla de §3, paridad por día en producción (§4), tamaño actual (§5), sondas de latencia (§6), unidad instalada (§7).

**Autorización mínima que se solicita (una sola, de solo lectura):**
1. SSH de lectura a producción solo para: `journalctl -u guiatv-history-archive`, `systemctl show/cat/list-timers` de esa unidad y del timer, `systemctl is-active mongod`.
2. Ejecutar `scripts/m12g3d-reconcile.cjs` con la receta `systemd-run` documentada en el script (guard de solo lectura, pool 2, `Nice=19`), una vez tras cada una de las tres ejecuciones.
3. Ejecutar `scripts/m12g3d-probe.mjs` contra el sitio público (≤ 20 GET secuenciales por ruta y por ventana).
Quedan **fuera** y exigen autorización aparte: copiar la unidad, `daemon-reload`, crear el rol Mongo, reiniciar nada.

## 13. Tests y revisión independiente (AC-12)

**Tests nuevos** (Mongo 8.0.34 en Docker desechable; `TEST_MONGO_URI`): 25/25 en los ficheros tocados, sin fallos.

| Requisito | Test |
|---|---|
| Hora repetida DST (ambas ocurrencias) | read model: mismo id para 00:30Z y 01:30Z; archivo: ids distintos; `reconcileDay` acepta ambas |
| Claves ausentes / recuentos iguales con claves distintas | puro + Mongo (observación borrada y sustituida por una forjada: `expected = archived`, `missing = [id]`, 1 `extra`, 1 defecto) |
| Corrección de fuente | misma clave, `archivedRevised` |
| Replay idempotente | existente (G3B) |
| Fallo parcial de escritura | escritura que muere a la mitad (2 de 4), siguiente ejecución completa y `reconcileDay` limpio |
| Revisiones y procedencia | existente + `archivedWithoutWorkRef` |
| Guard de solo lectura | `isWriteCommand`: lecturas del script permitidas, escrituras y `$merge` abortan |
| Día no disponible | `not-reconcilable` |
| Ejecución concurrente | existente (3 en paralelo); en producción `Type=oneshot` impide la segunda instancia |

**Tres revisiones independientes** (agentes de solo lectura, sin acceso a producción).

| Revisor | Hallazgo | Estado |
|---|---|---|
| Ingeniería | ALTA: la lista de días salía del propio archivo; un día nunca archivado no aparecía | Corregido (rango de días cerrados) |
| Ingeniería | MEDIA: `--days 0/NaN` procesaba todo | Corregido (entero 1–14) |
| Ingeniería | MEDIA: `outOfDay` suponía que otro día lo archivaba | Corregido (`outOfDayUnarchived`) |
| Ingeniería | MEDIA: solo claves, sin veredicto | Documentado + `verdict` |
| Ingeniería | BAJA: test parcial sin `reconcileDay`; propiedad residual en el modelo | Corregido |
| Seguridad | ALTA: `readOnlyGuard` es lista negra (`mapReduce`, `setParameter`, gestión de usuarios…, no listados) | **No corregido**: el script solo emite lecturas; migrar a lista blanca o a usuario Mongo de solo lectura, ver §14 |
| Seguridad | MEDIA: receta sin `MONGODB_MIN_POOL_SIZE=0`; sin `maxTimeMS`; `serverStatus`/`dbStats` hunden el informe sin `clusterMonitor` | Corregido (receta, 30 s, `catch`) |
| Seguridad | BAJA: `console.error(e)` | Corregido (`e.message`) |
| Seguridad | MEDIA: sin `CPUAccounting/MemoryAccounting/IOAccounting` (`MemoryPeak` vacío) | Añadido a la unidad **del repo**; no instalado |
| Seguridad | MEDIA: `NODE_OPTIONS` del `EnvironmentFile` anula el de la unidad; `CPUQuota`/`IOScheduling` no protegen a `mongod` (el reparto de carga lo decide la sonda, no la unidad) | Documentado; verificar con `systemctl show -p Environment,EnvironmentFiles` |
| Seguridad | BAJA: `User=root` + `NoNewPrivileges` casi no endurece; `Persistent=true` puede lanzar un 03:30 perdido en hora punta tras reinicio | Documentado; comparar `ExecMainStartTimestamp` con `LastTriggerUSec` |
| Seguridad | ALTA: root con la URI de la API; rol dedicado `history_archiver` (readWrite en `tv_broadcast_observations`, read en `tv_read_airings`; el índice ya existe, `createIndex` es no-op) y usuario de solo lectura con `clusterMonitor` para el script | Recomendado, **sin crear** |
| SEO/producto | Sin hallazgos de exposición; matiz del gate-sitemap (§11) | Documentado |

Verificaciones de solo lectura adicionales recomendadas por seguridad (para la autorización de §12): `systemctl --version`, `stat -fc %T /sys/fs/cgroup`, `uname -r` (`MemoryPeak` exige systemd ≥ 255 y kernel ≥ 5.19), y `IOReadBytes,IOWriteBytes`.

## 14. Deuda residual y siguiente paso

1. **Bloqueante para cerrar C:** autorización de lectura (§12) y las tres ejecuciones (hasta el 2026-11-06 tras las 03:30; la tabla de §3 debe rellenarse cada día, no al final).
2. `readOnlyGuard` como lista blanca (o usuario Mongo de solo lectura): el archivador y los scripts de auditoría dependen de ella.
3. Rol Mongo dedicado para el archivador y alertas de frescura del archivo y de disco en el watchdog (G3C #13, #14).
4. Hallazgo A: sufijo condicional del id de la segunda pasada de la hora repetida, antes del 2027-10-31.
5. G1/G2: las seis preocupaciones y el desacoplamiento gate-sitemap/página, antes de conectar cualquier familia.
6. El read model no es registro histórico: la paridad solo cubre lo que conserva hoy.

**Siguiente único milestone recomendado:** **M12-G3E — cierre operativo de C**: con la autorización de §12, leer las tres ejecuciones reales (04, 05 y 06/11), ejecutar el reconciliador tras cada una, medir con la sonda antes/durante/después, y decidir entonces el despliegue de la unidad. No empieza ninguna familia de páginas.


## 15. Criterios de aceptación

| AC | Estado | Nota |
|---|---|---|
| AC-01 tres ejecuciones del timer | **PENDIENTE** | 0/3; la primera es a las 03:30 de hoy |
| AC-02 frescura | **BLOQUEADO** | script preparado |
| AC-03 sin pérdida inesperada | **BLOQUEADO** | método y tests listos; sin datos |
| AC-04 paridad por día | **BLOQUEADO** | método clave a clave listo; `not-reconcilable` definido |
| AC-05 tamaño y revisiones | **PARCIAL** | solo datos de G3B (3 días) |
| AC-06 impacto API/Mongo | **BLOQUEADO** | sonda preparada; no hay línea base |
| AC-07 hardening efectivo | **BLOQUEADO** | unidad instalada sin inspeccionar; plan y rollback listos |
| AC-08 DST | **HECHO** | análisis + regresión; sin cambio de ids |
| AC-09 hash | **HECHO** (sin estadística de hoy) | |
| AC-10 `prev` | **HECHO** (sin estadística de hoy) | |
| AC-11 permisos | **HECHO** | una lectura denegada, no eludida |
| AC-12 revisiones | **HECHO** | tres revisiones; las correcciones demostradas, aplicadas (§13) |
| AC-13 G1/G2 inactivos | **HECHO** | |

M12 sigue **NO-GO**. No se ha activado nada indexable.
