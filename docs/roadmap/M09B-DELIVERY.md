# M09-B: inventario de URL de programas, política canonical y recuperación de la indexación

Fecha: 2026-10-28. Rama `m09b/canonical-url-consolidation`, PR #117. Evidencia en `artifacts/m09b/` (no versionado).

## 1. Resumen ejecutivo

| Veredicto | Estado | Base |
|---|---|---|
| ENGINEERING PASS | **PASS** | Política implementada, probada y revisada (§6, §11, §12) |
| URL INVENTORY PASS | **PASS** | 680 URL del sitemap clasificadas con datos de producción y la función real del backend (§5) |
| CANONICAL POLICY PASS | **PASS** | Política por tipo de entidad, aplicada igual en SSR, sitemap, enlaces y JSON-LD (§6) |
| DATA IDENTITY PASS | **PASS** | Solo se consolida con la identidad verificada por M10. Nunca se consolida por título, y una colisión de slug no puede apuntar a otro programa (§7) |
| SITEMAP QUALITY PASS | **PASS** | En producción: sitemap 803 → 167; las 44 `/programas` que quedan son `standalone` coherentes (§15) |
| ROLLOUT SAFETY PASS | **PASS** | Cohortes 10 % → 50 % → `on`, verificadas, con 0 problemas; rollback documentado (§10, §15) |
| PRODUCTION DEPLOYMENT PASS | **PASS** | `20261028185153` @ `30d3e75`, CI de `main` en verde, política `on` (§15) |
| GOOGLE INDEXING | **NOT OBSERVED** (para lo cambiado) | Los efectos se miden a 7, 14 y 28 días (§16) |
| ORGANIC VISIBILITY RECOVERY | **NOT OBSERVED** | |
| M09 | **PARTIAL** | §18 |
| M12 | **NO-GO** | §19 |

**Conclusiones principales:**

1. **El dominio no está desindexado.** «0 de 840 indexadas» procede del campo `contents[].indexed` de la API de sitemaps, que devuelve 0 en todos los sitemaps. Sin embargo, la inspección de URL da «Enviada e indexada» en `/deportes/futbol`, `/plataformas`, `/developers`, `/sobre-nosotros`, `/peliculas/disforia` y `/peliculas/cenicienta`. Por tanto, la afirmación de M11-G (§4) de que «todo el dominio está fuera del índice» es incorrecta y aquí se corrige.
2. **La portada está indexada como `http://guiaprogramaciontv.com/`.** Google eligió esa variante como canonical (inspección: «Enviada e indexada», rastreo del 20-oct). La variante `https://` aparece como «Rastreada: actualmente sin indexar». En agosto las impresiones eran de `https://` (555); en octubre son de `http://` (47 de 53).
3. **El «colapso» es pequeño en términos absolutos.** De junio a agosto hubo 1 clic orgánico. En agosto, 555 de las 564 impresiones fueron de la portada, en posición media 58,9 y para consultas genéricas («cartelera tv»). El 1-sep esas impresiones pasaron a ~0.
4. **`/programas` nunca ha tenido visibilidad:** 0 impresiones entre junio y octubre.

La causa de la caída del 1-sep **no está demostrada**. La matriz de hipótesis está en §3.

## 2. Línea base verificada

- **Repositorio:**
  - `main` en `201c117`;
  - la rama M09-B parte de ahí sin trabajo previo.
- **Producción:**
  - release `20261028155613` @ `ad46e73`;
  - 0 reinicios;
  - sin variables `CONTENT_ENTITY_*`, así que las fichas se sirven en modo legacy.
- **Search Console:**
  - propiedad `sc-domain`, consultada con la cuenta de servicio en solo lectura;
  - nunca se usó la Indexing API.
- **Sitemap en vivo** (`artifacts/m09b/sitemap-before.json`): 803 URL.

  | Familia | URL |
  |---|---|
  | `/programas/*` | 680 (84,7 %) |
  | `/canales/*` | 82 |
  | estáticas | 23 |
  | `/guias/*` | 18 |
  | `/peliculas` y `/series` | 0 |

- **Logs:**
  - nginx registra IP de Cloudflare (no hay `real_ip`), así que Googlebot no se puede verificar por IP;
  - abundan escáneres que se identifican como «Googlebot»;
  - los logs solo cubren desde el 14-oct y el journal desde el 20-sep.

