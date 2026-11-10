#!/bin/bash
# M15 editorial scheduler tick. Install as /usr/local/sbin/guiatv-editorial-cycle.sh with the root crontab line
#   */15 * * * * /usr/local/sbin/guiatv-editorial-cycle.sh
# It only asks the API. The API decides from Admin → Editorial whether a cycle is due (switch `enabled` and
# `scheduleHours`), records the tick (the panel shows the scheduler as stopped after two missed ticks) and starts the
# runner it supervises (idempotent if it already runs). Pausing generation in the Admin is enough; no cron edit.
set -euo pipefail
KEY=$(grep -E "^ANALYTICS_ADMIN_KEY=" /etc/guiatv/api.env | cut -d= -f2-)
curl -fsS -o /dev/null -m 30 -X POST -H "x-admin-key: ${KEY}" -H 'content-type: application/json' -d '{"mode":"automatic"}' \
  http://127.0.0.1:4000/v2/admin/editorial/generation/runner/process/start
