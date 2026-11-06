# M14-R7 — Observatorio del flujo editorial: informe final

**Rama unificada:** `feat/m14r7-integration` · **HEAD verificado:** `3dedc0c9` · **Base:** candidato `fix/m14r6-p1-review` (`21dbfe42`)
**Worktree:** `C:\Users\Admin\Documents\workspace\guiatv-m14r7-int`
**Alcance:** 69 ficheros, +12.804 / −3 respecto al candidato

> **Aviso de veracidad.** Todas las cifras de este informe provienen de ejecuciones reales
> reproducidas por el capitán y por el verificador independiente en la rama unificada. Donde una
> cifra anterior resultó errónea, se indica explícitamente y se corrige.

---

## 0. Estado de entrega

| Dimensión | Resultado |
|---|---|
| Contratos de estado versionados (4 dimensiones + SEO) | Verificado |
| API de diagnóstico, reconciliación y recuperación | Verificado |
| Sección Administración → Editorial → Guía de flujos | Verificado |
| Validación de evidencia topic/claim-aware | Implementada y probada |
| Instrumentación del embudo sin eventos inventados | Verificado (23/23 conteos contra Mongo) |
| Tests backend | **1099 / 1051 pass / 0 fail / 48 skip** |
| Tests frontend (Angular) | **652 SUCCESS** |
| Escenarios adversariales | **20/20 PASS** |
| Playwright + axe | **19/19 PASS**, 0 violaciones critical/serious |
| Revisión independiente | Verificador independiente en todas las rondas |

**Despliegue:** NO realizado. No hay autorización de release. Producción intacta.
**Generación programada:** NO reactivada. El candidato la deja en `enabled=false` (fail-closed).

---

## 1. ¿Por qué no se publicaron los 22 temas?

**Ninguno de los 22 llegó al pipeline de generación.** No fallaron redactando ni publicando: fueron
descartados **antes** de entrar en ejecución. De ahí que no exista ningún artículo publicado de ese grupo.

Desglose real del `editorial_queue_snapshot` (21 `rejected` + 1 `held`):

| Motivo | Temas | Dimensión |
|---|---:|---|
| `insufficient-evidence:` menos de dos entidades editoras verificadas | **19** | candidato |
| `invalid-candidate: slug` | **1** | candidato |
| `duplicate:` misma intención (0.47) | **1** | candidato |
| `held` — «agotados los ciclos de revisión (5)» | **1** | ejecución/editorial |

El único tema que **sí** llegó al pipeline es `cnmc-derechos-audiovisuales-accesibilidad-plataformas`.
Se aprobó a mano **cuatro veces** (5-nov, 13:44 / 14:29 / 15:01 / 15:28) y **ninguna** terminó en
publicación: su último job acabó `blocked` por «agotados los ciclos de revisión (5)».

### Clasificación de los 19 fallos de evidencia

Medido tema a tema (`artifacts/m14r7/evidence-classification.json`):

| Clase | Temas | Naturaleza |
|---|---:|---|
| URL rota (404) | 9 | **Corregible** |
| Documento renderizado por JavaScript | 4 | **Corregible** |
| Extracción de texto pobre | 2 | **Corregible** |
| Problema HTTP de recuperación | 2 | **Corregible** |
| Relevancia (términos del tema) | 1 | Corregible (affinado) |
| Falta real de independencia | 1 | Decisión editorial |

**15 de 19 (79 %) no son falta real de evidencia: son fallos técnicos de recuperación.**
La causa raíz está en `EditorialTopicQueue.checkSeeds`: exige `status===200`, `text.length>=800`
y coincidencia de términos **sobre el HTML crudo**. Una SPA devuelve 200 con shell vacío → «página
sin texto legible». Un 404 en una URL que el modelo recordó mal → descarte definitivo pese a que las
**otras 2 fuentes semilla del mismo tema eran válidas**.

**Consecuencia del diseño:** se descarta el tema entero antes de intentar recuperarlo. Eso es
política editorial (no se publica sin dos editores), no un fallo de ejecución — pero con una
implementación que confunde «no pude leer esta URL» con «no hay evidencia».

---

## 2. ¿Qué pasó con los cinco registros antiguos?

Pertenecen a **otra identidad**: no son los 22 temas y no salen del snapshot de cola. Viven en
`blog_posts` con `origin: ai-assisted`. Se verificaron 4 y el quinto no existe.

