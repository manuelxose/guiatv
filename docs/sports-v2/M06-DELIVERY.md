# M06 — Entrega final (M06 + M06-R1)

Este documento sustituye a la entrega anterior de M06, que no existía como fichero y cuyas cifras de
pruebas eran incorrectas. Resume el estado real tras la recuperación M06-R1.

| Campo | Valor |
|---|---|
| Rama de entrega | **`feat/m06-r1-recovery`** |
| HEAD | **`fe78c2f9`** (informe de remediación en `bedd6bd2`) |
| Base | `f020ea82` = HEAD de `feat/sports-v2-m06-integration` (commit revisado por el revisor independiente) |
| Commits | 13 sobre la base |
| Merge a `main` | **no realizado** |
| Despliegue | **no realizado** |
| Veredicto global | **PARTIAL / production readiness BLOCKED** — ver `M06-R1-REMEDIATION.md` §10 |

## Qué se entregó

1. **Centro de control de fútbol operativo contra la API real** (F01): un único cliente Angular tipado
   sobre `/v2/sports/football/admin/*`, las ocho secciones recableadas (Centro de control, Proveedores y
   APIs, Cobertura de datos, Partidos, Competiciones y entidades, Retransmisiones, Sincronización,
   Calidad y auditoría), estados loading/vacío/error/no autorizado, y sincronización que muestra el
   resultado **verdadero**.
2. **Una sola frontera de autorización admin**, en tiempo constante y fail-closed, compartida por las
   rutas legacy y las nuevas.
3. **Atribución ODbL 4.3** en todas las páginas públicas de Sports V2.
4. **Identidad de snapshot estable** anclada al id estable del proveedor, con reconciliación aditiva de
   los registros existentes y URLs públicas intactas.
5. **Ciclo de vida veraz de la sincronización** (`queued/running/succeeded/empty/skipped/throttled/failed`)
   con idempotencia atómica y mediciones reales.
6. **Consultas admin acotadas, validadas e indexadas** (F08).
7. **Estados de disponibilidad explícitos** en lugar de ceros fabricados (F09).
8. **Cuota durable que falla cerrada** y nunca se degrada en silencio (F07).
9. **Reproductor de pruebas reproducible** que funciona pese a la restricción de `spawn` del sandbox.

## Qué NO está entregado

- **La aceptación en navegador real no se ejecutó**: Karma y el build SSR no corren en este entorno,
  y sin build no hay Playwright. Por tanto "el panel funciona en un navegador real" **no está probado**,
  aunque los endpoints sí se verificaron en vivo y el cliente está tipado contra ellos.
- **No hay PR abierto todavía** (ver orden de dependencias en `M06-R1-REMEDIATION.md` §7).
- **No se ha tocado `main` ni producción.**

## Documentos de la entrega

| Documento | Contenido |
|---|---|
| `M06-R1-REMEDIATION.md` | Tabla F01–F10, pruebas reales, veredictos, rollback, PRs |
| `M06-R1-TEST-EVIDENCE.md` | Todas las cifras ejecutadas y las puertas no ejecutadas |
| `M06-R1-F01-ROOT-CAUSE.md` | Reproducción de la causa raíz de F01 con backend y Mongo reales |
| `M06-R1-F02-ODBL-ATTRIBUTION.md` | Evidencia autoritativa de licencia y texto implementado |
| `M06-R1-F01-F09-BACKEND.md` | Contrato de la API admin (estados de disponibilidad, paginación, operaciones) |
| `M06-R1-VERIFICATION-ENVIRONMENT.md` | Qué se pudo y qué no se pudo ejecutar, y por qué |
| `M06-R1-INDEPENDENT-REVIEW-R1.md` | Auditoría independiente del SHA final |
| `M06-INDEPENDENT-REVIEW.md` | Informe original (se conserva intacto como referencia) |
| `artifacts/m06-r1/evidence/` | Datos de máquina: baseline, suite, integración, cobertura, F04 |

## Estado de los veredictos

| Dimensión | Veredicto |
|---|---|
| Ingeniería | PARTIAL |
| Funcionalidad del panel | PARTIAL (no verificada en navegador) |
| Honestidad de datos | PASS (backend verificado) |
| Integridad de datos | PASS |
| Adquisición de proveedor | PASS |
| Ingesta real | PASS |
| Seguridad | PARTIAL (ENGINE-04: sandbox de escritura/borrado, no de lectura) |
| Elegibilidad legal | PASS con nota de derechos sobre Contenidos |
| Rendimiento | PARTIAL |
| Revisión independiente | ver informe independiente |
| Preparación de despliegue | BLOCKED |
| Verificación en producción | NO REALIZADA |

