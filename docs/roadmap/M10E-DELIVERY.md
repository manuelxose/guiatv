# M10-E — Elegibilidad compartida de programas y enlazado perenne

Estado: **PARTIAL (2026-11-02)**. Implementado, revisado y probado; PR [#138](https://github.com/manuelxose/guiatv/pull/138)
abierto. **No fusionado ni desplegado**: ver §9.

## 1. Línea base

- HEAD al empezar: `39b7093` (#137). Durante el trabajo `main` avanzó a `22e4405` («feat: improve editorial AI
  operations», trabajo editorial del propietario, ajeno a M10-E). La rama se rebasó sobre él sin conflictos.
- Producción: release de M10-D (#136), el último desplegado y verificado.
- Las 13 modificaciones editoriales locales del checkout principal no se tocaron: M10-E se hizo en un worktree
  aparte (`../guiatv-m10e`). El propietario las publicó después en `22e4405`.

## 2. Medición antes del cambio (producción, 2026-11-02 21:58 UTC)

`scripts/programme-reachability.mjs` (nuevo, secuencial, con parada si `/v2/health` se degrada). Lee el HTML SSR
crudo (sin JS) de las **320** fichas de canal que enlaza el directorio `/canales`, y lee el sitemap al empezar y
al terminar.

| Métrica | Antes |
|---|---:|
| URLs en `sitemap-programs.xml` | 22 |
| Mismo sitemap al empezar y al terminar | sí |
| Programas del sitemap con `<a href>` desde una ficha de canal | **0** |
| Enlaces `/programas/` hacia destinos fuera del sitemap | 0 |

Esto confirma, con un segundo método, el `ORPHAN_IN_SCOPE = 22` de M10-D. Evidencia:
`artifacts/m10e/before-reachability.json`.

¿Dónde se emiten las 22? Sondeo de la API pública, hoy y mañana, sobre los 423 canales:

- **18** tienen alguna emisión **hoy** en algún canal.
- **4** solo se emiten **mañana**:
  - `desmontando-el-cosmos`, `el-enigma-de-los-circulos-marinos` (Odisea)
  - `aunque-la-hormona-se-vista-de-seda`, `pepi-luci-bom-y-otras-chicas-del-monton` (Somos)

## 3. Arquitectura

**`ProgrammeEligibility`** (`apps/backend/src/application/services/ProgrammeEligibility.ts`)

Recoge, sin cambios, el cálculo que hacía `SitemapController`:

- candidatos de hoy y mañana (`getIndexableProgramSitemapRows`);
- slug con `slugifyTitle`, descartando `sin-titulo`;
- la consulta de la propia página (`CatalogService.programSlugPage`, ahora pública), con 8 en paralelo como máximo;
- la regla `standalone` de M09-B allí donde se aplica la política.

Lo que sí es nuevo:

- Cada entrada guarda el título que carga la página.
- Cada entrada lleva un indicador `linkable`: `standalone` con la política aplicada, que es la misma regla de la
  ficha de emisión (`standaloneProgrammePath`).

**Contrato de caché**

- Una instantánea responde por **un día de Europa/Madrid** (TZ del proceso).
- Una instantánea deja de valer con lo primero que ocurra de:
  - su TTL (`SITEMAP_CACHE_TTL_MS`, 6 h);
  - la medianoche siguiente;
  - `invalidateSitemapCache()` sin claves o con `programs`, que llama `PrecomputeSchedule` tras cada
    reconstrucción del read model. Publicar una guía no invalida nada.
- Peticiones simultáneas comparten una sola construcción.
- Una construcción iniciada antes de una invalidación responde solo a quien ya la esperaba: no se guarda ni se
  reutiliza.
- Un fallo de repositorio rechaza la petición; **nunca** produce un conjunto vacío. Si existe una instantánea
  buena del mismo día, se sirve 60 s marcada como `fallback` y después se reintenta. Una de otro día no se sirve
  nunca.
- La caché es por proceso, igual que el resto de cachés del sitemap. Un reinicio la vacía.

**Sitemap**

- `sitemap-programs.xml` se genera a partir de la instantánea.
- Su XML caduca exactamente cuando caduca la instantánea.
- Un XML generado desde un `fallback` no renueva el *last good* de 24 h del sitemap.
- Población, orden, `lastmod` y reglas de política apagada o sin consulta: idénticos a los anteriores.

**Superficie de canal**

`TvSurfaceService.getChannelSurface` añade `program.programmePath` en **cada lectura**. Nunca se guarda en la
caché de 60 s de la superficie. Se añade solo si se cumplen todas estas condiciones:

- el slug es `linkable`;
- el título de la emisión es **exactamente** el título de la página;
- no hay `workPath` verificado.

Cuándo se enlaza:

- `current()` nunca espera.
- Sin instantánea válida no se dibuja ningún enlace de programa; nunca uno adivinado.
- Por eso el sitemap y las fichas de canal leen siempre la misma instantánea, o el canal no muestra ninguno.

**Frontend**

- `normalizeToCard` prefiere `workPath`, luego `programmePath`, luego la ficha de emisión.
- La tarjeta y «Abrir» comparten ese destino. Son `<a href>` reales en SSR.
- Angular no calcula ninguna elegibilidad.

## 4. Pruebas

| Suite | Resultado |
|---|---|
| Backend, nuevas (`ProgrammeEligibility.test.ts`) | 11/11 |
| Backend, relacionadas (sitemap, superficie, alias, CatalogService) | 93 pass, 0 fail, 2 skipped |
| Backend completo en CI (Linux) | 836/837 pass, 0 fail |
| Backend completo en local | 729 pass. 3 fallos solo en Windows (`tar C:\…` en tests de manifiesto ajenos), que pasan en CI |
| Frontend completo | 384/384 |

Las 11 pruebas nuevas cubren:

- paridad exacta entre sitemap e instantánea;
- deduplicación;
- `[object Object]`;
- Modern Family `ambiguous`;
- Gladiator `work`;
- episodio y `thin`;
- títulos de mismo slug pero distintos;
- caducidad por TTL;
- medianoche y ventana del día siguiente;
- invalidación con una construcción pendiente;
- fallo sin conjunto vacío;
- política apagada;
- `fallback` sin renovar *last good*;
- superficie con y sin caché;
- ninguna consulta por fila.

El frontend añade:

- un test DOM: todos los `<a href>` de una fila elegible apuntan a `/programas/aida`, y una fila sin
  `programmePath` no cambia;
- un test de `normalizeToCard`.

## 5. Revisión independiente

| # | Hallazgo | Resolución |
|---|---|---|
| 1 (**bloqueante**) | Una petición posterior a una invalidación reutilizaba la construcción en curso, así que el sitemap podía cachear la población anterior durante horas. | Corregido en `c6957e2`, con test de regresión |
| 2 | Con la política apagada, el canal habría enlazado páginas no `standalone`, al revés que la regla de la ficha de emisión. | Corregido (`linkable`) |
| 3 | Un `fallback` renovaba el *last good* de 24 h del sitemap. | Corregido |
| 4 | Huecos sin enlaces mientras se construye (arranque, invalidación, medianoche), y una construcción más tras cada reconstrucción. | Aceptado por diseño, documentado |

Segunda revisión: sin bloqueantes. Queda una nota menor: una construcción sustituida que falla retrasa hasta 60 s
el reintento en segundo plano de `current()`, pero no afecta al sitemap.

## 6. Metadatos de `/programas/aida` y `/programas/com-si-fos-ahir`

**No se reproduce.** En producción ambas sirven 28 palabras (unos 155 caracteres, cortadas con «…»), igual que
`comicos-nuestros`, con `index, follow` y canonical propio. Sin cambios.

## 7. Límite conocido: programas que solo se emiten mañana

La ficha SSR de un canal muestra el día de hoy. El selector de día es solo de cliente y no tiene URL, así que una
página perenne no puede enlazar un programa que solo se emite mañana.

Las alternativas quedan descartadas:

- Una URL `?dia=manana` enlazaría una URL no canónica.
- Quitar «mañana» del sitemap reduciría la población elegible.
- Una página-hub sería una granja de enlaces.

Consecuencia: los programas que solo se emiten mañana (4 de 22 en la medición) **no tienen ruta perenne hasta la
medianoche**, cuando pasan a ser de hoy y la instantánea nueva los enlaza. Se documenta como `PARTIAL`, sin
debilitar ninguna regla.

## 8. Producción después del despliegue

Pendiente: requiere fusionar y desplegar (§9). Comando de verificación:

```
node scripts/programme-reachability.mjs --out artifacts/m10e/after-reachability.json
```

Más un rastreo perenne agotado de M10-D con concurrencia 2 y control de salud.

## 9. Bloqueo de release

- El check `backend` de #138 falla **solo** en `test:ops`, con 8 tests del ciclo editorial
  (`ReferenceError: Cannot access 'generationPost' before initialization`).
- El mismo fallo está en `main` desde `22e4405`, que es trabajo editorial ajeno a M10-E y que este milestone no
  puede tocar.
- Cualquier despliegue de `main` incluiría además ese cambio editorial sin verde.
- Fusionar y desplegar queda a decisión del propietario.
- Rollback si se despliega: la release de M10-D (#136).