| Slug | Colección | Estatus | URL pública | Sitemap | Google |
|---|---|---|---|---|---|
| `limite-anuncios-television-minutos-por-hora-ley` | `blog_posts` | `publish` / `approved` | 200 | sí | **Descubierta, sin indexar** |
| `horario-proteccion-menores-…-edades` | `blog_posts` | `publish` / `approved` | 200 | sí | **No reconoce la URL** |
| `subtitulos-audiodescripcion-…-obligaciones` | `blog_posts` | `publish` / `approved` | 200 | sí | **No reconoce la URL** |
| `descargar-series-netflix-grabar-tele-copia-privada` | `blog_posts` | `publish` / `approved` | 200 | sí | **No reconoce la URL** |
| `es-ilegal-ver-futbol-iptv-pirata` | — | **no existe en `blog_posts`** | 404 `noindex` | no | — |

**Sí están publicados.** La afirmación «aprobados sin publicación» es **falsa** para los cuatro
existentes: responden 200 con canonical correcto y están en `sitemap-blog.xml`.

Sus jobs de mantenimiento figuran `maintenance-unverifiable` con motivo literal
«sin el fichero de ejecución de la versión publicada: no se puede re-verificar». Determinado con
evidencia: **(a) falta de fichero de procedencia**, uniforme en los 4; **solo afecta a la capacidad
de re-verificar, no a la validez del contenido** — los cuatro fueron `maintenance-verified` el mismo
día de publicar (22/25/33/23 afirmaciones verificadas). Es un problema de **trazabilidad**.

**Ninguno de los cuatro está indexado por Google.** Estar en el sitemap no es estar indexado.

---

## 3. ¿De qué dependen los fallos: evidencia, política, planificación o ejecución?

| Capa | Fallos | Detalle |
|---|---:|---|
| **Evidencia / recuperación técnica** | 15 de 19 | URL rota, SPA sin texto, HTTP, extracción. Recuperables. |
| **Política editorial** | 4 | 1 slug inválido, 1 duplicado real, 1 independencia genuina, 1 falta real de evidencia |
| **Ejecución (pipeline)** | 1 | CNMC: 5 ciclos de revisión agotados → `blocked` |
| **Planificación** | 0 | Ver §5: producción tenía `enabled=true`; los ciclos devolvían `no-eligible-topics` porque **no había temas elegibles** |

El planificador **no** es la causa de los 22. Los ciclos corrían y no encontraban nada que ejecutar
porque el embudo se vaciaba en la puerta de entrada.

---

## 4. ¿Qué es recuperable automáticamente ahora?

Implementado y probado (`EditorialEvidenceRecovery`, 6 pruebas + 20 escenarios):

- **Reintentar recuperación de fuente** · **Sustituir fuente rota** · **Corregir slug**
- **Inspeccionar duplicado** · **Revisar brief** · **Añadir evidencia**
- **Reescritura dirigida** · **Reintentar revisión** · **Pedir revisión manual** · **Archivar**

Salvaguardas verificadas:

- **No repite la misma condición fallida**: si las fuentes y el motivo no cambiaron, responde 409 y
  **no relanza** la petición idéntica.
- Acción no aplicable → **409 con motivo en español**.
- Individual y **en lote**, con resultado por ítem sin abortar el resto.
- Reutiliza el **ledger durable** y la auditoría existentes.

**Lo que NO es automático:** 15 de los 19 exigen una acción humana para elegir/proponer la fuente
alternativa. El sistema clasifica el fallo y propone la acción, pero no inventa corroboración.

---

## 5. ¿Qué intervención hace falta para publicar un artículo elegible?

Para un artículo **ya elegible** (aprobado, con procedencia completa y sin bloqueos):
**ninguna**. Publicar ahora reutiliza el `BlogController.approveByPolicy` real — gates de calidad,
límite diario, parada de emergencia, invalidación de caché — y es **idempotente** (misma clave dos
veces = un artículo, un evento; verificado E2E).

Para el estado actual de producción, sí hace falta intervención:

1. **Reelegir fuentes** de los 15 temas con fallo técnico (o corregir la validación para distinguir
   «no pude leer» de «no hay evidencia»).
2. **Decisión editorial** en el tema con independencia genuina.
3. **Decidir el CNMC**: 5 ciclos agotados con 4 aprobaciones manuales.

**Planificador desactivado ≠ publicación manual bloqueada.** El candidato deja
`generation.enabled=false`; la publicación manual sigue disponible de forma independiente y así se
representa en la UI (verificado).

---

## 6. ¿Qué puertas de release quedan antes de reanudar la publicación automática?

