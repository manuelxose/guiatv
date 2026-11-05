# M14-A — Revisión independiente del arreglo de timeout del gateway

Estado: **PASS CON SALVEDADES** para el arreglo estrecho del stream. La revisión la realizó un modelo distinto del implementador (Claude Code Sonnet 5.5, tool `subagent_claude_code_sonnet_55`) el 2026-11-05, en modo solo lectura, sobre `d195c983` y el estado del adaptador.

## 1. Veredicto

El plazo de reloj de pared por turno corta el stream sin fin de DeepSeek, el timer se limpia en `finally` y las carreras entre aborto y fin del stream están resueltas. El commit, por sí solo, no acotaba la llamada completa ni propagaba la cancelación del trabajo.

## 2. Hallazgos y resolución

| Id | Severidad | Hallazgo | Resolución en esta entrega |
|---|---|---|---|
| H1 | media | La propagación de abort no estaba en `d195c983`; el estado actual no era reproducible desde el commit | Se commiteará junto con el ledger y sus tests |
| H2 | media | Al abortar se perdía el gasto de turnos anteriores ya facturados | `ModelCallFailed.unresolved`; se cobra el `usage` conocido y el resto queda sin resolver |
| H3 | media | Una respuesta inválida en la corrección de puertas abortaba un job casi pagado | Se conserva el borrador válido anterior y se sale del bucle de corrección |
| H4 | media | Las respuestas SEO en modo prompt podían no traer `title`/`excerpt` y producir `# undefined` | `metadataShapeProblems` valida cada respuesta antes de aplicarla |
| H5 | media | El plazo se reiniciaba en cada `pause_turn`: hasta 4 × 300 s por llamada | Un plazo absoluto por `call()`, con el tiempo restante en cada turno |
| H6 | media | El tope de 8 MiB no acota el texto real de un artículo | Tope adicional de 1 MiB de texto acumulado (`text_delta`) |
| H7 | media | 300 s pueden ser justos para investigación legítima con thinking | No se añadió plazo por rol; el plazo del artículo de M14-B acota el conjunto |
| H8 | baja | DeepSeek ignoraba `EDITORIAL_MODEL_TIMEOUT_MS` | Ahora hereda el valor del adaptador base y la variable de entorno |
| H9 | baja | El callback del timer podía lanzar si el doble de test no tenía `abort`; el timer no era `unref` | `abortStream` protegido y `deadline.unref()` |
| H10 | baja | El commit no traía tests del plazo ni del tope | Test de señal ya abortada; tests del ledger y del pipeline |

## 3. Lo que sigue fuera del arreglo estrecho

- El presupuesto total del artículo no vive en el adaptador: lo implementa el ledger M14-B (plazo por etapa y por artículo, heartbeat, cancelación y recuperación).
- El coste de un stream abortado a mitad de turno sigue siendo una estimación: se cobra lo reportado y se marca el resto como no resuelto; no se inventa una cifra.
- Que DeepSeek respete `max_tokens` es una suposición del proveedor; el tope de texto y el plazo son la defensa local.
- No se ejecutó un ciclo completo de artículo en esta revisión. La verificación de producción queda en M14-B/M14-G.

## 4. Evidencia

- Revisión: `subagent_claude_code_sonnet_55`, sin escritura de archivos.
- `npm run build:backend`: correcto.
- Tests focalizados: 32/32 correctos (`AnthropicEditorialModel`, `EditorialAgentPipeline`, `EditorialJobLedger`).
- El commit final incluye los cambios revisados y el test de aborto.