## 3. Investigación de la caída

**Serie de impresiones (todas las páginas):**

| Mes | Impresiones | Clics |
|---|---|---|
| Junio | 113 | 0 |
| Julio | 348 | 1 |
| Agosto | 564 | 0 |
| Septiembre | 16 | 0 |
| Octubre (hasta el 28) | 72 | 6 |

- **Últimos días de agosto:** 20–61 impresiones al día; el 31-ago, 20.
- **Desde el 1-sep:** 0 al día; el 1-sep todas las familias caen a la vez.

| # | Hipótesis | A favor | En contra | Confianza | Familias | Verificación propuesta | Responsable |
|---|---|---|---|---|---|---|---|
| H1 | Valoración baja del dominio por un inventario fino y efímero (`/programas` = 85 % del sitemap) | `/programas`: 0 impresiones en 5 meses. 665 de 680 no se alcanzan desde la portada. Gemelos duplicados indexables. Google rastreó ~480 `/programas` el 19–20 oct (solo UA) y paró | El sitemap ya listaba `/programas` antes del 31-ago (builder anterior, `1cf92ce^`). Una caída de un día para otro no encaja con una revaloración gradual | Media como lastre; baja como causa del 1-sep | todas | Medir portada y hubs a 28 días tras la activación | M09-B (este hito) |
| H2 | Google indexó la portada como `http://` y la `https://` quedó como no indexada | Inspección: `http://` = indexada con canonical propia; `https://` = rastreada sin indexar. Atribución de impresiones de agosto (https) frente a octubre (http) | En vivo, `http→https` es un 301 de un salto y la canonical declarada es `https` | Media en que el estado es ese; baja sobre su causa | portada | Propietario: en la interfaz de GSC, una sola «Solicitar indexación» de `https://guiaprogramaciontv.com/` | Propietario |
| H3 | Un cambio del sitio el 30–31 ago (robots SSR, sitemap con el modelo TV, afiliación) | Coincidencia de fechas: `1cf92ce` (31-ago 18:16) toca la inyección de robots y el builder del sitemap | El código limita el `noindex` a cuenta/admin/`/contenido` y ≥400. Las señales actuales son correctas. No se sabe qué se desplegó ese día (despliegues manuales antes del 2-sep) | Baja | todas | No reproducible con lo disponible | — |
| H4 | Actualización algorítmica de Google en torno al 1-sep | Patrón de caída abrupta en todo el sitio | Sin datos verificables en este entorno | Sin verificar | todas | Contrastar con el historial público de actualizaciones | Propietario |
| H5 | Inestabilidad del servidor ante Googlebot | `/canales` pesa 5,7 MB y tarda 2,7 s; 503 en ráfagas (M09, M11-G) | No hay logs de septiembre | Baja | hubs | Monitorizar 5xx (M10) | M10 |
| H6 | Certificado TLS, migración de servidor o DNS | — | Descartada: certificados continuos (cert4 del 5-ago al 3-nov) y el mismo VPS desde dic-2025 | **Descartada** | — | — | — |
| H7 | Acción manual o problema de seguridad | — | El propietario confirma que no hay ninguna. **Esto no prueba que la calidad sea buena** | Descartada como causa | — | — | — |
| H8 | `robots.txt` (gestionado por Cloudflare) | — | El actual permite a Googlebot; las reglas de IA no le afectan. No hay historial | Baja | todas | — | — |

## 4. Causas confirmadas frente a hipótesis

**Confirmado:**
- F1: la métrica de sitemap «0 indexadas» no es fiable (§1.1).
- F2: la portada está indexada como `http://` (§1.2).
- F3: `/programas` tiene 0 impresiones desde junio.
- F4: el mismo trabajo tiene dos URL indexables con canonical propia, `/programas/x` y `/peliculas|/series/x`; hay 585 gemelos probados por TMDB.
- F5: 117 slugs del sitemap pierden las tildes.
- F6: las páginas de obra cambian de `index` a `noindex` según haya emisión. Ejemplo: `/peliculas/cenicienta` está indexada en Google y hoy sirve `noindex`.

**Hipótesis no demostradas:** H1–H5 y H8. No se afirma que reducir el inventario vaya a recuperar el posicionamiento.

