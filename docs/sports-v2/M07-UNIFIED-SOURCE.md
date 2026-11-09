# M07: fuente única de fútbol servida desde nuestro servidor

Fecha: 2026-11-09. Complementa `M05-PROVIDER-RESEARCH.md` y `M05-DATA-LICENSING.md`.

## 1. Fuentes medidas hoy

| Fuente | Medición 2026-11-09 | Uso |
|---|---|---|
| OpenLigaDB `bl1/bl2/dfb` | Completo (`bl1`: 81/81 resultados) | **Ingerido**: Alemania, UECL |
| OpenLigaDB `la1` / `pl` | Incompleto: último resultado 26-oct / 31-oct | **Ingerido**, completado por footballdata.io |
| footballdata.io (plan free) | 1000 peticiones/**mes**, 5 ligas: La Liga (10), Premier (15), UCL (45), UEL (46), Mundial (50). Resultados, minuto en directo, estadísticas, tablas, escudos y logos | **Ingerido (M07)** |
| openfootball `2026-27` (CC0) | LaLiga 64/110 y Premier 45/100 resultados, último 20-sep | Descartado: peor que lo anterior |
| hudl/open-data (StatsBomb) | Último LaLiga 2020/21; nada 2025/26+ | Solo histórico; no ingerido |
| football-data.org (clave del propietario, plan free) | 13 competiciones, 10 req/min; tablas oficiales de Serie A, Ligue 1, Eredivisie, Primeira, Championship y Brasileirão | **Ingerido (M07)**: ventana de partidos, temporada completa y tablas |
| API-Football / TheSportsDB | Términos restrictivos (ver M05) | Descartados |

Escudos y logos: el propietario autorizó su uso el 2026-11-09.

## 2. Arquitectura implementada

```
OpenLigaDB ──tick (scheduler propio, sin cuota)──┐
                                                 ├─► football_snapshots (una fila por proveedor:partido)
footballdata.io ─tick (cuota durable 24/día)─────┘            │
        └─ diario (cuota durable 3/día): resultados+stats, tablas ─► football_standings_tables
                                                              ▼
                   SnapshotFootballDataProvider + FootballMatchMerge (fusión AL LEER)
                                                              ▼
                              /v2/sports/football/*  (la única fuente que ve el navegador)
```

- **Cada proveedor escribe solo lo suyo**: identidad `providerId:matchId`, nunca se pisan entre sí.
- **Fusión al leer** (`application/sports/services/FootballMatchMerge.ts`):
  - **Cuándo es el mismo partido**: misma competición, inicio con ±3 h de diferencia y los dos equipos coinciden. La comparación ignora tildes y palabras genéricas, y entiende los nombres en alemán de OpenLigaDB ("AC Mailand" = "AC Milan").
  - **Registro base**: el de OpenLigaDB, para que las URL existentes sigan funcionando.
  - **Estado y marcador**: gana la afirmación más fuerte. Por orden: resultado confirmado, minuto en directo, aplazamiento explícito, "en vivo" deducido por el reloj y, por último, "programado".
  - **Huecos**: escudo (se prefiere https), logo, estadio y estadísticas se completan con los otros proveedores.
  - **Eventos de gol**: solo se muestran si el marcador de su proveedor coincide con el mostrado.
  - **Límite de "en vivo"**: un "en vivo" sin minuto deja de serlo pasadas 3 h. El frontend muestra entonces **"Sin resultado"**.
- **Clasificación**: se sirve la tabla con más partidos contabilizados entre los proveedores.
- **Estadísticas**: el repositorio no las borra cuando una escritura del mismo proveedor llega sin ellas (`/matches` no las trae; `/fixtures/results` sí).
- **Atribución**: el aviso ODbL se mantiene literal, seguido del crédito a footballdata.io.
- **Escudos y logos servidos desde nuestro servidor** (`/v2/sports/football/image`):
  - **Origen:** solo hosts permitidos.
  - **Wikimedia:** se pide la miniatura de 120 px, con como mucho 2 peticiones simultáneas por host y 300 ms entre peticiones, porque devuelve 429 ante ráfagas.
  - **Caché:** en memoria y una copia en disco (`CREST_CACHE_DIR`, por defecto el tmp del sistema), que sobrevive a reinicios.
  - **Seguridad:** CSP `sandbox` para que un SVG no ejecute nada en nuestro dominio.
  - **Medido el 2026-11-09:** 140/141 escudos de resultados.
  - **Logos del catálogo:** 20/21 competiciones, con URLs verificadas en `FootballCompetitionCatalog.ts`. La Eurocopa queda sin logo.
- **Clasificaciones**:
  - Solo competiciones con datos (`hasData`) y formato de tabla (`hasTable`).
  - Las copas eliminatorias (DFB-Pokal, Copa del Rey…) y la Nations League (cuatro grupos) nunca muestran tabla.
- **Nations League A 2026** desde OpenLigaDB (`nla`), con selecciones y grupos en español.

## 3. Presupuesto de footballdata.io (nunca supera 1000/mes)

| Uso | Clave de cuota durable | Tope | Mes (31 días) |
|---|---|---|---|
| Ventana de partidos (`/matches`, hoy-2 a hoy+5, 5 ligas en 1 petición) | `footballdata-io` | 24/día | 744 |
| Resultados con estadísticas + tablas LaLiga/Premier | `footballdata-io:daily` | 3/día | 93 |
| Carga histórica (solo CLI manual) | `footballdata-io:backfill` | 12/día | ≤ 12 por ejecución |

Total máximo con una carga histórica: 849. Cadencia: en directo cada 25 min, antes del inicio cada hora, día de partido cada 3 h y en reposo cada 8 h. Un fallo abre el circuito 1 h, sin reintentos. Las cuotas se cuentan en MongoDB y fallan cerradas.

### football-data.org (10 peticiones/minuto, sin tope diario documentado)

| Uso | Clave de cuota durable | Tope |
|---|---|---|
| Ventana de partidos (`/matches`, hoy-2 a hoy+5, todas las competiciones en 1 petición) | `football-data-org` | 300/día |
| Tablas oficiales (10 competiciones) | `football-data-org:tables` | 40/día |
| Temporada completa (solo CLI) | `football-data-org:backfill` | 20/día |

El cliente separa las peticiones 6,5 s entre sí en todo el proceso, así que la ventana, las tablas y la carga de temporada nunca superan el límite por minuto. Atribución literal exigida: "Football data provided by the Football-Data.org API".

## 4. Puesta en producción

1. Añadir `FOOTBALLDATA_IO_API_KEY=<clave>` y `FOOTBALL_DATA_API_KEY=<clave>` a `/etc/guiatv/api.env` (nunca al repo ni a GitHub). Sin una clave, ese proveedor simplemente no se ingiere. `FOOTBALL_PUBLIC_SOURCE` debe seguir sin definir (lectura desde la base propia).
2. Desplegar (merge a `main` con CI en verde).
3. Una vez, en el servidor: `npm run job:football:backfill -w apps/backend -- 2026-08-01` (≈5 peticiones). Rellena los resultados que faltan desde agosto y refresca las tablas.
4. Comprobar: `/v2/sports/football/matches/live` no muestra partidos de días pasados, y `/v2/sports/football/competitions` trae logos.

## 5. Pendiente

- Copa del Rey e Hypermotion: ningún proveedor gratuito verificado; siguen como "sin datos".
- Diagnóstico del admin: solo muestra OpenLigaDB (el servicio primario). footballdata.io se ve en `football_quota` y `football_ingestion_runs`.
- La ventana lee una sola página (100 partidos). Si `pagination.total_pages > 1` aparece en semanas con mucha carga europea, hay que paginar.
