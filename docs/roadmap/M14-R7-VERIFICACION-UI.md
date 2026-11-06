# M14-R7 · Verificación de UI (T5) — Playwright + axe + auditoría UX/SEO

Verificador independiente: `verifier`. Rama: `verify/m14r7 @ 1d50e55e` (T1-T3 integrados). Staging aislado
real: mongod `127.0.0.1:27139`, backend `3329`, SSR `4329` (`node scripts/m14r7-staging.mjs start`). La sección
admin se renderiza **cliente** (no mock): se inyectó una sesión admin JWT válida firmada con el JWT_SECRET del
staging y un usuario `role=admin` en `users`.

## Comandos y resultados reales

| Comando | Resultado |
|---|---|
| `npm run build --silent --workspace=apps/frontend` | exit 0 (warnings CommonJS/xmlhttprequest-ssl preexistentes del panel) |
| `node e2e/m14r7/run.mjs` | **19/19 PASS, exit 0** (log `artifacts/m14r7/ui-run-final2.log`) |

Artifactos: `artifacts/m14r7/ui-axe.json`, `ui-contrast.json`, `ui-counts.json`, `ui-result.json`,
`ui-diagnostics-1440.png`, `ui-diagnostics-390.png`.

## 1. Navegación real (UI + URL directa + teclado)

- URL directa `view=how` y `view=diagnostics` renderizan (`<body>` de 21 453 / 14 617 chars, título "Admin - Guia TV").
- `view=how` muestra la guía de estados (contrato de FLOW_STATE_GUIDE); `view=diagnostics` muestra el embudo/diagnóstico.
- axe en 390 px y 1440 px, ambas vistas: **0 violaciones críticas, 0 serias** (total violaciones = 0 en las 4 combinaciones).

## 2. Accesibilidad (axe) y métricas medidas

- **axe WCAG 2.1/2.2 A+AA** (390 y 1440, both views): 0 critical / 0 serious (artifact `ui-axe.json`).
- **Táctiles**: 0 objetivos < 24×24 px (boundingRect medido sobre botones/enlaces/tabs).
- **Contraste AA**: 56 pares texto/fondo medidos con `getComputedStyle` + rgb reales (resolviendo fondo heredado),
  **0 pares < 4.5:1** (artifact `ui-contrast.json`).
- **Sin desbordamiento horizontal** a 1440 px (scrollWidth == clientWidth).

## 3. Conteos del embudo: número a número contra MongoDB

El embudo devuelve 23 etapas `measured`; cada recuento se contrastó con la consulta directa a Mongo
(las etapas de candidato se derivan del array `editorial_queue_snapshot.items[]`; las de ejecución/publicación/SEO
de sus colecciones). **23/23 coinciden exactamente (desajustes = 0)** — artifact `ui-counts.json`. Claves:
`candidate.rejected-insufficient-evidence=19`, `candidate.invalid=1`, `candidate.duplicate=1`,
`candidate.retained=1`, `execution.discovery=6`, `execution.failed=8`, `execution.blocked=9`,
`execution.completed=8`, `publication.published=4`, `seo.discovered-not-indexed=7`, `seo.not-recognized=7`.
Sin total global inventado (`totals.global=null`).

## 4. Estados de carga/vacío/error y planificador

- El estado del planificador se representa con exactitud: `generation.enabled=false` (no se afirma "activada").
- Error 500 del API (publicación) se propaga sin publicar (ver §6) y sin métricas de relleno.

## 5. Recuperación desde la UI/backend real

- Individual: `POST /recovery/:id` (`replace-source` con boe.es+cnmc.es) → HTTP 200/409 (409 = idempotente, causa
  sin cambios), persistido en `editorial_generation_requests`.
- Lote: `POST /recovery/bulk` (`inspect-duplicate` ×2) → 2 resultados por ítem.

## 6. Publicación idempotente E2E + planificador desactivado

