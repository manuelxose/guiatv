# M14 — Informe final consolidado (2026-11-05)

Ámbito: continuación real de M14 sobre `manuelxose/guiatv`. Producción: `https://guiaprogramaciontv.com`. Release verificada: `20261105204014`, commit `f96a03f9`. La generación programada sigue en `enabled=false`; no se ha reactivado.

## 1. Panel de hitos

| Hito | Estado | Funcionalidad real | Evidencia principal | Bloqueo o deuda |
|---|---|---|---|---|
| M14-A — Gateway | **PASS** | DeepSeek server-side, plazo absoluto por llamada, tope de texto, gasto parcial, aborto | Revisión independiente Claude Sonnet 5.5 (`M14-A-INDEPENDENT-REVIEW.md`); 32 tests; producción `deepseek connected` | El ciclo de artículo no es un PASS de publicación; eso es M14-G |
| M14-B — Fiabilidad | **PARTIAL** | Ledger persistente, lease/fencing, etapas, plazos, cancelación, recuperación, publicación idempotente | `M14-B-DELIVERY.md` y `M14-B-VERIFICATION.md`; ledger en producción con jobs reales | Cancelación durante generación y muerte de worker no ejecutadas en producción; solo tests locales |
| M14-C — UX administración | **PARTIAL** | Pestaña «Trabajos» con filtros, paginación, selección, acciones masivas, línea de tiempo y detalle | Build SSR + 451/451 tests Angular; revisión `web-design-guidelines` documentada | Sin prueba E2E autenticada en navegador; filtros no sincronizados con la URL |
| M14-D — Gestión editorial | **PARTIAL** | Ciclo existente de temas, borradores, revisión, rechazo, archivo y recuperación; el ledger añade diagnóstico | Rutas y UI existentes + acciones de recuperación | No se añadió un flujo nuevo de autoría; el canary fue rechazado por calidad |
| M14-E — Search Console | **PARTIAL** | Diagnóstico de propiedad, motivos por URL, sincronización manual acotada | Producción 19:52 UTC: `skipped=14` con `fresh-inspected`, propiedad con datos y guías `zero-for-guides` | No hay prueba visual del panel; la inspección depende de la cuota de Google |
| M14-F — Centro SEO | **BLOCKED** | Solo diagnóstico e infraestructura de inspección; no hay cuadrícula completa de indexación ni auto-remediación | `M14-E-SEARCH-CONSOLE-DIAGNOSIS.md` | Falta el producto SEO completo; no se declara PASS |
| M14-G — Publicación autónoma | **BLOCKED** | Canary real ejecutado dos veces con el ledger; ninguna versión superó todas las puertas | `M14-G-CANARY-EVIDENCE.md`; jobs `18:52` y `19:41` | Artículo rechazado por longitud, una sola entidad editora y valor diferencial no probado |
| Seguridad de credenciales | **PARTIAL** | `EDITORIAL_POLICY_KEY` rotada y API recargada; DeepSeek sigue conectado | Env de producción con permisos 600; sin valores impresos | `DEEPSEEK_API_KEY` requiere rotación en la consola de DeepSeek; no hay API de gestión de claves |

## 2. Qué se ha implementado de verdad

### 2.1 Ledger duradero (M14-B)

- Colección `editorial_job_ledger` con `jobId`, artículo, tipo, estado, etapa, intento, worker, lease, generación, heartbeat, fechas, deadlines, error clasificado, uso, modelos, checkpoints y publicación.
- Todas las escrituras del worker son compare-and-set sobre `revision` y exigen el `token`/`generación` vigentes. Un worker con lease expirado no puede completar ni publicar.
- Etapas reales emitidas por el pipeline: lectura de fuentes, investigación, evidencias, redacción, SEO, elegibilidad y crítica; el runner añade selección de tema, descubrimiento, esquema, publicación y sitemap con su estado real.
- Plazo absoluto por llamada, por etapa y por artículo; aborto propagado al stream del proveedor.
- Cancelación reconciliada: `cancelling` hasta que el worker confirma o expira el lease; nunca se declara cancelada antes.
- Recuperación de leases expirados, reintento con tope, dead-letter, archivo y borrado de metadatos separado del artículo.
- Publicación con clave idempotente `${slug}:${draftHash}`.

### 2.2 Administración (M14-C)

