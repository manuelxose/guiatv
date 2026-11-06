# M05 — Auditoría de proveedores (estado: BLOCKED parcial)

Evidencia de esta sesión (2026-11-05):
- Variables de entorno de credenciales para API-Football, Sportmonks, TheSportsDB o football-data.org: **no presentes** en el entorno de la sesión. No se ejecutó ninguna sonda autenticada.
- No se creó ninguna cuenta ni suscripción.
- No se consultó la documentación oficial de precios/licencias en esta sesión: **no se afirma ningún precio, cuota ni término de reutilización de imágenes**. Hay que verificarlos antes de decidir.

| Proveedor | Confirmado en repo | Confirmado por sonda | Pendiente |
|---|---|---|---|
| football-data.org | Adaptador `FootballDataOrgAdapter` (inactivo sin `FOOTBALL_DATA_API_KEY`); entrega `crest` y `emblem` | No (sin credencial) | Cobertura EL/UECL en el plan contratado (el feed observado en M04 tenía 13 competiciones, sin Europa League) |
| API-Football | Nada | No | Cobertura 2026/27, cuotas, licencia de logos |
| TheSportsDB | Nada | No | Artwork, endpoint de TV, restricciones free/premium |
| Sportmonks | Nada | No | Cobertura, TV stations por país, precio |

Decisión comercial requerida: elegir y contratar un proveedor con Europa/Conference League y aportar su credencial (`*_API_KEY`) como secreto de backend.
