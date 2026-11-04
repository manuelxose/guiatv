# GuiaTV Monorepo

Guía de Programación TV — Angular SSR + Node.js API.

## Estructura

- `apps/frontend` — Angular SSR (puerto 3000)
- `apps/backend` — API Express (puerto 4000)

## Requisitos

- Node.js 22+
- MongoDB en `127.0.0.1:27017`
- Valkey/Redis en `127.0.0.1:6379` (opcional)

## Desarrollo

`npm run dev:frontend` inicia el frontend SSR en el puerto 3000. Utiliza el backend local del puerto 4000 cuando su `/v2/health` responde correctamente; en caso contrario, usa la API pública. La selección se comprueba para cada petición, sin reiniciar el frontend. `npm run dev:backend` inicia el backend local, que necesita MongoDB. Las operaciones enviadas a la API pública afectan a datos reales.

## Inicio rápido

```bash
# Instalar dependencias
npm install --workspaces --include-workspace-root --legacy-peer-deps

# Compilar todo
npm run build

# Inicializar BD (primera vez o rebuild)
npm run db:bootstrap

# Arrancar servicios
npm run start:api    # API en :4000
npm run start:ssr    # SSR en :3000
```

## Main scripts

| Script | Description |
|---|---|
| `npm run build` | Build backend + frontend SSR |
| `npm run build:backend` | Build backend only |
| `npm run build:frontend` | Build frontend SSR only |
| `npm run publish:release` | Publish one unified runtime release under `/var/www/guiatv/releases/<timestamp>` and repoint `/var/www/guiatv/current` |
| `npm run start:api` | Start the API |
| `npm run start:ssr` | Start the SSR server |
| `npm run db:bootstrap` | Create indexes + sync EPG + precompute |
| `npm run job:syncEPG` | Download and parse EPG data |
| `npm run job:precompute` | Precompute TV guide materializations |
| `npm run job:clean` | Clean old programs |
| `npm run deploy` | Build, publish a unified release, restart services, and run smoke checks |

## Configuración

Las variables de entorno se cargan automáticamente desde:
1. `/etc/guiatv/api.env` (producción)
2. `apps/backend/.env` (desarrollo local)

No es necesario hacer `source` manual del env file.

## VS Code Agent Images

El workspace incluye integración local con SiliconFlow para generación de imágenes en modo agente de VS Code.

- MCP server: `.vscode/mcp.json`
- Script: `tools/mcp/siliconflow-image-server.mjs`
- Tool disponible para agentes: `generate_image`
- Variables locales: `.env` y `.env.example`
- Repositorio central de imágenes generadas: `generated-assets/<proyecto>/`
- Modelo por defecto para imágenes: `black-forest-labs/FLUX.2-pro`

Flujo recomendado:
- Primero generar y guardar en `generated-assets/<proyecto>/`, que vive en la raíz del workspace al mismo nivel que `apps/`.
- Los proyectos pueden tener un enlace simbólico `generated-assets` que apunte a su subcarpeta dentro del repositorio central.
- Si la imagen se usa realmente en producto, guardar también una copia en los assets del proyecto correspondiente, por ejemplo `apps/frontend/src/assets/...`.
- El tool `generate_image` soporta `project` para la carpeta central y `assetOutputPath` para la copia final de producto.

## Unified release model

Production uses one shared runtime release for both services:

- active symlink: `/var/www/guiatv/current`
- release history: `/var/www/guiatv/releases/<timestamp>`

Both `guiatv-api` and `guiatv-ssr` must run from `current`. The frontend-specific release tree under `apps/frontend/releases` is no longer part of the production path.

See [docs/release-workflow.md](/var/www/guiatv/docs/release-workflow.md).

## Deploy

```bash
sudo ./deploy-guiatv.sh              # Deploy normal
sudo BOOTSTRAP_DB=1 ./deploy-guiatv.sh  # Con re-inicialización de BD
```

## Runtime

- **Env API**: `/etc/guiatv/api.env`
- **Env SSR**: `/etc/guiatv/ssr.env`
- **Storage**: `/var/lib/guiatv/storage`
- **Servicios**: `guiatv-api`, `guiatv-ssr` (systemd)

Analytics: configure `ANALYTICS_TRUSTED_PROXIES` with the exact IP addresses of
proxies that append a trustworthy X-Forwarded-For chain. Without this setting,
Analytics uses the direct socket address. Configure geography separately with
`ANALYTICS_GEO_TRUSTED_PROXIES` only for proxies that overwrite the CF headers.
For approximate city and coordinates, explicitly configure the direct proxy in
`ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES` as well. It must overwrite or remove
`CF-IPCity`, `CF-IPLatitude` and `CF-IPLongitude` on every request, including
when no location is available; never forward those headers from an untrusted
client unchanged. Cloudflare's “Add visitor location headers” managed transform
can supply these fields, provided the full proxy chain enforces that rule.
Coordinates are rounded to 0.1 degrees, are IP-based estimates and do not
identify a visitor's exact position. In Valkey, `ANALYTICS_PII=none` suppresses
geographic fields. Existing sessions are not retroactively located.

For Valkey, the 30-minute pages report uses a separate rolling event index and
session exclusion markers. It records whether each address matched the exclusion
policy, without storing client addresses or address hashes in this index. Configure excluded IPs
in `ANALYTICS_EXCLUDED_IPS` and trusted forwarding proxies before collecting
traffic. The report flags partial coverage after the index starts or reconnects,
and omits sessions whose original IP or administrator status cannot be verified.
When the exclusion list changes, older indexed sessions are marked partial and
omitted because their original addresses are not retained for re-evaluation.
During mixed-version deployments it also checks the older event log; if that log
is full or contains unindexed events, coverage is marked partial. Use a Valkey
configuration that does not evict analytics keys to preserve the rolling index.
Pre-existing daily aggregates cannot be corrected retrospectively by this index.
