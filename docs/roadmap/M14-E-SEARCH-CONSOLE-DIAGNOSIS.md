# M14-E — Diagnóstico de Search Console

Estado: **PARTIAL**. El diagnóstico de producción está cerrado y el código corrige la falta de motivos y de contexto; falta desplegar y verificar la ejecución en producción.

Fecha: 2026-11-05.

## 1. Configuración real de producción

- Propiedad: `sc-domain:guiaprogramaciontv.com` (`GSC_SITE_URL`).
- Cuenta de servicio: `GOOGLE_APPLICATION_CREDENTIALS=/etc/guiatv/gsc-service-account.json`.
- `GSC_MONITOR_ENABLED=true`, `GSC_AUTO_SUBMIT_ENABLED=true`.
- Sitemap declarado: `https://guiaprogramaciontv.com/sitemap.xml`.
- Permiso comprobado en la lista de propiedades: `siteOwner`.

## 2. Resultado reportado y resultado actual

El informe previo (`inspected=0`, `skipped=14`, `pageRows=0`, `queryRows=0`) no era una prueba de desindexación. La ejecución de producción de las 17:22 UTC inspeccionó 14 URLs y obtuvo:

- `inspected=14`, `skipped=0`, `inspectionErrors=0`.
- `pageRows=0`, `queryRows=0`, `baseline.days=0`.
- Clasificación: 7 `not-discovered`, 7 `discovered-not-indexed`.

## 3. Consulta directa a la API (solo lectura)

Con la propia cuenta de servicio y sin imprimir el token:

| Consulta | Ventana | Resultado |
|---|---|---|
| Sin filtro, dimensión `date` | 2026-08-01 → 2026-11-05 | 5 filas de muestra; `firstIncompleteDate=2026-11-04` |
| Sin filtro, dimensión `page` | 2026-08-01 → 2026-11-05 | Filas reales, p. ej. `/programas/triana-el-faro-que-no-cesa` (9 clics, 101 impresiones) |
| Sin filtro, dimensión `query` | 2026-08-01 → 2026-11-05 | Filas reales, p. ej. «barbarian donde ver» (2 clics, 66 impresiones) |
| Filtro `page contains /guias/` | 2026-08-01 → 2026-11-05 | **0 filas** |

Conclusión: la propiedad existe, el permiso es correcto y hay datos de rendimiento. Las páginas `/guias/` no tienen impresiones en la ventana. El cero de las guías es un **cero real**, no un fallo de autenticación, de propiedad ni de paginación.

## 4. Por qué `inspected=0, skipped=14`

El monitor omite una URL cuando ya tiene una inspección con `error:null` en las últimas 24 h, o un `PASS` en los últimos 7 días. Con 14 guías y ejecuciones frecuentes, la ruta de frescura puede omitir las 14. El contador `skipped` no decía cuál de las dos condiciones se aplicó ni a qué URL, así que el resultado era indistinguible de un fallo.

## 5. Cambios implementados

1. `SearchConsoleMonitor` guarda `skipReasons`: una entrada por URL con `fresh-inspected`, `fresh-indexed` o `inspection-limit`.
2. Diagnóstico de propiedad sin filtro (`date`, `page`, `query`) en cada ejecución. Distingue propiedad sin datos, propiedad con datos y guías sin impresiones.
3. Estado `zero-for-guides`: la UI explica que el cero de las guías es real y no una desindexación.
4. Los errores del diagnóstico se guardan como error, nunca como cero.
5. Endpoint `POST /v2/admin/editorial/search-console/run` (rol admin, una ejecución a la vez) para lanzar una sincronización desde la administración.
6. Panel de Search Console: última sincronización, inspeccionadas/omitidas, filas, diagnóstico y lista de URLs omitidas con su motivo.

## 6. Verificación

- `npm run build:backend` correcto.
- Pruebas focalizadas de pipeline y ledger correctas; la suite completa se ejecuta en la entrega.
- Consulta directa a Google correcta (evidencia de la sección 3).
- **Producción (2026-11-05 19:52 UTC)**: sincronización lanzada desde el nuevo endpoint; resultado `ok`, `inspected=0`, `skipped=14`, y por primera vez cada URL omitida con su motivo (`fresh-inspected`). Diagnóstico: propiedad con filas (`date/page/query = 5`), guías `zero-for-guides`. El panel ya distingue «sin datos de guías» de «sin acceso».

## 7. Limitaciones

- No se ha probado la nueva UI con navegador real (build y tests Angular sí).
- La inspección de URLs depende de la cuota de Google; el límite por ejecución sigue siendo 500.
- Google no expone una API soportada para forzar indexación de páginas editoriales; el sistema solo inspecciona y muestra evidencia.
