# M05 — "Dónde verlo"

- **Nivel A** (partido concreto): ya existía (`airing`, `override`, `reconciliation` alta confianza) y se conserva sin cambios.
- **Nivel B** (operador oficial de la competición): implementado en `data/competition-rights.ts`. Solo se muestra si no hay Nivel A. Texto fijo: "Operador oficial de la competición. Canal de este partido pendiente de confirmar."
- Entradas: únicamente Europa League → Telefónica, ES, 2026/27, fuente UEFA indicada en el encargo. **No re-verificada por el sistema** en esta sesión.
- Territorio: España fijo; no se infiere por IP. Selector de país: no implementado.
- Tests: `competition-rights.spec.ts`. Sin test de componente para el bloque Nivel B (pendiente).
- Sin marca de tiempo de verificación en Nivel A/B (pendiente).
