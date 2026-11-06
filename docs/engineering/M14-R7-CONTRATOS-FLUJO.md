# M14-R7 — Contratos de estado del flujo editorial (versión `m14-r7.1`)

> Documento de referencia del Observatorio del flujo editorial. Define las **cuatro dimensiones
> de estado** (candidato, editorial, ejecución, publicación) y un **estado SEO separado**, con las
> funciones puras de mapeo desde los datos reales existentes. Es la fuente de verdad de la que
> consumen la guía (View A, "Cómo funciona") y el diagnóstico (View B, "Diagnóstico"), a través de
> la constante exportada `FLOW_STATE_GUIDE` en `apps/backend/src/application/editorialflow/`.

## 1. Por qué cuatro dimensiones + SEO

El flujo editorial mezcla en los datos actuales estados de naturalezas distintas. Para no
confundirlos, cada registro se descompone en **dimensiones independientes**:

| Dimensión | Responde a | Enum (cerrado) |
|---|---|---|
| **Candidato** | ¿El *tema* es apto para entrar en el flujo? | `discovered, eligible, invalid, rejected, duplicate, retained` |
| **Editorial** | ¿En qué punto está la *redacción y revisión*? | `researching, drafting, reviewing, revision-required, approved, rejected` |
| **Ejecución** | ¿Qué hace el *trabajo* (cola, arrendamiento, reintentos)? | `queued, running, paused, retrying, blocked, cancelled, failed, completed` |
| **Publicación** | ¿El artículo está *publicado*? | `unpublished, ready, scheduled, publishing, published, unpublished-after-publication` |
| **SEO** | ¿Google *indexa* la URL? | `no-inspeccionado, no-reconocida, descubierta-sin-indexar, crawleada-sin-indexar, indexada, error-de-fetch, bloqueada, evidencia-insuficiente` |

Cada estado declara, en `FLOW_STATE_GUIDE`, su **etiqueta española**, su **definición**, la lista
explícita de **lo que NO implica** y las **acciones de recuperación admitidas**. El resto de
acciones del catálogo "no aplican" para ese estado.

### 1.1 Candidato (descubrimiento y elegibilidad)

- `discovered` (Descubierto): propuesto por descubrimiento, aún sin pasar los gates.
- `eligible` (Elegible): superó valor y evidencia, admitido en cola.
- `invalid` (Inválido): no es válido tal cual (p. ej. slug no normalizado).
- `rejected` (Rechazado): descartado por el gate (evidencia insuficiente, rechazo manual).
- `duplicate` (Duplicado): duplica la intención de otro tema.
- `retained` (Retenido): conservado en espera (`held`) sin descartarse.

### 1.2 Editorial (redacción y revisión)

- `researching` (Investigando): recuperando/verificando evidencia.
- `drafting` (Redactando): hay borrador, aún sin revisión de calidad.
- `reviewing` (En revisión): el crítico evalúa el borrador.
- `revision-required` (Requiere revisión): el crítico señaló defectos; hay que reescribir.
- `approved` (Aprobado): superó la revisión de calidad.
- `rejected` (Rechazado editorial): el crítico bloqueó y se agotaron los ciclos.

### 1.3 Ejecución (trabajo)

- `queued` (En cola), `running` (En ejecución), `paused` (Pausado), `retrying` (Reintentando),
  `blocked` (Bloqueado), `cancelled` (Cancelado), `failed` (Fallido), `completed` (Completado).

### 1.4 Publicación

- `unpublished` (No publicado), `ready` (Listo para publicar), `scheduled` (Programado),
  `publishing` (Publicando), `published` (Publicado), `unpublished-after-publication` (Despublicado).

### 1.5 SEO (independiente)

El estado de indexación vive en `editorial_gsc_inspections`, **no** en `blog_posts`. La separación
existe porque publicar no garantiza indexar: Google puede no reconocer, descubrir sin indexar o
bloquear una URL ya publicada.

---

## 2. Las seis distinciones exigidas

Estas seis distinciones son invariantes del contrato y están codificadas en los metadatos
(`notImplies`) de cada estado:

1. **Descubierto vs aprobado.** `discovered` es una propuesta del ciclo de descubrimiento; `approved`
   es un borrador que superó la revisión de calidad. Entre ambos median elegibilidad, evidencia,
   redacción y revisión.
2. **Rechazado vs fallo técnico.** `rejected` (editorial) es un veredicto de calidad
   ("agotados los ciclos de revisión"); `failed` (ejecución) es un error técnico ("error: …").
   Un trabajo puede fallar técnicamente sin que el contenido sea rechazado, y viceversa.
3. **Retenido vs pausado.** `retained` (candidato) es un tema `held` que se conserva para
   reintentarlo; `paused` (ejecución) es un trabajo detenido a petición. No son equivalentes.
