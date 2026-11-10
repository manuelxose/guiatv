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
- Pendiente: UI (planificador real, estado de solicitudes), PR + despliegue, cron `*/15`, primer artículo.