## 5. Inventario de URL (producción, 2026-10-28 16:22 UTC)

`scripts/programme-page-quality.mjs`: solo GET públicos, ritmo de ~230/min. Resultado en `artifacts/m09b/programme-inventory-before.json`, con una fila por URL: estado, robots, canonical, TMDB, `workPath`, emisiones, sinopsis, duplicados, profundidad y enlaces.

La clasificación sale de la función real del backend aplicada a cada fila (`artifacts/m09b/dry-run.cjs` → `dry-run.json`):

| Clase de la tarea | Disposición | URL | Señal con la política aplicada |
|---|---|---|---|
| A: película canónica | `work` → `/peliculas` | 230 | canonical a la obra, sigue `index` |
| B: serie canónica | `work` → `/series` | 43 | canonical a la obra, sigue `index` |
| C: programa propio | `standalone` | 38 | canonical propia, `index`, en el sitemap |
| D: duplicado probable sin verificar | `ambiguous` | 303 | sin cambios (canonical propia, `index`), fuera del sitemap |
| E: EPG fina | `thin` | 10 | `noindex, follow` |
| F: identidad incorrecta o ambigua | dentro de `ambiguous` | — | aislada: sin destino inventado |
| G: episodio | `episode` | 56 | `noindex, follow` |

**Otras señales de la propiedad del URL:**
- 585 gemelos indexables probados por TMDB; 274 de ellos además verificados por la puerta M10 (`workPath`);
- 48 programas sin TMDB;
- 45 obras TMDB sin gemelo;
- 245 URL sin emisión pendiente a la hora del recorrido;
- 97 con descripción duplicada;
- 665 sin alcanzar desde la portada en el grafo M10.

## 6. Política canonical

**Contexto:** `ProgrammeSeoPolicy.ts` decide la disposición; `CatalogService.getBySlug('program')` la devuelve como `seo`; `catalog-detail` la aplica solo en `/programas/`.

| Entidad | URL canónica | Regla |
|---|---|---|
| Película | `/peliculas/{slug}` | `/programas/x` apunta a ella por canonical solo si M10 verificó la identidad (`workPath`: mismo TMDB, comprobación por emisión y de homónimos). La ficha de programa sigue siendo 200 e indexable. No se combinan `noindex` y canonical |
| Serie | `/series/{slug}` | Igual que película. `/programas/friends`, aunque cargue la emisión «Friends T3 E1», es la página de la serie, no la del episodio |
| Programa propio | `/programas/{slug transliterado}` | Sin TMDB y con al menos 20 palabras de descripción propia; es la única entrada al sitemap |
| Identidad sin verificar | la propia | No se adivina ningún destino; fuera del sitemap |
| Episodio | la propia, `noindex, follow` | Nunca canonical a la serie, que es otro documento |
| EPG fina | la propia, `noindex, follow` | |

**Coherencia entre superficies:**
- la canonical del SSR, el `url` de Movie/TVSeries y `og:url` usan la misma ruta;
- los enlaces de emisión, el enlace obra→programa de M10, el banner y el sitemap usan el slug transliterado;
- el sitemap pregunta la disposición a la misma consulta que carga la página (`programSlugDisposition`), así que nunca lista una URL que la página canonicalizaría a otra o marcaría `noindex`.

**Fuera de alcance:**
- **Sin redirecciones 301:** las páginas `/programas` dan 404 a los dos días y no tienen enlaces externos ni impresiones conocidas, así que no hay nada que redirigir de forma estable.
- **`robots.txt`:** no se toca.
- **Páginas de obra:** su regla de `noindex` cuando no hay emisión no cambia (decisión M09 §6, pendiente).

## 7. Salvaguardas de identidad

- No se consolida nunca por título: el único destino es el `workPath` verificado por M10, con forma de ruta validada; cualquier otro valor se trata como `ambiguous`.
- Los 248 gemelos que TMDB prueba pero M10 no verificó se quedan sin consolidar.
- Una película y una serie con el mismo nombre no se mezclan: M10 ya exige que coincidan el tipo y el TMDB.
- **Colisión al transliterar** («Último» y «Ultimo» dan `ultimo`): el slug legacy declara el transliterado solo si esa URL carga el mismo título. Si no, conserva el suyo. Hay test.
- **Limitación:** los episodios con un formato no reconocido («T13 Episodio 7» → `t13-episodio-7`) se clasifican como `ambiguous`: siguen indexables y fuera del sitemap. No llevan `noindex`.
- **Limitación:** la disposición sale de la emisión más temprana del título. Si dos emisiones discrepan en `workPath`, la canonical puede cambiar de un día a otro (revisión, MEDIUM, §12).

