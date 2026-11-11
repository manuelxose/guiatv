#!/usr/bin/env bash
# Retry one failed/cancelled manual request (the Admin "Reintentar" action) and start the runner manually.
#   ssh contabo "REQUEST_ID=<id> bash -s" < scripts/ops/editorial-retry-request.sh   (never prints the admin key)
set -euo pipefail
: "${REQUEST_ID:?REQUEST_ID is required}"
KEY=$(grep -E '^ANALYTICS_ADMIN_KEY=' /etc/guiatv/api.env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
API=http://127.0.0.1:4000/v2/admin/editorial/generation
post() { curl -sS -m 60 -X POST -H "x-admin-key: ${KEY}" -H 'content-type: application/json' -d "$2" "$API/$1"; echo; }
post "requests/${REQUEST_ID}/retry" '{}'
post runner/process/start '{"mode":"manual"}'
