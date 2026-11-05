# M14 — Evidencia de ejecución de skills UX y SEO

Fecha: 2026-11-05. Ámbito: administración de GuíaTV, diagnóstico de Search Console y revisión de la interfaz del registro de trabajos.

Este documento distingue entre una skill instalada y una skill **usada**. Cada fila registra la tarea, el agente, la skill cargada, la guía aplicada, los archivos o URLs inspeccionados, el cambio y la verificación. Una carpeta en disco no cuenta como evidencia.

## 1. Fuentes e instalación

Antes de instalar nada se inspeccionaron `~/.agents/skills`, `~/.dsh/skills` y `.agents/skills` / `.dsh/skills` del repositorio. Los dos últimos no existen en este proyecto. Ya estaban instaladas `ponytail` y `ui-ux-pro-max`.

| Fuente | Revisión fijada | Destino | Contenido revisado |
|---|---|---|---|
| `vercel-labs/agent-skills` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | `~/.agents/skills/web-design-guidelines` | `SKILL.md`; sin scripts |
| `addyosmani/web-quality-skills` | `afa8da942115f2961fdbfa80807ea0b232ff6c00` | `~/.agents/skills/{web-quality-audit,accessibility,performance,core-web-vitals,seo}` | `SKILL.md`, `references/`; `scripts/analyze.sh` no ejecutado |
| `anonymousAAK/seo-skills` | `8673ec753e95a778e815a2b132bc6dc7efa30bf9` | `~/.agents/skills/seo-skills` | bundle completo: raíz, 44 módulos, `references/`, `protocols/`, `templates/`, `scripts/` |

- Los módulos SEO **no** se instalaron como skills de primer nivel: se conserva el bundle y su router. El `name` de la raíz se cambió de `gsearch-agent-pack` a `seo-skills` para que el nombre visible coincida con el solicitado; es el único cambio de contenido y está anotado en `.skill-lock.json`.
- Los scripts Python del bundle se leyeron: `route.py` es local; `check_sitemap.py` e `inspect_html.py` no usan red; `refresh_sources.py` es opt-in y limita hosts oficiales. No se ejecutó ningún instalador de terceros.
- `scripts/validate_bundle.py` del upstream termina con `passed:false` ya en un clon limpio: `README.md` no coincide con `CHECKSUMS.sha256` y el nombre de carpeta no coincide con el `name` de la raíz. Se registra como limitación upstream, no como fallo de la instalación.
- Registro: `~/.agents/.skill-lock.json` contiene las siete entradas nuevas con repositorio, commit, ruta y hash de árbol. El catálogo del arnés se recargó y muestra `web-design-guidelines`, `web-quality-audit`, `accessibility`, `performance`, `core-web-vitals`, `seo` y `seo-skills`.

## 2. Invocaciones reales

| # | Tarea | Agente | Skill cargada | Guía aplicada | Archivos / URLs | Cambio | Verificación | Limitación |
|---|---|---|---|---|---|---|---|---|
| 1 | Diseñar el registro de trabajos | Capitán (DeepSeek) | `ui-ux-pro-max` | Feedback de carga; alternativa de teclado a gestos; acciones destructivas con confirmación | Componente ledger nuevo | Tabla con estados, lease, etapa, filtros, selección múltiple, acciones masivas | `search.py "operations dashboard job monitoring" --domain ux` devolvió 2 reglas (loading states, dragging movements); `--stack angular` no tuvo coincidencia con «table selection» y se reintentó con «select» (1 resultado no aplicable) | La skill no aportó un patrón específico para tablas de trabajos; se usó la guía general |
| 2 | Revisar la interfaz nueva | Capitán (DeepSeek) | `web-design-guidelines` | Etiquetas, foco visible, `aria-live`, confirmación destructiva, `overscroll-behavior`, `touch-action`, cifras tabulares, elipsis tipográfica, estados vacíos | `admin-job-ledger.component.html/.scss`, `admin-editorial-section.component.html` | Foco visible, roles `alert/status`, Escape cierra capas, `overscroll-behavior: contain`, `touch-action`, `tabular-nums`, `text-wrap: balance` | `web_fetch` de `vercel-labs/web-interface-guidelines/main/command.md` (HTTP 200); revisión aplicada a 3 archivos | Los filtros no se sincronizan con la URL; el diálogo no atrapa el foco; no se ejecutó un lector de pantalla |
| 3 | Diagnosticar Search Console | Capitán (DeepSeek) | `seo-skills` | Confirmar propiedad y permisos; separar «sin datos» de «sin acceso»; no inventar resultados | `SearchConsoleMonitor.ts`, cuenta de servicio, API de Search Console | Diagnóstico de propiedad sin filtro, motivos por URL y estado «cero real» en la UI | Router → `gsearch-search-console`; API real: propiedad con filas, `/guias/` con 0 filas | No se probaron acciones manuales de Search Console; no se promete indexación |
| 4 | Revisar accesibilidad | Capitán (DeepSeek) | `accessibility` | Objetivos de 24×24/44×44, Escape, etiquetas, foco, regiones live | Componente ledger | Escape cierra el diálogo/detalle; botones con nombre; `aria-label` en checkboxes | Revisión manual de plantilla; build SSR correcto | Sin auditoría Lighthouse ni lector de pantalla en esta sesión |
| 5 | Base de calidad web | Capitán (DeepSeek) | `web-quality-audit` | Separar medición de hipótesis; no usar una puntuación agregada como prueba | Rutas públicas y build SSR | Pendiente de auditoría Lighthouse real | No se ejecutó Lighthouse: no hay Chrome DevTools MCP en esta sesión | Se declara como limitación, no como PASS |

## 3. Evidencia de Search Console (2026-11-05)

Consulta de solo lectura con la cuenta de servicio de producción (`sc-domain:guiaprogramaciontv.com`, `siteOwner`):

- `by-date`: 5 filas de muestra, `metadata.firstIncompleteDate=2026-11-04`.
- `by-page`: filas reales (p. ej. `/programas/triana-el-faro-que-no-cesa`, 9 clics, 101 impresiones).
- `by-query`: filas reales (p. ej. «barbarian donde ver», 2 clics, 66 impresiones).
- Filtro `page contains /guias/`: 0 filas.

Conclusión: la propiedad tiene datos y los permisos son correctos; las guías no tienen impresiones en la ventana. El resultado `inspected=0, skipped=14` observado antes era la ruta de frescura (URLs inspeccionadas en las últimas 24 h o indexadas en 7 días), no una desindexación. La ejecución posterior inspeccionó 14 y clasificó 7 como `not-discovered` y 7 como `discovered-not-indexed`.

## 4. Archivos y URLs inspeccionados

- `apps/frontend/src/app/pages/admin/sections/editorial/admin-editorial-section.component.{ts,html,scss}`
- `apps/frontend/src/app/pages/admin/sections/editorial/job-ledger/*`
- `apps/backend/src/application/services/SearchConsoleMonitor.ts`
- `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
- API de producción `searchconsole.googleapis.com` (solo lectura, sin imprimir credenciales)

## 5. Limitaciones abiertas

1. La revisión visual no sustituye una auditoría Lighthouse con navegador real ni pruebas con lector de pantalla.
2. Los filtros del registro no se reflejan en la URL; es una mejora pendiente, no un fallo de datos.
3. El diálogo de confirmación y el panel de detalle no implementan un focus trap completo; Escape y los roles ARIA sí están.
4. El bundle SEO upstream tiene un checksum de `README.md` desactualizado; no se modificó para no falsear la integridad.
