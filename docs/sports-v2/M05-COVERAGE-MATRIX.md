# M05 — Matriz de cobertura

Catálogo canónico backend (`FootballCompetitionCatalog.ts`) ya incluye: laliga, laliga-hypermotion, copa-del-rey, champions-league, europa-league, conference-league, premier-league, serie-a, bundesliga, ligue-1, selección española, eurocopa, mundial, nations-league. **Primeira Liga y Eredivisie no están en el catálogo** (pendiente).

| Dimensión | Estado |
|---|---|
| Catálogo declara Europa League | Sí (catálogo), pero el feed del proveedor activo no la sirve (observado en M04) |
| Fixtures Europa League 2026-11-05 (Celta–Union SG, Real Sociedad–Lyon, Milan–Ferencváros, Celtic–Beşiktaş) | **BLOCKED**: sin proveedor autorizado que las cubra; no hay respuesta real que valide. Un mock no cuenta. |
| Multiproveedor / deduplicación / procedencia por campo | **No implementado en M05** (ver M05-DELIVERY) |