4. **Aprobado vs publicado.** `approved` no implica `published`: un artículo aprobado puede quedar
   `ready` (listo) o `scheduled` (programado) sin haberse publicado todavía.
5. **Publicado vs indexado.** `published` no implica `indexada`: un artículo publicado puede estar
   `no-reconocida` o `descubierta-sin-indexar` en Google.
6. **Ejecución programada vs manual.** La generación programada (ciclo de descubrimiento con
   `scheduleHours`) es una vía; la intervención manual (aprobación/rechazo de cola) es otra. El
   contrato distingue `origin`/`kind` y no las confunde en una misma dimensión.

---

## 3. Mapeo desde los datos reales (sin inventar historia)

Cuatro funciones puras producen una vista compuesta (`FlowView`) sin mutar la entrada:

| Función | Colección de origen | Dimensiones que rellena |
|---|---|---|
| `mapJobRecord` | `editorial_jobs` | candidato, editorial, ejecución, publicación |
| `mapQueueItem` | `editorial_queue_snapshot.items[]` | candidato, editorial, ejecución, publicación |
| `mapBlogPost` | `blog_posts` | editorial, publicación |
| `mapLedgerJob` | `editorial_job_ledger` | candidato, editorial, ejecución, publicación |
| `mapGscInspection` | `editorial_gsc_inspections` | seo |

Reglas comunes:

- Cada mapeo pasa por una **tabla explícita exportada** (p. ej. `JOB_STATE_TO_EXECUTION`,
  `QUEUE_REASON_PREFIX_TO_CANDIDATE`, `GSC_COVERAGE_TO_SEO`), nunca por heurísticas ocultas.
- **Lo que no consta** se representa como `'sin-datos'`; un valor presente pero **no reconocido**
  se representa como `'desconocido'`. Nunca se afirma un estado completado sin evidencia.
- Cada vista lleva su **procedencia** (`collection` + `workflowVersion`, o `'no-consta'` si el
  registro no la porta) y el estado/motivo crudos para trazabilidad.
- **No se fabrica historia**: la vista no inventa eventos ni transiciones; solo refleja lo que el
  registro declara.

### 3.1 Tabla de mapeo de `editorial_jobs.state`

| Estado origen (observado) | candidato | editorial | ejecución | publicación |
|---|---|---|---|---|
| `blocked` + motivo `error: …` | `eligible` | `sin-datos` | `failed` (técnico) | `unpublished` |
| `blocked` + motivo `agotados los ciclos de revisión` | `eligible` | `rejected` | `blocked` | `unpublished` |
| `blocked` + motivo `límite: …` | `eligible` | `sin-datos` | `blocked` | `unpublished` |
| `discovery` | `discovered` | `sin-datos` | `completed` | `unpublished` |
| `published` | `eligible` | `approved` | `completed` | `published` |
| `maintenance-verified` | `eligible` | `approved` | `completed` | `published` |
| `maintenance-unverifiable` | `eligible` | `approved` | `blocked` | `published` |

### 3.2 Tabla de mapeo de `editorial_queue_snapshot.items[].state`

| Estado origen | candidato | ejecución | publicación |
|---|---|---|---|
| `queued` | `eligible` | `queued` | `unpublished` |
| `running` | `eligible` | `running` | `unpublished` |
| `published` | `eligible` | `completed` | `published` |
| `held` | `retained` | `blocked` | `unpublished` |
| `rejected` (por prefijo de motivo) | ver 3.3 | `sin-datos` | `unpublished` |
| `expired` | `rejected` | `sin-datos` | `unpublished` |

### 3.3 Prefijos de motivo de la cola (`state=rejected`)

| Prefijo | candidato |
|---|---|
| `insufficient-evidence:` | `rejected` |
| `invalid-candidate:` | `invalid` |
| `duplicate:` | `duplicate` |
| `manual:` | `rejected` |

El ítem retenido usa `state=held` con motivo `blocked: agotados los ciclos de revisión (5)` →
candidato `retained`, editorial `rejected`, ejecución `blocked` (no pausado, no fallo técnico).

### 3.4 `blog_posts` (publicación y editorial)

- `status: publish` → publicación `published`; `status: draft` → `unpublished` (o `ready` si
  `reviewState: approved`).
- `reviewState`: `approved`→`approved`, `rejected`→`rejected`, `in-review`→`reviewing`,
  `unreviewed`→`drafting`, ausente→`sin-datos`.

### 3.5 `editorial_job_ledger`

- Ejecución desde `state` (`queued, running, paused, cancelling, cancelled, completed, failed,
  dead-letter, blocked`); `queued` con `attempt > 0` → `retrying` (regla explícita).
