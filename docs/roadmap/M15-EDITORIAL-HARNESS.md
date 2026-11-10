# M15 — Harness del flujo editorial (registro persistente)

Rama: `fix/m15-editorial-flow` (desde `origin/main` 0c78c010). Snapshot de producción, solo lectura:
`Get-Content -Raw scripts/ops/editorial-prod-state.sh | ssh contabo 'tr -d "\r" | bash -s'`.

## Objetivo
Un artículo real recorre descubrimiento/solicitud → investigación → redacción → revisión → publicación por política →
URL pública + sitemap, supervisado y controlable desde Admin → Editorial.

## Hechos comprobados (2026-11-10, producción `20261110193535` = `0c78c010`)
- Ejecutor: lo lanza el backend (`EditorialRunnerService`, `EDITORIAL_RUNNER_COMMAND=/usr/bin/node`,
  args `/var/www/guiatv/scripts/editorial-agents.mjs cycle --report http://127.0.0.1:4000`), cwd `/var/www/guiatv/current`.
  Mismo hash que `main`. Proveedor activo: DeepSeek.
- Planificador: único cron `11 */3 * * * /usr/local/sbin/guiatv-editorial-cycle.sh` **comentado** (`# paused-guiatv-editorial`).
  Tarea Windows `EditorialCycle` deshabilitada. No hay timer systemd. ⇒ sin ciclos automáticos desde 2026-11-06.
- `editorial_settings.generation.enabled=false` (2026-11-06 14:54, admin-key). Política activa, no pausada, límite 10/24 h.
- Último ciclo: 2026-11-10 17:52 `generation-paused` (arranque manual). `runCycle` sale en `generation-paused`
  **antes** de procesar solicitudes manuales ⇒ un arranque manual con la generación en pausa no hace nada útil.
- Solicitud manual huérfana: `660b84f7…` (CNMC) `running` desde 2026-11-06 14:11 — el runner murió por
  `ReferenceError: Cannot access 'manualTopic' before initialization` (ya corregido en main, 0008219d). Fallo 2 real.
- `--out` no se pasa ⇒ los ficheros de ejecución van a `current/artifacts/m11b/runs` (por release, se pierden).
  Efecto real: mantenimiento `no-local-provenance` en las 4 guías publicadas por política. Fallo 4 real.
  `GUIATV_EDITORIAL_STATE=/var/lib/guiatv/editorial-runner/state` se pasa pero `editorial-agents.mjs` lo ignora.
- Última publicación por política: 2026-10-28. Sin borradores IA huérfanos ni `verified` en el CMS (fallos 1 y 3: riesgo
  demostrado por código, no observado en producción).
- CNMC (único tema que llegó al pipeline): `blocked`, 5 ciclos de revisión (cifras, longitud 370 palabras, sin valor propio).

## Por qué no se publica nada ahora
1) planificador pausado + `enabled=false`; 2) el arranque manual sale antes de las solicitudes manuales;
3) la única solicitud manual está huérfana en `running`; 4) la cola de temas está vacía (descubrimiento descarta todo).

## Plan / estado
- [ ] F1 borrador huérfano: recuperar el borrador de esta ejecución por slug sin revisión humana + conciliar aprobación ambigua.
- [ ] F2 recuperar solicitudes `running` caducadas (concesión) + procesar manuales con generación en pausa.
- [ ] F3 `verified` → borrador revisable en el CMS, sin aprobar; no consume cuota de publicación.
- [ ] F4 `--out` y estado persistentes en `/var/lib/guiatv/editorial-runner`.
- [ ] F5 panel: planificador real (cron) vs `scheduleHours`.
- [ ] UI, pruebas, E2E con interrupción, primer artículo.

## Registro
- 2026-11-10 19:45 diagnóstico de producción completado (ver hechos). Llamadas a modelos: 0.
- 20:40 Mongo de pruebas local: `mongod` 8.2.6 copiado al scratchpad, replica set `rs0` en 127.0.0.1:27119.
  Línea base: backend editorial/blog 192/192, ops (ciclo + ledger) 23/23.