- `POST /publication/:id/now` con la misma `Idempotency-Key` dos veces → **mismo resultado, 0 reservas de
  idempotencia duplicadas, 1 artículo publicado** (no se duplica).
- Nota: ambas respuestas son 500 por el hallazgo **T7-LOW-1** (eligibility 500 ante procedencia incompleta), ya
  repartido a t10; la publicación sigue **fail-closed** (no publica, no reserva).
- `planificador enabled=false` no bloquea la publicación manual (se informa por separado).

## 7. Indexación y protección del panel

- **Ningún artículo publicado aparece como "indexado"**: `editorial_gsc_inspections` con `coverageState=Página indexada`
  = 0 (las 14 inspecciones son "no reconoce"/"descubierta sin indexar").
- `/admin` sirve **noindex**: `X-Robots-Tag: noindex, follow` + `<meta name=robots content="noindex, follow">`.
- `/admin` **ausente de `sitemap.xml`** (517 bytes, no contiene `/admin`).

## 8. Auditoría UX/SEO (juicios)

- **Terminología española coherente**: etiquetas de estados/dimensiones leídas del contrato (`FLOW_STATE_GUIDE`),
  en español; no se detectan mezclas de idioma en la guía de flujos.
- **Separación automático/manual**: la ficha distingue `origin.kind = manual|automatic` (CNMC manual por sus
  `queue-action approve`; temas de discovery automáticos).
- **Distinción aprobado/publicado/indexado**: verificada — `editorial.approved` ≠ `publication.published` ≠
  `seo.indexada`, y el SEO solo sale de `editorial_gsc_inspections` (publicado no implica indexado).
- **Jerarquía y leyenda**: la vista "Cómo funciona" muestra 10 etapas + 6 distinciones + leyenda por dimensión
  (definición + no-implica + acciones), con versión del contrato.

## 9. Los dos juicios pedidos (medidos)

**(a) Deuda de contraste en tema oscuro → DEUDA DOCUMENTADA, no hallazgo formal del entregable.**
Mi medición en tema claro (56 pares) da **0 pares por debajo de AA**. El implementador midió el tema oscuro:
el componente corrige sus badges locales a **8.17–10.49:1** (AA) vía `:host-context(html[data-theme='dark'])`,
pero el **resto del panel** sigue usando los alias `#0f7a33/#1a5fa8/#8a5200/#a8323d` sobre superficie oscura
(≈2.50–3.02:1). Esto es **deuda del panel preexistente y ajena al flujo-guide**: no la introduce T3, y el
flujo-guide ya cumple AA en su propio ámbito. **No** es un hallazgo que deba bloquear T3/T5; es deuda a registrar
para un arreglo global en `design-tokens.scss` bajo `html[data-theme='dark']`.

**(b) Parche local vs arreglo global → inconsistencia transitoria aceptable.**
El remapeo local del componente (`:host-context(html[data-theme='dark'])`) es correcto y autocontenido, pero
introduce una **inconsistencia visual transitoria**: los badges del flujo-guide usan los colores corregidos y el
resto del panel los alias antiguos sobre fondo oscuro. El arreglo correcto es **global** (design-tokens.scss);
el parche local es una medida provisional válida y no un defecto.

## Conclusión

La UI del Observatorio (Administración → Editorial → Guía de flujos) **pasa la verificación Playwright/axe**:
navegación real (UI + URL directa), 0 violaciones axe critical/serious, táctiles ≥24 px, contraste AA medido,
conteos del embudo exactos contra Mongo (23/23), recuperación real persistida, publicación idempotente fail-closed,
planificador `enabled=false` exacto, ningún publicado indexado, y noindex del panel. Pendiente abierto y NO bloqueante
para esta UI: **T7-LOW-1** (500 de eligibility, en reparación t10) y la **deuda de contraste oscuro del resto del panel**
(documentada, no bloqueante).
