# M09-D: SEO evergreen de películas y series

Fecha: 2026-10-28. PR #122 (squash `60c8764`), desplegado como `20261028204652`. Evidencia en `artifacts/m09d/` (no versionado).

## 1. Veredicto

| Criterio | Estado | Base |
|---|---|---|
| Fichas verificadas y útiles indexables sin emisión EPG | **PASS** | §3, §6 |
| Protecciones de fichas pobres, duplicadas y ambiguas | **PASS** | §3, §6 |
| Sitemap, canonical, robots y SSR coinciden | **PASS** | §6 |
| Tests automáticos | **PASS** | §5 |
| Regresión en producción | **Ninguna detectada** | §6 |
| Indexación en Google | **PENDIENTE** (resultado externo) | checkpoints de M09-C §15 |
| **M09-D** | **PASS** (ingeniería) | |

## 2. Diagnóstico

- **HTTP apex:** `http://guiaprogramaciontv.com/…` → un solo 301 a `https://` apex, con la ruta y la query. Correcto, sin cambios. La redirección www no se volvió a auditar (M09-C).
- **Causa:** M09-C ya desligó de la emisión las fichas con contenido completo (sinopsis de 300 caracteres o más). Pero una ficha con identidad probada, registro completo y una sinopsis de TMDB de 150–299 caracteres solo era indexable como `airing`, es decir, mientras tuviera emisiones actuales. Al terminar la emisión pasaba a `noindex`. El 28-oct afectaba a 226 películas y 86 series. Ejemplos: `/series/la-promesa`, `/series/modern-family`, `/peliculas/prisionero-de-guerra`.
- En las películas con identidad probada, la sinopsis corta es el motivo de fallo más frecuente: falla en 6.436 de 8.116.

## 3. Política (decisión del propietario: «broadcast-backed»)

Código: `WorkSeoPolicy.ts`. Mismo interruptor `WORK_SEO_POLICY`.

| Condición | Antes | Ahora |
|---|---|---|
| Identidad probada, registro completo, sinopsis de 300+ | `indexable` | igual |
| Igual, pero sinopsis de 150–299 y GuíaTV ha registrado alguna emisión (`tv_read_airings`, histórico sin poda, categoría Cine→película, Series→serie) | `airing` mientras se emite y después `thin` | **`indexable`**, también en el sitemap |
| Igual, sinopsis de 150–299 y nunca emitida | `thin` | igual (`noindex, follow`) |
| Sinopsis de menos de 150 o registro incompleto | `thin` / `airing` | igual |
| Homónimo / slug variante | `ambiguous` / `variant` | igual: el registro de emisión nunca prueba una identidad |

- **«Completo»:** ficha TMDB completa (`lastEnrichedAt`), póster, géneros, director o 3 actores y, en películas, año y duración.
- **Coherencia:** la página, el canonical cruzado de `/programas` y `sitemap-works.xml` aplican la misma regla.
- **Coste:** la consulta de emisión solo se hace para registros del tramo corto, se detiene en el primer resultado (índice `program.tmdbId`) y, si falla, lanza un error: la página responde 503, nunca un `noindex` cacheable.
- **Contenido:** no se genera texto ni se infiere ningún dato.

## 4. URL afectadas

Dry run de solo lectura en producción (`artifacts/m09d/dryrun.js`):

| | Películas | Series |
|---|---|---|
| Pasan a `indexable` (tramo corto, con emisión registrada) | **1.356** | **195** |
| … de ellas, antes indexables solo mientras se emitían | 175 | 63 |
| Siguen `noindex`: tramo corto nunca emitido | 1.181 | 465 |

`sitemap-works.xml`: 2.140 → **3.691** URL, la cifra exacta que predecía el dry run.

## 5. Tests

- **`WorkSeoPolicy.test.ts` (9):**
  - película verificada con y sin emisión;
  - serie sin emisión;
  - tramo corto con o sin registro de emisión, y con emisión actual (`airing`);
  - límites de 149, 150, 299 y 300 caracteres;
  - fichas pobres con registro de emisión;
  - un homónimo con emisión sigue `ambiguous`;
  - slug variante;
  - un `/programas` duplicado no se canonicaliza hacia una obra `noindex`.
- **`WorkSeoPolicy.mongo.test.ts`:**
  - la página y el sitemap dan el mismo veredicto;
  - una serie corta nunca emitida queda `noindex`;
  - las fichas emitidas pero pobres o ambiguas siguen protegidas;
  - un fallo de base de datos lanza un error;
  - una obra completa no consulta las emisiones.
