# M14-G — Ejecución canary controlada (2026-11-05)

Estado: **PARTIAL / BLOCKED para publicación autónoma**. El ciclo completo se ejecutó en producción con el ledger activo y todas las puertas reales; ningún artículo superó todas las puertas. No se publicó nada y la generación programada sigue en pausa.

## 1. Tema y fuentes

- Tema: «Permanencia en la televisión de pago: qué puedes exigir en España».
- Slug: `permanencia-television-pago-derechos-espana`.
- Fuentes semilla: CNMC (`https://www.cnmc.es/node/414312`) y BOE (`https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555`).
- Puerta de semillas: **2 familias editoras**, ambas verificadas (`6/11` y `7/11` términos). Es la primera vez que un tema de esta sesión supera esa puerta sin relajar el umbral.
- Longitud objetivo: 600–900 palabras.

## 2. Ejecución

- Comando: `scripts/editorial-agents.mjs run <topic.json> --report http://127.0.0.1:4000 --confirm-production-write --autopublish`.
- Ledger: `2026-11-05T18:52:39.290Z-permanencia-television-pago-derechos-espana` (y un intento anterior bloqueado por un fallo de parseo).
- Etapas observadas: `source-retrieval` → `research-synthesis` → `evidence-validation` → `article-drafting` (varias) → `seo-enrichment` → `publication-eligibility` → `quality-evaluation`, con dos ciclos de revisión.
- Llamadas de modelo: 10; tokens de entrada 41.168; salida 42.916; coste estimado **0,1925 USD** (tarifa de lista, no factura).
- Resultado: `blocked`, 2 revisiones (`revise/rewrite` en todas), sin publicación.

## 3. Defectos reales encontrados por el canary y corregidos

| # | Defecto | Evidencia | Corrección | Estado |
|---|---|---|---|---|
| 1 | El parser exigía JSON estricto y falló con prosa después del objeto | Job `18:36:11` bloqueado en `research-synthesis`; `Unexpected non-whitespace character after JSON` | Parseo del primer valor JSON balanceado, cualquier fence y prosa previa | Desplegado y verificado en el canary siguiente |
| 2 | El redactor podía responder sin JSON y perdía el trabajo entero | Job `18:52:39`, `editorial: no JSON block in the answer` | Reintento del redactor con el defecto dentro del presupuesto de revisión | Desplegado |
| 3 | Los marcadores de lista ordenada (`1.`, `2.`) se contaban como datos sin cita y rompían la comparación HTML/borrador | `block uncited-factual-statement: «1.»…«4.»` y `content-not-reviewed-draft` | Se eliminan los marcadores antes de trocear frases y en el markdown visible | Corregido; reevaluación local del run real deja solo los hallazgos editoriales reales |
| 4 | El valor diferencial declarado por el redactor no estaba probado por las afirmaciones | `distinct-value-unsupported` | No se relaja la puerta; el redactor debe corregirlo o el artículo se rechaza | Abierto (calidad editorial) |
| 5 | El crítico detectó una contradicción real («la prohibición cubría la televisión vendida por separado» frente a la afirmación c2) | `critic-rejected: revise` | No se relaja; se conserva el rechazo y la evidencia | Abierto (calidad editorial) |

Tras corregir el defecto 3, la reevaluación del mismo run solo devuelve:

- `distinct-value-unsupported`.
- `critic-rejected` con la contradicción concreta.

Es decir: el artículo está **rechazado por calidad editorial**, no por un fallo del ledger, del parser o de la puerta de listas.

## 4. Lo que el canary demuestra

- El ledger registra el trabajo, el lease, las etapas y el coste en producción.
- El pipeline llega hasta el crítico y las puertas de publicación.
- Las puertas no se relajan para obtener un PASS: el artículo se rechaza y no se publica.
- La recuperación de un fallo de parseo y de un redactor sin JSON no requiere reiniciar el milestone ni borrar el trabajo.

## 4.1 Ejecución final tras corregir la puerta de listas

- Job: `2026-11-05T19:41:23.137Z-permanencia-television-pago-derechos-espana`.
- Resultado: `blocked`, 11 llamadas, 190.051 tokens de entrada, 64.601 de salida, **0,4869 USD** estimados.
- Revisión: `revise/re-research` y `revise/rewrite`; sin publicación.
- Hallazgos finales, todos editoriales y ninguno de ledger/parser/listas:
  - `figure-in-words`: «Multa de 6 millones de euros» escrito con letras en una tabla.
  - `no-distinct-value` y `distinct-value-unsupported`: solo se usó una entidad editora (CNMC) y el valor diferencial no quedó probado.
  - `invalid-length`: 486 palabras frente a 600–900 solicitadas.
- La puerta de listas ya no produce los falsos positivos «1.»–«4.» ni `content-not-reviewed-draft`.

## 5. Lo que no demuestra

- Que exista un artículo publicable con el modelo y el prompt actuales.
- Que la cancelación durante generación y la recuperación tras muerte del worker estén verificadas en producción (hay pruebas locales, no una ejecución real).
- Que la generación programada pueda reactivarse. Sigue en `enabled=false`.

## 6. Siguiente paso recomendado

1. Ajustar el prompt/estructura del valor diferencial para que el redactor declare un valor concreto y citable, o elegir un tema con datos propios de GuíaTV.
2. Repetir el canary y, si supera crítica y valor diferencial, verificar la publicación idempotente y el sitemap.
3. Solo entonces valorar la reactivación programada; no antes.