- Nueva pestaña **Trabajos** en Operaciones IA: filtros, búsqueda, paginación, selección múltiple persistente, acciones masivas con resultados por elemento, detalle con etapas/checkpoints/lease/publicación y recuperación masiva de leases.
- Acciones destructivas con confirmación y motivo; borrado de metadatos solo para trabajos terminales archivados.
- Textos, estados y errores en español.

### 2.3 Search Console (M14-E)

- Causa real del `inspected=0, skipped=14`: ruta de frescura (inspección en 24 h o PASS en 7 días), no desindexación.
- La propiedad sí tiene datos (consulta directa a la API); las guías no tienen impresiones en la ventana. Es un **cero real**.
- Cada URL omitida guarda su motivo; el panel muestra la lista y un diagnóstico de propiedad que distingue «sin datos de guías» de «sin acceso».
- Endpoint `POST /search-console/run` con una ejecución a la vez.

### 2.4 Correcciones de calidad encontradas por el canary

1. JSON con prosa después del objeto: parser de valor balanceado.
2. Redactor sin JSON: reintento con el defecto en vez de perder el job.
3. Marcadores `1.`–`4.` de listas ordenadas: ya no se cuentan como datos sin cita ni rompen la comparación HTML/borrador.
4. Revisión independiente M14-A: plazo absoluto, gasto parcial, formas SEO, tope de texto, `unref`, tests.

## 3. Evidencia de producción

- Release `20261105204014`, commit `f96a03f9`, API y SSR activos, web pública 200.
- `GET /v2/admin/editorial/ledger` responde 200; el ledger contiene los jobs reales del canary con sus etapas, lease y coste.
- Canary final: `2026-11-05T19:41:23.137Z-permanencia-television-pago-derechos-espana`, 11 llamadas, 0,4869 USD estimados, `blocked` por:
  - `figure-in-words` («6 millones»).
  - `no-distinct-value` / `distinct-value-unsupported` (solo CNMC; valor no probado).
  - `invalid-length` (486 palabras frente a 600–900).
- La generación programada sigue en pausa (`generation.enabled=false`), la política activa y `publishedToday=0`.
- Search Console 19:52 UTC: `skipped=14` con motivo `fresh-inspected` por URL; diagnóstico `property.available=true`, `guides.state=zero-for-guides`.

## 4. Pruebas

- Backend: 960 tests, 908 PASS, 5 fallos ambientales de Windows ya documentados (GeoIP, permisos de clave privada, `EPERM` del runner), 47 skipped. Ningún fallo nuevo de ledger, pipeline, adaptadores ni Search Console.
- Frontend: 451/451 PASS.
- Tests nuevos: ledger (11), pipeline/adaptador (22+), cliente del runner (2), ciclo editorial (17 con ledger off), release packaging (1), evidencia/listas (25), componente de administración (3).
- Builds backend y frontend SSR correctos.

## 5. Defectos y riesgos abiertos

1. **`DEEPSEEK_API_KEY` sin rotar**: requiere crear una clave nueva y revocar la anterior en la consola de DeepSeek. Sin esa consola no se puede completar sin pedir credenciales en chat.
2. **Ningún artículo supera las puertas**: el canary demuestra el motor, no la publicación. La calidad del redactor (longitud, valor diferencial, una sola entidad) sigue siendo el bloqueo de M14-G.
3. **Cancelación y recuperación en producción** no se han ejecutado como escenario real; sí están cubiertas por tests.
4. **UI sin E2E autenticado**: build y tests de componente, pero no una sesión real de administrador en navegador.
5. **Sin Lighthouse/axe real** en esta sesión; la accesibilidad se revisó por código y guías, no con lector de pantalla.
6. **M14-F incompleto**: no hay cuadrícula persistente de todas las URLs públicas ni remediación automática; no se declara PASS.
7. **Trabajo concurrente ajeno**: el checkout contiene cambios de `sports-v2` que no forman parte de esta entrega y no se tocaron.

## 6. Siguiente paso

1. Rotar `DEEPSEEK_API_KEY` en la consola del proveedor y actualizar `/etc/guiatv/api.env` sin imprimir el valor.
2. Mejorar el brief del redactor para longitud, valor diferencial y uso de al menos dos entidades; repetir el canary.
3. Si el canary publica, verificar idempotencia, sitemap y una cancelación real; solo entonces evaluar la reactivación programada.
4. Completar M14-F con la cuadrícula de indexación y la remediación segura.
5. Ejecutar una revisión UX/SEO independiente con navegador real y Lighthouse.

**No se debe reactivar la generación programada con el estado actual.**