- **`legacy-enrichment-ssr.test.mjs`** (bundle SSR real): película y serie sin emisión → `index` con un único canonical propio; pobre y homónimo → `noindex, follow` en la meta y en `X-Robots-Tag`.
- **Episodios:** cubiertos por los tests existentes de M09-B (`ProgrammeSeoPolicy.test.ts`, `catalog-detail.programme-seo.spec.ts`), sin cambios.
- **Suites:** `CatalogService*` (9 ficheros) en verde con Mongo 7 local. Suite completa del backend en Windows: 793/797. Los 3 fallos son conocidos y exclusivos de Windows: 2 cierres de libuv al salir tras pasar sus tests y el modo de fichero POSIX de `content-certify`.
- **CI:**
  - PR: `backend`, `frontend` y `verify` en verde;
  - `main` @ `60c8764`: «Build, test, and performance budgets» y «SEO regression» en verde.
- **Revisión independiente** (subagente con el código, sin mis conclusiones): 0 BLOCKER, 0 HIGH.
  - MEDIUM, coste de la consulta: aceptado, porque solo afecta al tramo corto y la respuesta se cachea. Si la latencia lo pide, añadir el índice `{program.tmdbId, program.editorialCategory}`.
  - LOW: las categorías distintas de Cine/Series no cuentan; página y sitemap coinciden en ello.
  - Huecos de test: añadidos.

## 6. Producción

- Despliegue por artefacto, run 40757131753 → `20261028204652` @ `60c8764` (`release.json` verificado). `package-lock.json` sin cambios.
- `guiatv-api` y `guiatv-ssr` activos, `NRestarts=0`. `WORK_SEO_POLICY=on` y `PROGRAMME_SEO_POLICY=on` intactos. No se tocó `api.env`.
- **SSR público con UA Googlebot:**
  - `/series/la-promesa`, `/series/modern-family`, `/peliculas/prisionero-de-guerra` e `/peliculas/indiana-jones-y-el-reino-de-la-calavera-de-cristal` (0 emisiones) → `index`, con canonical propio y disposición `indexable`;
  - `canta-2` (140 caracteres), `uykucu` y `blue-my-mind` → `noindex` (`thin`); `la-novia` y `the-madison` (tramo corto sin emisión) → `noindex` (`thin`);
  - `mash` y `los-invasores` → `noindex` (`ambiguous`);
  - `cenicienta` y `guerra-mundial-z` siguen `index`.
- **Muestra aleatoria de `sitemap-works.xml`:** 25/25 con 200, `index`, un único canonical igual a la URL y sin `noindex` en la cabecera. 0 URL fuera del formato `https://` apex.
- **Canonicals cruzados:**
  - `/programas/gladiator`, `/programas/la-ley-de-jenny-pen` y `/programas/american-badger` → canonical a su obra, que es `indexable`. Las dos últimas antes quedaban con canonical propio y `noindex`, porque la obra era `airing`.
  - `/programas/la-promesa` → `noindex` (`thin`, sin `tmdbId`).

## 7. Rollback

```sh
# Código (en contabo): volver a la release M09-C
sudo /var/www/guiatv/scripts/guiatv-ops.sh rollback 20261028193209   # la release existe en /var/www/guiatv/releases/
# Alternativa: desactivar toda la política de obras (también revierte M09-C)
sudo sed -i 's/^WORK_SEO_POLICY=.*/WORK_SEO_POLICY=off/' /etc/guiatv/api.env && sudo systemctl restart guiatv-api
```

Las cachés SSR, nginx y `/v2` expiran en 5–30 min. Un rollback técnico no revierte las decisiones de indexación que Google ya haya tomado.

## 8. Pendiente

- `/programas/modern-family` es `ambiguous` en M09-B (`tmdbId` sin `workPath`). Se sirve `index` con canonical propio mientras `/series/modern-family` también es `index`: un posible duplicado heredado de M09-B, no introducido aquí. Corresponde a M10-B (desambiguación de homónimos).
- 717 obras `ambiguous` y 1.646 obras del tramo corto nunca emitidas siguen `noindex`. Es intencionado.
- El efecto en Google se mide en los checkpoints del 4, 11 y 25 de noviembre (M09-C §15), con `sitemap-works.xml` ya en 3.691 URL.

## 9. Siguiente hito

**M10-B**: enlazado interno estable hacia las fichas `indexable` y desambiguación de homónimos, incluido el caso `/programas` `ambiguous` de §8. M12 sigue NO-GO.