## 8. Slugs y URL legacy

- **Normalización:** NFD sin marcas diacríticas. Ejemplos: «último» → `ultimo`, «España» → `espana`, «Aquí non hai» → `aqui-non-hai`.
- **Unicode:** el título precompuesto (NFC) y el descompuesto (NFD) dan el mismo slug.
- **Slug legacy** (`el-ltimo-sol`):
  - sigue respondiendo 200 (el resolver acepta ambos desde M10);
  - declara `el-ultimo-sol` como canonical;
  - no tiene redirección, así que no hay cadenas ni bucles posibles.
- **Parámetros:** la canonical ya los elimina.
- **Tests:** tildes, español y gallego, NFC/NFD, colisión, legacy frente a transliterado, slug de obra frente a slug de episodio.

## 9. Sitemap antes y después

| Familia | Antes | Después con `on` (dry-run) | Motivo |
|---|---|---|---|
| `/programas/*` | 680 | 38 (dry-run); 44 en producción con `on` | Salen 273 gemelos (su canonical es la obra), 303 identidades sin verificar, 56 episodios y 10 fichas finas |
| canales | 82 | 82 | sin cambios |
| estáticas | 23 | 23 | sin cambios |
| guías | 18 | 18 | sin cambios |
| **Total** | **803** | **161** (dry-run); **167** en producción | |

- El XML sigue siendo válido aunque `sitemap-programs.xml` quede corto o vacío. El hijo se mantiene en el índice porque se envió a GSC directamente.
- No hay `lastmod` artificial. La caché es la existente (6 h, en memoria, se renueva al reiniciar).
- **Las páginas de obra no se añaden al sitemap:** su `noindex` cuando no hay emisión haría que entraran y salieran a diario.

## 10. Dry-run y despliegue gradual

- **Dry-run:** §5 y §9, sobre la función compilada aplicada al inventario real.
- **Activación:** `PROGRAMME_SEO_POLICY` en `/etc/guiatv/api.env`, seguida de reinicio de `guiatv-api`.

  | Valor | Efecto |
  |---|---|
  | `off` (por defecto) | Solo cambia la canonical del slug transliterado |
  | `canary` con `PROGRAMME_SEO_CANARY_PERCENT=10` | Se aplica a una cohorte sha256 estable del slug canónico. En el inventario son 74 URL: 29 `work`, 29 `ambiguous`, 10 `episode`, 3 `thin` y 3 `standalone` |
  | `on` | Se aplica a todas |

- **Condiciones de parada:**
  - el destino de una canonical no responde 200 o es `noindex`;
  - una película, serie, canal o guía pasa a `noindex`;
  - el sitemap y la canonical del SSR discrepan;
  - aparecen nuevos 5xx;
  - la cohorte supera lo revisado.
- **Rollback técnico:** `PROGRAMME_SEO_POLICY=off` y reinicio. El release anterior (`20261028155613`) también resuelve los slugs transliterados, así que volver atrás no rompe ninguna URL.
- **Lo que no se puede deshacer al instante:** las señales que Google ya haya procesado.

Ejecución en producción: §15.

## 11. Tests

| Área | Resultado |
|---|---|
| Backend (8 ficheros afectados, local) | 81 tests, todos en verde: `ProgrammeSeoPolicy` (7), `getBySlug` con `seo` y colisión (2), resolver y disposición (6), `detail-path` (4), `programme-path` (3), `SitemapController` (19), `TvReadQueryService` (20), `VerifiedWorkLinks` (8) |
| Frontend (Karma: `catalog-detail`, banner, utils) | 39/39 |
| Casos cubiertos | gemelo de obra, episodio frente a serie, ficha fina, identidad ambigua, `workPath` inválido o externo, slug transliterado, rechazo de canonical malformada o fuera de `/programas/`, anclas propias, `url` de JSON-LD |
| Suite completa y CI | Linux CI, ver §14 |
| Regresión SSR/SEO y Playwright de entidades | corren tras el merge en `main` (§14). Las rutas públicas se verifican en producción en §15 |