- Publicación desde `publication.state` (`publishing/published/rejected`); sin registro → `unpublished`.
- Editorial: publicado implica `approved`; si no, desde la etapa actual (`currentStage`).
- Candidato: `kind=discovery` → `discovered`; el resto → `eligible`.

### 3.6 SEO (`editorial_gsc_inspections`)

| Origen | estado SEO |
|---|---|
| cobertura `Google no reconoce esta URL` | `no-reconocida` |
| cobertura `Descubierta: actualmente sin indexar` | `descubierta-sin-indexar` |
| clase `crawled-not-indexed` | `crawleada-sin-indexar` |
| clase `indexed` | `indexada` |
| clase `blocked` | `bloqueada` |
| clase `fetch-error` | `error-de-fetch` |
| sin inspección | `no-inspeccionado` |
| sin datos suficientes | `evidencia-insuficiente` |

---

## 4. Ejemplos anclados a datos reales de producción

Los ejemplos proceden de las sondas de producción (`tmp-storage/m14r7/prod-probe*.txt`) y no se
inventan.

### Ejemplo A — "Retenido" no es "pausado", y no es un fallo técnico

En el snapshot de cola (`editorial_queue_snapshot`, 22 ítems) el tema
`cnmc-derechos-audiovisuales-accesibilidad-plataformas` aparece como:

```text
state=held  attempts=2  score=67
reason=blocked: agotados los ciclos de revisión (5)
```

Se mapea a candidato `retained`, editorial `rejected` y ejecución `blocked`. Es un tema
**retenido** para reintento, no un trabajo **pausado**, y el motivo no es un error técnico sino el
agotamiento de la revisión.

### Ejemplo B — "Rechazado" no equivale a "falló técnicamente"

Dos registros de `editorial_jobs` del mismo tema `cnmc-derechos-audiovisuales-accesibilidad-plataformas`
muestran la diferencia:

```text
state=blocked  reason=error: editorial: answer truncated at max_tokens   → ejecución failed (técnico)
state=blocked  reason=agotados los ciclos de revisión (5)                → editorial rejected (no técnico)
```

El primero es un fallo técnico (`failed`); el segundo es un rechazo editorial (`rejected`). El
contrato los mantiene en dimensiones distintas.

### Ejemplo C — "Publicado" no implica "indexado"

El artículo `horario-proteccion-menores-television-calificacion-por-edades` está publicado
(`blog_posts.status=publish`, `reviewState=approved`; `editorial_jobs.state=published` con
`publicUrl`), pero su inspección GSC (`editorial_gsc_inspections`) devuelve:

```text
coverageState="Google no reconoce esta URL"
```

Es decir: **publicado** y **aprobado**, pero **no indexado** (`no-reconocida`). La dimensión SEO es
independiente de la publicación.

### Ejemplo D — "Descubierto" no es "aprobado", y "duplicado" no es "sin evidencia"

- El job `2026-11-05T18:36:10.676Z-discovery` (`state=discovery`,
  `reason="8 propuestos, 1 en cola, 7 descartados"`) produce candidatos `discovered`, todavía sin
  aprobar.
- El ítem de cola `control-parental-netflix-prime-video` está
  `rejected` con `reason="duplicate: misma intención que protección-menores-control-parental-plataformas (0.47)"`,
  que se mapea a candidato `duplicate`, distinto de un rechazo por evidencia.

---

## 5. Acciones de recuperación

Catálogo cerrado (clave → etiqueta española) que el backend (T2) expone como acciones seguras:

`retry-source` (Reintentar recuperación de fuente), `replace-source` (Sustituir fuente rota),
`fix-slug` (Corregir slug), `inspect-duplicate` (Inspeccionar duplicado), `revise-brief`
(Revisar brief), `add-evidence` (Añadir evidencia), `targeted-rewrite` (Reescritura dirigida),
`retry-review` (Reintentar revisión), `request-manual-review` (Pedir revisión manual), `archive`
(Archivar).

Cada estado declara en `FLOW_STATE_GUIDE` cuáles **admite**; las no declaradas **no aplican**. Por
ejemplo: `invalid` admite `fix-slug` (y `archive`), no `add-evidence`; `duplicate` admite
`inspect-duplicate`, no `targeted-rewrite`; `blocked` admite la gama amplia de recuperación;
`published` solo `archive`.

---

## 6. Archivos

- `apps/backend/src/application/editorialflow/flow-states.ts` — enums, metadatos, `FLOW_STATE_GUIDE`.
- `apps/backend/src/application/editorialflow/flow-mapping.ts` — funciones puras y tablas de mapeo.
- `apps/backend/src/application/editorialflow/index.ts` — punto de entrada único.
- `apps/backend/src/application/editorialflow/flow-states.test.ts` y `flow-mapping.test.ts` — pruebas.

No se cambia el esquema de base de datos, no se toca el frontend, no se añaden dependencias y no se
reactiva la generación programada.