| # | Puerta | Estado |
|---|---|---|
| 1 | Autorización de release | **PENDIENTE** — no solicitada, no concedida |
| 2 | Despliegue del candidato | **NO REALIZADO** — producción sigue en `20261105204014` |
| 3 | Reobtener `enabled=true` con decisión explícita | **PENDIENTE** — el candidato es fail-closed |
| 4 | Resolver la validación de evidencia (§1) | **PENDIENTE** — decisión de alcance |
| 5 | Reconciliar 29 entidades en producción | **PENDIENTE** — 2 huérfanos |
| 6 | Configurar el modelo de coste/credenciales | **PENDIENTE** — hubo `QUOTA` y clave inválida |
| 7 | El generador de jobs de mantenimiento del build desplegado | **PENDIENTE** — no está en el candidato |

**Hallazgo abierto:** la cadena «sin el fichero de ejecución de la versión publicada» la emite el
**build desplegado** y no existe en el código del candidato. El generador de jobs de mantenimiento
**no está íntegro en el repositorio actual**. Es una brecha de trazabilidad preexistente, no una
regresión de este milestone.

---

## 7. Lo que se ha corregido durante el milestone (defectos reales)

| Defecto | Severidad | Corrección |
|---|---|---|
| `maintenance-unverifiable` → ejecución `blocked` **y** publicación `published` a la vez | Alta | `jobKind`; un job de mantenimiento no publica (`sin-datos`) |
| `eligibility` devolvía **500** en vez de bloqueos nombrados | Media | `provenanceBlockers` + prueba de regresión |
| **`publish/now` colgaba indefinidamente** (el wrapper solo resolvía en `next(error)`) | **Alta** | `invokeHandler` resuelve también al responder |
| `eligibility` aplanaba el motivo a texto genérico | Media | Subcódigos `editorial-bundle` / `editorial-draft` |
| 2 tests de Windows insatisfacibles en origen | Media | NTFS no tiene bits POSIX; handles del hijo asíncronos |

---

## 8. Deuda y limitaciones declaradas (no bloquean)

- **Contraste en tema oscuro:** el componente nuevo cumple AA (8,17–10,49:1). **El resto del panel
  mide 2,50–3,02:1** sobre superficie oscura. Arreglo global pendiente en `design-tokens.scss`.
- **2 errores de lint de frontend preexistentes** en `admin-seo-section` (15:3, 124:5). Idénticos en
  la base (`745 problems/2 errors` → `752/2 errors`, mismas líneas): **0 errores nuevos**.
  Deliberadamente **no** corregidos para no lavar un fichero fuera de alcance.
- **G1:** la ficha del CNMC muestra `retries.attempts` del ledger (1) y no reconstruye las 7
  ejecuciones reales de `editorial_jobs`; documentado en la reconciliación.
- **Ledger parcial:** 6 documentos de ledger frente a 35 en `editorial_jobs`. Indicador honesto de
  datos parciales, no se rellena.
- **CLS ~2,0** en `/` y `/guias`: **preexistente**, fuera de alcance.

---

## 9. Correcciones de método (errores propios, corregidos)

1. **Recuento GSC erróneo.** Informé «2 no reconoce + 1 descubierta». El real es **7 + 7, 0 indexadas**.
   El verificador lo detectó; lo reconté sobre el volcado y lo corregí. La tesis sitemap≠indexado se
   refuerza: 0 de 14 inspeccionadas están indexadas.
2. **Atribución errónea de los 2 fallos de Windows.** Los traté como ruido de entorno. Al reproducirlos
   resultó que **ambos tests eran defectuosos de verdad** y se arreglaron en origen.
3. **Compilación sin `tsc-alias`.** Usé `tsc` solo, generando un falso `Cannot find module '@/…'`.
4. **Reasignación equivocada de t7** al implementador. Revertida en el acto.
5. **Ficheros escritos en el checkout principal** por un miembro. Contenidos y recolocados.

---

## 10. Evidencia

`artifacts/m14r7/`: `ui-counts.json` (23/23 embudo vs Mongo), `ui-axe.json`, `ui-contrast.json`,
`ui-result.json`, capturas 390/1440, `classification.json`, `evidence-classification.json`,
`reconciliation.md`, `backend-verification.md`, logs de cada corrida.
Informes: `docs/roadmap/M14-R7-RECONCILIACION.md`, `docs/roadmap/M14-R7-VERIFICACION-UI.md`,
`docs/engineering/M14-R7-CONTRATOS-FLUJO.md`.

---

## 11. Veredicto

**PARTIAL.**

La ingeniería del observatorio está **PASS**: contratos, API, UI, recuperación, instrumentación y
verificación independiente, con 0 regresiones y todos los gates reproducidos por dos manos.

La entrega **no es PASS global** porque el brief lo prohíbe sin responder con evidencia, y porque
quedan abiertas puertas que no dependen de este código: autorización de release, despliegue, la
validación de evidencia que causa 15 de los 19 descartes, y un generador de jobs de mantenimiento
ausente del repositorio.
