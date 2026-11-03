# M03-A — Selección de candidatos para el enriquecimiento heredado

Ejecutado el **2026-11-03** (Europe/Madrid) sobre `main@5fca86d`, release `20261103023955`. Solo lecturas: base de datos de producción bajo el guard de solo lectura y GET públicos con pausa. No se activó ningún flag, no se reinició ningún servicio y no se escribió nada en producción.

## 1. Resultado

| Qué | Resultado |
|---|---|
| Selector de candidatos | **Nuevo** (`apps/backend/src/scripts/legacy-enrichment-candidates.ts`). El de 3F (22 oct) no estaba en el repositorio |
| Películas con TMDB en la ventana EPG | 958; con fila de catálogo de película 720 |
| Con emisión atada a su fila, más allá de la ventana heredada | **80** |
| De esas 80, con la página sin géneros ni duración (regla de 3F) | **0** |
| Allowlist de M03-A | **Vacía: no hay candidatos válidos** |
| Hoja de «go» de M04-A | No se prepara: no hay lista que firmar |

## 2. Por qué no hay candidatos

El enriquecimiento heredado de M04-B existe para añadir a las fichas de películas lo que su carga heredada no tenía. 3F midió el 2026-10-22 «0/20 géneros y 0/20 duración». Hoy, en las 80 candidatas, la carga de la ruta `/v2/catalog/slug/movie/<slug>` ya trae:

| Dato | Con dato | Sin dato |
|---|---:|---:|
| Géneros | 78 | 2 |
| Duración | 79 | 1 |
| Ambos faltan | — | 1 |

Además, 8 de las 80 son `noindex, follow` (la regla de 3F las excluye) y 5 no tienen sinopsis.

La causa más probable es M05 (release `20261023010043`): las fichas de películas pasaron a leerse del catálogo. Es una hipótesis, no está probada aquí. Lo que sí está medido es que el hueco que M04-B quería llenar casi no existe ya en las páginas con emisiones.

Lo que M04-B aportaba además eran emisiones verificadas más allá de los 2 días que lista la página heredada. Eso no se midió en esta sesión: el preflight del VPS no se ejecutó porque ninguna candidata supera la regla de selección.

## 3. Cómo se hizo

1. **Selector en el VPS** (`/tmp/m03a`, un árbol de enlaces a la release para no escribir en ella). El guard de solo lectura registró 4 operaciones, todas lecturas (`aggregate`, `getMore`, `find`).
2. **Comprobación pública local**, paced a 1,5 s: ruta resuelta con `/v2/catalog/tmdb:movie:<id>`, carga heredada, `robots`, canónica única y misma identidad. Ficheros: `artifacts/m03a/candidates-raw.json` y `candidates-checked.json`.
3. Un primer intento usó la carga del catálogo por TMDB, que ya está enriquecida, y dio 0 válidas por esa razón. Se corrigió para usar la ruta heredada, y el resultado sigue siendo 0, ahora con la causa anterior.

## 4. Consecuencia para M04-B y M11-B

- M04-B sigue NO-GO, pero su premisa de valor cambió. Activar `CONTENT_LEGACY_ENRICHMENT_ENABLED` hoy no llenaría un hueco medido.
- La dependencia formal «M11-B depende de M04-B» no protege nada en el contenido editorial: no bloquea redactar ni publicar guías, y el enriquecimiento no cambia las guías.
- Decidir qué hacer con M04-B (reabrirlo con una medición nueva, o retirarlo del camino de M11-B) es del propietario. Esta entrega no cambia el roadmap canónico.

## 5. Pendiente

Decisión del propietario sobre la dependencia M11-B ← M04-B. Si se quiere medir antes el posible valor residual (emisiones más allá de la ventana), hay que ejecutar el preflight del VPS con las candidatas que tengan al menos un hueco, aunque la regla de 3F no las acepte.