## 12. Revisión independiente

Un agente revisor en solo lectura (SEO, datos y seguridad) revisó `636a318`. No encontró ningún BLOCKER.

| Hallazgo | Gravedad | Resolución |
|---|---|---|
| Con `on`, el sitemap de programas queda vacío | HIGH | **Refutado con datos:** el dry-run sobre producción da 38 `standalone`, porque la página carga la emisión más temprana del título, que puede no tener TMDB. Excluir las `ambiguous` es una decisión de política (§6) |
| La transliteración puede unir dos programas | MEDIUM | **Corregido** en `e79fece`, con test |
| La canonical `work` depende de qué emisión se elige | MEDIUM | Documentado (§7) |
| Un canonical con `_` se rechazaba en el frontend | LOW | **Corregido** |
| Con `off` cambian también los enlaces y el sitemap transliterados | LOW | Intencionado (§8) |
| Falta un test página↔sitemap con una fila real | LOW | Cubierto en parte por el test de `programSlugDisposition` |

**Sin problemas en:** caché, seguridad (no hay redirección abierta ni inyección), rollback, editorial y páginas de obra, canales y guías.

## 13. Skills y agentes usados

- **Skills:**
  - ponytail (cambio mínimo completo);
  - context-mode (análisis de JSON y logs en sandbox).
- **Agentes:**
  - un único revisor independiente (Agente D);
  - los papeles A–C (forense, backend y SSR) se hicieron en la sesión principal, porque compartían los mismos ficheros y no eran independientes.
- **No usados:**
  - Playwright interactivo: las comprobaciones de SSR se hicieron con scripts `fetch` con UA de Googlebot, y Karma cubrió el componente;
  - Impeccable y UI UX Pro Max: no había ningún defecto de interfaz;
  - Indexing API.

## 14. PR y commits

| PR | Commits | Estado |
|---|---|---|
| #117 | `636a318` (política, slugs, sitemap y frontend); `e79fece` (correcciones de la revisión); `f251ca9` (el test ya no cuelga el proceso) | squash `30d3e75`, desplegado |
| (este documento) | PR de docs | ver el historial |

## 15. Release y rollback en producción

**Release:** el PR #117 se fusionó por squash como `30d3e75` (head verificado `f251ca9`).

**CI del PR:** `changes`, `backend`, `frontend` y `verify` en verde.
- Un primer run se colgó en `test:backend`. Causa: el `InMemoryCache` del test nuevo dejaba vivo el proceso.
- Se corrigió en `f251ca9`.

**CI posterior al merge en `main`:** `Build, test, and performance budgets`, `SEO regression` (SSR, caché, canonical y Playwright de entidades) y `Deploy por artefacto`, todos en verde.

**Producción:** `releaseId 20261028185153`, `gitSha 30d3e75`, `guiatv-api` y `guiatv-ssr` activos, `NRestarts=0`.

**Activación por cohortes:**
- Copia de seguridad de `api.env`: `api.env.bak-m09b-20261028T175338Z`.
- Cada paso: editar `/etc/guiatv/api.env` y reiniciar `guiatv-api`.
- La verificación usa `artifacts/m09b/verify-programmes.mjs`: estado, robots y X-Robots-Tag, canonical, y que el destino de la canonical sea 200, indexable y con canonical propia; las URL del sitemap deben ser 200, `index` y con canonical propia.

| Paso | Configuración | `sitemap-programs.xml` | Comprobado | Problemas |
|---|---|---|---|---|
| Despliegue (política sin definir = `off`) | — | 707 (680 antes; los títulos con tilde ya pasan el filtro de búsqueda) | 10 URL del sitemap + legacy `cmicos-nuestros` → canonical `comicos-nuestros` (200, `index`, canonical propia) | 0 |
| Canary 10 % | `canary`, 10 | 634 | 10 URL de la cohorte de todas las clases + 40 del sitemap | 0 |
| Canary 50 % | `canary`, 50 | 347 | 43 URL | 0 |
| `on` | `on` | **44** | las 44 URL del sitemap + gemelo y episodio de control | 0 |