- 21:30 F1–F5 implementados en servidor y ejecutor. Pruebas: backend 194/194 (+2 nuevas, +1 ampliada), ciclo 24/24
  (+5 escenarios M15: pausa con solicitud manual, borrador pendiente reintentado, tope/parada sin regenerar, borrador de
  persona intocable, sustitución bajo versión). Llamadas a modelos: 0.
  Comando: `node --test scripts/editorial-cycle.test.mjs`; backend: build + `node --require ./test-setup.cjs --test <dist editorial/blog>` con
  `TEST_MONGO_URI=mongodb://127.0.0.1:27119/?directConnection=true`.
- 22:10 UI: planificador real + diagnóstico, bloqueos listados, enlace público, confirmación al publicar/despublicar.
  Karma editorial 53/53 (+3). PR #207.
- 22:30 E2E local (`scripts/ops/editorial-e2e-local.mjs`, API real + Mongo + runner real + pasarela simulada): 15/15.
  **Error encontrado por el E2E**: el CMS guarda toda procedencia como `state: 'draft'`, así que el reintento no podía
  basarse en `approved-by-policy`. Ahora decide con `policyBlockers` del servidor (bloqueo duro → regenerar y sustituir;
  solo juicios → revisión humana; ninguno → reintentar aprobación). Ciclo M15 6/6.
- Tema del primer artículo: publicidad de apuestas en TV (RD 958/2020). Semillas validadas con `checkSeeds`:
  BOE-A-2020-13495 y nota CNMC 2020-05-26 (2 editores). BOE-A-2024-10949 descartada (no supera el filtro de tema).
- 22:07 #207 y #208 desplegados (`8e4a5778`, release `20261110220644`). Solicitud `d3cbeabf…` creada y ejecutor
  arrancado en modo manual (`scripts/ops/editorial-first-article.sh`). Verificado en producción:
  - F2: la solicitud huérfana de CNMC (`660b84f7…`, `running` desde el 06-11) se recuperó sola y se procesó.
  - F4: los ficheros de ejecución se escriben en `/var/lib/guiatv/editorial-runner/state/m11d/runs`.
  - Manual con la generación en pausa: ya se procesan ambas solicitudes.
  - **Ambas acabaron `blocked` en 0 s, con 0 llamadas y 0 descargas: `Cannot read properties of undefined (reading 'map')`.**
- 22:12 **Causa raíz real de que no se genere nada**: la tabla de rutas guardada en producción (06-11) tiene 5 roles;
  el pipeline tiene 6 (`planner`, M14-R). `validRoutes` lo eliminaba al guardar desde el Admin → `chooseRoutes`
  falla en `table.planner.map`. El E2E no lo vio porque usaba rutas por defecto; ahora guarda una tabla de 5 roles.
  Arreglo: PR #210 (`getSettings` completa roles, `validRoutes` conserva `planner`). Backend 195/195, E2E 16/16.
  Llamadas a modelos en producción hasta ahora: 0 (coste 0).
- 22:30 #210 desplegado (`558ff239`). `retry` de `d3cbeabf…` + arranque manual. Esta vez el pipeline generó de verdad:
  2 revisiones, 0,623 USD, 5 editores, 3 afirmaciones usadas. Bloqueos editoriales en curso de revisión
  (`uncited-factual-statement` en dos encabezados con cifras, `no-distinct-value`, longitud 738/900), pero el trabajo
  **murió por código** en la 2.ª investigación: `Cannot read properties of undefined (reading 'filter')`.
- 22:45 **Tercera causa**: la respuesta de DeepSeek a la re-investigación llegó sin `sources` y el pipeline confiaba en el
  esquema. Arreglo: campos ausentes en respuestas del modelo = listas vacías (`sources`, `claims`, `quotes`, `conflicts`,
  `issues`). Al revisarlo, un veredicto del crítico ausente o desconocido acababa en `pass` (`indexOf` −1): ahora bloquea.
  Además, las `internalSources` relativas de las solicitudes manuales se resuelven contra el sitio. Backend 196/196, ciclo 25/25.
  Coste acumulado en producción: 0,623 USD.