**Ejemplos con `on`:**
- `/programas/black-rain` → canonical `/peliculas/black-rain` (200, `index`, canonical propia);
- `/programas/and-just-like-that` → `/series/and-just-like-that`;
- `/programas/episodio-813`, `/programas/arma-letal-t03-e15` y `/programas/deportes` → `noindex, follow`;
- `/programas/la-trampa-del-clic` y `/programas/comicos-nuestros` → canonical propia, `index`.

**Sitemap total:** 803 → **167** (estáticas 23, canales 82, programas 44, guías 18).

**Regresión en producción** (`ssr-sample-after.jsonl`):
- `/`, `/canales`, `/canales/la-1`, `/guias`, una guía, `/deportes/futbol`, `/programacion-tv/peliculas` y `/plataformas`: las mismas señales que antes (200, canonical propia, `index`, un H1, JSON-LD).
- `/peliculas/cenicienta` sigue en `noindex`, igual que antes; es la regla de M09 §6 y no cambia.

**Ninguna condición de parada se activó.**

**Operación editorial:**
- tarea `GuiaTV\EditorialCycle`: último ciclo a las 17:00, resultado 0, próximo a las 20:00;
- política activa con límite de 10 al día;
- ni el pipeline ni el runner se han tocado; el runner nunca enlaza `/programas`.

**Rollback:**
- política: `sudo sed -i 's/^PROGRAMME_SEO_POLICY=on$/PROGRAMME_SEO_POLICY=off/' /etc/guiatv/api.env && sudo systemctl restart guiatv-api` (o restaurar la copia de seguridad);
- código: volver a desplegar la release `20261028155613` (`ad46e73`), que también resuelve los slugs transliterados.

Las señales que Google ya haya procesado no se deshacen al instante.

## 16. Línea base de Search Console y seguimiento

- **Ficheros de base:**
  - `gsc-forensics.json`: series diarias y mensuales por familia, consultas, dispositivo, país, sitemaps e inspecciones;
  - `gsc-inspect-sitewide.json`: portada `http` y `www`, páginas indexadas;
  - `gsc-baseline-canary.json`: 13 URL de la cohorte y sus obras.
- **Estado de la cohorte:** ninguna está indexada; son «Google no reconoce» o «Descubierta».
- **Puntos de control** (las cifras se toman del mismo script; un dato ausente es «pendiente»):

  | Punto de control | Fecha | Estado |
  |---|---|---|
  | 7 días | 2026-11-04 | pendiente |
  | 14 días | 2026-11-11 | pendiente |
  | 28 días | 2026-11-25 | pendiente |

- **Qué medir en cada punto:**
  - impresiones y clics de la portada (http y https);
  - estado de `https://` en la inspección;
  - estado de las 13 URL de la cohorte y de 5 hubs;
  - descargas de `sitemap-programs.xml`.
- **Sin solicitudes de indexación masivas.**

## 17. Problemas SEO pendientes

1. **H2, portada `http`:** el propietario debe pedir una vez la indexación de la portada `https` en la interfaz de GSC.
2. **Páginas de obra:** el `noindex` cuando no hay emisión hace que su indexabilidad dependa del día (M09 §6, pendiente de decisión del propietario).
3. **Gemelos sin verificar:** 248 gemelos probados por TMDB que la puerta M10 no verificó.
4. **Peso del HTML:** la portada pesa 1,16 MB y `/canales` 5,7 MB (M10).
5. **Logs:** sin IP real en nginx, no se puede verificar Googlebot.
6. **H1 y H4:** sin resolver.

## 18. Estado de M09

**PARTIAL.** La política está documentada y aplicada en código. El criterio de M09 «ninguna página fina indexable» solo se cumple con la política activada y en el alcance de `/programas`. Siguen pendientes la regla estable de las páginas de obra y la observación en GSC.

## 19. Puerta de M12

**NO-GO**, sin cambios:
- M10 y M11-B siguen parciales;
- no hay recuperación observada;
- ampliar las páginas programáticas iría contra H1.

## 20. Siguiente hito (uno solo)

**M09-C:** observación de la indexación a 7, 14 y 28 días y regla de indexabilidad estable para `/peliculas` y `/series`.

- Debe incluir la solicitud de indexación de la portada `https` (propietario).
- Solo después decidir si las páginas de obra entran en el sitemap.
