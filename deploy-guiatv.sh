#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/var/www/guiatv}"
BRANCH="${1:-main}"
# Off-host build (deploy-artifact workflow): path and sha256 of the artifact, as arguments (sudo passes arguments, not variables).
DEPLOY_ARTIFACT="${2:-${DEPLOY_ARTIFACT:-}}"
DEPLOY_ARTIFACT_SHA256="${3:-${DEPLOY_ARTIFACT_SHA256:-}}"
SSR_PORT="3000"
API_PORT="4000"
BACKEND_BUILD_DIR="${APP_DIR}/apps/backend/dist"
FRONTEND_BUILD_DIR="${APP_DIR}/apps/frontend/dist/guiatv"
CURRENT_RELEASE_LINK="${APP_DIR}/current"

if [ "${EUID:-$(id -u)}" -ne 0 ] && [ "${DEPLOY_ALLOW_NON_ROOT:-0}" != "1" ]; then
  echo "Run as root"
  exit 1
fi

# One deploy at a time on this host. The workflow's concurrency group does not cover a manual run over SSH, and two
# builds at once on the 12 GB VPS are exactly the memory pressure the deploy must not create. Exit 75: nothing changed.
LOCK_FILE="${DEPLOY_LOCK_FILE:-/var/lock/guiatv-deploy.lock}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deploy is running (lock ${LOCK_FILE}); aborting without changes"
  exit 75
fi

wait_http() {
  local url="$1"
  local i
  for i in {1..30}; do
    local code
    code=$(curl --max-time 5 -s -o /dev/null -w "%{http_code}" "$url" || true)
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_backend_build() {
  if [ ! -f "${BACKEND_BUILD_DIR}/server/index.js" ]; then
    echo "Missing backend build output at ${BACKEND_BUILD_DIR}/server/index.js"
    exit 1
  fi
}

verify_frontend_build() {
  if [ ! -d "${FRONTEND_BUILD_DIR}/browser" ]; then
    echo "Missing browser build output at ${FRONTEND_BUILD_DIR}/browser"
    exit 1
  fi

  if [ ! -d "${FRONTEND_BUILD_DIR}/server" ]; then
    echo "Missing server build output at ${FRONTEND_BUILD_DIR}/server"
    exit 1
  fi

  if [ -z "$(find "${FRONTEND_BUILD_DIR}/browser" -type f -print -quit)" ]; then
    echo "Browser build output is empty"
    exit 1
  fi

  if [ -z "$(find "${FRONTEND_BUILD_DIR}/server" -type f -print -quit)" ]; then
    echo "Server build output is empty"
    exit 1
  fi

  if [ ! -f "${FRONTEND_BUILD_DIR}/server/main.server.mjs" ]; then
    echo "Missing SSR entrypoint ${FRONTEND_BUILD_DIR}/server/main.server.mjs"
    exit 1
  fi

  if [ ! -f "${FRONTEND_BUILD_DIR}/server/index.server.html" ]; then
    echo "Missing SSR HTML template ${FRONTEND_BUILD_DIR}/server/index.server.html"
    exit 1
  fi
}

verify_local_ssr_assets() {
  local html
  html="$(curl -fsS "http://127.0.0.1:${SSR_PORT}/")"

  mapfile -t assets < <(
    printf '%s' "${html}" \
      | grep -oE '(href|src)=\"[^"]+\.(js|mjs|css)\"' \
      | sed -E 's/^[^=]+=\"//; s/\"$//' \
      | sed -E 's#^(https?:)?//[^/]+##; s#^([^/])#/\1#' \
      | sort -u
  )

  if [ "${#assets[@]}" -eq 0 ]; then
    echo "SSR HTML does not reference JS/CSS assets"
    exit 1
  fi

  local asset code
  for asset in "${assets[@]}"; do
    code="$(curl --max-time 15 -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SSR_PORT}${asset}" || true)"
    if [ "${code}" != "200" ]; then
      echo "Referenced asset failed: ${asset} -> ${code}"
      exit 1
    fi
  done
}

smoke_http() {
  local url="$1"
  local expected="${2:-200}"
  local code attempt
  # Right after a restart the first uncached read can exceed the timeout (2026-10-20: discovery/home -> 000
  # while it answers in 0.2 s warm); retry so a cold cache does not roll back a healthy release.
  for attempt in 1 2 3; do
    code=$(curl --max-time 15 -s -o /dev/null -w "%{http_code}" "$url" || true)
    [ "$code" = "$expected" ] && return 0
    echo "Smoke attempt ${attempt}/3: $url -> $code (expected $expected)"
    [ "$attempt" -lt 3 ] && sleep "${SMOKE_RETRY_DELAY:-5}"
  done
  echo "Smoke check failed: $url -> $code (expected $expected)"
  exit 1
}

# Render the hub pages once, one at a time, so the first crawler after a deploy gets the SSR cache instead of
# racing several cold renders (2D-2C: six concurrent hub misses passed the 20 s render timeout -> 503).
# Never fails the deploy and never retries; only a 200 counts as warm (a 503 is the CSR fallback, not a render).
warm_ssr_hubs() {
  local path out code failed=0
  for path in / /canales /plataformas /programacion-tv/peliculas /programacion-tv/series \
    /programacion-tv/que-ver-hoy /programacion-tv/en-directo /guias /deportes/futbol /tendencias; do
    out=$(curl --max-time "${WARM_TIMEOUT:-25}" -s -o /dev/null -H "Host: guiaprogramaciontv.com" \
      -H "X-Forwarded-Proto: https" -w "%{http_code} %{time_total}" "http://127.0.0.1:${SSR_PORT}${path}" || true)
    code="${out%% *}"
    echo "SSR warm-up: ${path} -> ${out:-000}"
    [ "$code" = "200" ] || failed=$((failed + 1))
  done
  [ "$failed" -eq 0 ] || echo "WARN: SSR warm-up: ${failed} hub page(s) did not render 200 (non-fatal)"
}

smoke_auth_http() {
  local url="$1"
  local expected="${2:-200}"

  if [ -z "${SMOKE_AUTH_TOKEN:-}" ]; then
    echo "Skipping auth smoke: $url (SMOKE_AUTH_TOKEN not set)"
    return 0
  fi

  local code
  code=$(curl --max-time 15 -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${SMOKE_AUTH_TOKEN}" \
    "$url" || true)
  if [ "$code" != "$expected" ]; then
    echo "Auth smoke check failed: $url -> $code (expected $expected)"
    exit 1
  fi
}

smoke_socket_io() {
  if [ -z "${SMOKE_AUTH_TOKEN:-}" ]; then
    echo "Skipping Socket.IO smoke (SMOKE_AUTH_TOKEN not set)"
    return 0
  fi

  node <<'NODE'
const { io } = require('/var/www/guiatv/node_modules/socket.io-client');

const timeoutMs = 8000;
const socket = io('https://guiaprogramaciontv.com', {
  path: '/v2/ws',
  auth: { token: process.env.SMOKE_AUTH_TOKEN },
  transports: ['websocket'],
  timeout: timeoutMs,
  reconnection: false,
});

const timer = setTimeout(() => {
  console.error('Socket.IO smoke check timed out');
  process.exit(1);
}, timeoutMs + 1000);

socket.on('connect', () => {
  clearTimeout(timer);
  socket.close();
  process.exit(0);
});

socket.on('connect_error', (error) => {
  clearTimeout(timer);
  console.error(`Socket.IO smoke failed: ${error?.message || error}`);
  process.exit(1);
});
NODE
}

# What the build may cost the services that share this host (docs/ops/VPS-RELIABILITY-RUNBOOK.md). The pre-flight check
# aborts before anything changes; the heap cap and nice/ionice keep a build from starving mongod, valkey and the API.
available_mb() { awk '/MemAvailable/ { printf "%d", $2 / 1024 }' /proc/meminfo; }

guard_build_memory() {
  local need="${BUILD_MIN_AVAILABLE_MB:-3500}" have
  have="$(available_mb)"
  if [ "${have}" -lt "${need}" ]; then
    echo "Only ${have} MB of memory available, the build needs ${need}; aborting before building or publishing anything (BUILD_MIN_AVAILABLE_MB overrides)"
    exit 75
  fi
}

# BUILD_MEMORY_MAX (e.g. 5G) additionally confines the build to a cgroup, so an OOM kills the build, not mongod.
build_limited() {
  local -a runner=()
  command -v nice >/dev/null 2>&1 && runner+=(nice -n 10)
  command -v ionice >/dev/null 2>&1 && runner+=(ionice -c 3)
  if [ -n "${BUILD_MEMORY_MAX:-}" ] && command -v systemd-run >/dev/null 2>&1; then
    runner=(systemd-run --scope --quiet -p "MemoryMax=${BUILD_MEMORY_MAX}" -p MemorySwapMax=0 "${runner[@]}")
  fi
  NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP_MB:-3072}" "${runner[@]}" "$@"
}

# Commit the live release was built from, from its release.json (empty when unknown).
deployed_sha() {
  grep -o '"gitSha": *"[0-9a-f]\{40\}"' "${CURRENT_RELEASE_LINK}/release.json" 2>/dev/null | grep -o '[0-9a-f]\{40\}' | head -n1 || true
}

# Paths that never change what runs in production.
DOCS_ONLY_REGEX='^(docs/|graphify-out/|tasks/|design/|artifacts/|\.github/workflows/uptime\.yml$|scripts/(uptime-probe|canary-legacy-probe)\.|.*\.md$)'

PREVIOUS_RELEASE=""
PUBLISH_STARTED=0

# If anything fails once publishing has started, repoint `current` at the release that was live before and
# restart both services (see docs/release-workflow.md, "Rollback"). Failures before publishing change nothing.
rollback_on_failure() {
  local status=$?
  trap - EXIT
  if [ "${status}" -ne 0 ] && [ "${PUBLISH_STARTED}" = "1" ] && [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
    echo "Deploy failed (exit ${status}); rolling back to ${PREVIOUS_RELEASE}"
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_RELEASE_LINK}.rollback"
    mv -Tf "${CURRENT_RELEASE_LINK}.rollback" "${CURRENT_RELEASE_LINK}"
    systemctl restart guiatv-api guiatv-ssr || true
    wait_http "http://127.0.0.1:${API_PORT}/v2/health" || echo "Rollback: API did not recover"
    wait_http "http://127.0.0.1:${SSR_PORT}/" || echo "Rollback: SSR did not recover"
  fi
  exit "${status}"
}
trap rollback_on_failure EXIT

cd "${APP_DIR}"

# npm can rewrite the tracked lockfile during an install (another npm version, `dev`/`devOptional` flags, engine
# fields). The server never commits, so the committed lockfile is always the right one.
# Local GeoIP for analytics: installs/refreshes the update timer and, while no database exists yet, fetches one
# (DB-IP Lite without MaxMind credentials). Never fatal: analytics keep working without location.
ensure_geoip() {
  [ "${GEOIP_AUTO_SETUP:-1}" = "1" ] || return 0
  local unit_dir="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}" geoip_dir="${GEOIP_DIR:-/var/lib/GeoIP}" changed=0 unit
  [ -d "${unit_dir}" ] || return 0
  for unit in guiatv-geoip-update.service guiatv-geoip-update.timer; do
    [ -f "infra/systemd/${unit}" ] || return 0
    if ! cmp -s "infra/systemd/${unit}" "${unit_dir}/${unit}"; then
      install -m 0644 "infra/systemd/${unit}" "${unit_dir}/${unit}" && changed=1 || { echo "WARN: GeoIP: could not install ${unit}"; return 0; }
    fi
  done
  [ "${changed}" = "1" ] && systemctl daemon-reload
  systemctl enable --now guiatv-geoip-update.timer >/dev/null 2>&1 || echo "WARN: GeoIP: could not enable the update timer"
  if ! compgen -G "${geoip_dir}/*.mmdb" >/dev/null; then
    echo "GeoIP: no database yet; downloading one (analytics locations)"
    if timeout "${GEOIP_FIRST_FETCH_TIMEOUT:-300}" systemctl start guiatv-geoip-update.service; then
      echo "GeoIP: database installed"
    else
      echo "WARN: GeoIP: first download failed; sessions stay without location (journalctl -u guiatv-geoip-update)"
    fi
  fi
  return 0
}

restore_lockfile() {
  if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1 && ! git diff --quiet -- package-lock.json; then
    echo "npm rewrote package-lock.json; restoring the committed lockfile"
    git checkout -- package-lock.json
  fi
}

install_dependencies() {
  guard_build_memory
  build_limited npm install --workspaces --include-workspace-root --legacy-peer-deps --no-audit --no-fund
  restore_lockfile
  [ -z "${LOCK_SHA}" ] || echo "${LOCK_SHA}" >"${LOCK_STAMP}"
}

SYNCED=0
# A dirty checkout used to be deployed as is ("Deploying current checkout without git sync"): runs 69, 70 and 72
# (2026-11-04/05) reported success while rebuilding the old commit. Now a rewritten lockfile is restored, and any
# other local change fails the deploy loudly unless DEPLOY_ALLOW_DIRTY=1 (an explicit, manual decision).
restore_lockfile
if git diff --quiet && git diff --cached --quiet; then
  git fetch --prune origin
  git checkout "${BRANCH}"
  # The server never commits here, so align with the remote even when its history was rewritten
  # (a plain fast-forward pull fails after a force-push and used to block every deploy).
  TARGET_REF="origin/${BRANCH}"
  if [ -n "${DEPLOY_ARTIFACT:-}" ] && [ -f "${DEPLOY_ARTIFACT}" ]; then
    # An artifact is deployed at the exact commit it was built from (main may already be ahead when deploys queue).
    ARTIFACT_SHA="$(tar -xzOf "${DEPLOY_ARTIFACT}" ARTIFACT_GIT_SHA 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "${ARTIFACT_SHA}" =~ ^[0-9a-f]{40}$ ]] && git merge-base --is-ancestor "${ARTIFACT_SHA}" "origin/${BRANCH}" 2>/dev/null; then
      TARGET_REF="${ARTIFACT_SHA}"
    else
      echo "Artifact commit ${ARTIFACT_SHA:-unknown} is not on origin/${BRANCH}; refusing"
      exit 1
    fi
  fi
  git reset --hard "${TARGET_REF}"
  SYNCED=1
elif [ "${DEPLOY_ALLOW_DIRTY:-0}" = "1" ]; then
  echo "Working tree has local changes; DEPLOY_ALLOW_DIRTY=1, deploying the current checkout without git sync."
else
  echo "Working tree has local changes; refusing to deploy a checkout that is not origin/${BRANCH}:"
  git status --short
  echo "Inspect them (git -C ${APP_DIR} diff), then stash or discard them, or rerun with DEPLOY_ALLOW_DIRTY=1."
  exit 1
fi

# A deploy of what is already live, or of documentation only, would still build and restart the services.
# FORCE_DEPLOY=1 overrides (e.g. to rebuild after a dependency or environment change).
if [ "${SYNCED}" = "1" ] && [ "${FORCE_DEPLOY:-0}" != "1" ]; then
  LIVE_SHA="$(deployed_sha)"
  if [ -n "${LIVE_SHA}" ] && git cat-file -e "${LIVE_SHA}^{commit}" 2>/dev/null; then
    TARGET_SHA="$(git rev-parse HEAD)"
    if [ "${LIVE_SHA}" = "${TARGET_SHA}" ]; then
      echo "Release ${TARGET_SHA} is already live; nothing to deploy (FORCE_DEPLOY=1 overrides)"
      exit 0
    fi
    CHANGED_FILES="$(git diff --name-only "${LIVE_SHA}" "${TARGET_SHA}")"
    # A here-string, not a pipe: under pipefail an early-exiting `grep -q` could SIGPIPE the producer and read as "docs only".
    if ! grep -qxF 'docs/seo/editorial-drafts/publish.json' <<<"${CHANGED_FILES}" && ! grep -qvE "${DOCS_ONLY_REGEX}" <<<"${CHANGED_FILES}"; then
      echo "Only documentation changed between ${LIVE_SHA} and ${TARGET_SHA}; no build, no restart (FORCE_DEPLOY=1 overrides)"
      exit 0
    fi
  fi
fi

# Dependencies change rarely: reinstall only when the lockfile does (or node_modules is missing).
LOCK_STAMP="${APP_DIR}/.deploy-lock-sha256"
LOCK_SHA="$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1 || true)"

if [ -n "${DEPLOY_ARTIFACT:-}" ]; then
  # Built off-host (CI) from this exact commit: verify, unpack, publish. Never compiled here.
  [ -f "${DEPLOY_ARTIFACT}" ] || { echo "Artifact ${DEPLOY_ARTIFACT} not found"; exit 1; }
  [ -n "${DEPLOY_ARTIFACT_SHA256:-}" ] || { echo "DEPLOY_ARTIFACT_SHA256 is required with DEPLOY_ARTIFACT"; exit 1; }
  echo "${DEPLOY_ARTIFACT_SHA256}  ${DEPLOY_ARTIFACT}" | sha256sum -c --quiet - || { echo "Artifact checksum mismatch"; exit 1; }
  # An artifact carries no node_modules: when the lockfile changed, install the runtime dependencies first (an
  # install only, under the same memory guard; no compile), so dependency changes deploy automatically too.
  if [ -n "${LOCK_SHA}" ] && { [ ! -f "${LOCK_STAMP}" ] || [ "$(cat "${LOCK_STAMP}")" != "${LOCK_SHA}" ]; }; then
    echo "package-lock.json changed since the last install; installing dependencies (no build)"
    install_dependencies
  fi
  ARTIFACT_DIR="${APP_DIR}/.artifact-incoming"
  rm -rf "${ARTIFACT_DIR}"
  mkdir -p "${ARTIFACT_DIR}"
  tar -xzf "${DEPLOY_ARTIFACT}" -C "${ARTIFACT_DIR}"
  [ "$(cat "${ARTIFACT_DIR}/ARTIFACT_GIT_SHA" 2>/dev/null)" = "$(git rev-parse HEAD)" ] || { rm -rf "${ARTIFACT_DIR}"; echo "Artifact was not built from the checked-out commit"; exit 1; }
  rm -rf "${BACKEND_BUILD_DIR}" "${FRONTEND_BUILD_DIR}"
  mkdir -p "$(dirname "${BACKEND_BUILD_DIR}")" "$(dirname "${FRONTEND_BUILD_DIR}")"
  mv "${ARTIFACT_DIR}/apps/backend/dist" "${BACKEND_BUILD_DIR}"
  mv "${ARTIFACT_DIR}/apps/frontend/dist/guiatv" "${FRONTEND_BUILD_DIR}"
  rm -rf "${ARTIFACT_DIR}"
else
  guard_build_memory
  if [ -n "${LOCK_SHA}" ] && [ -d node_modules ] && [ -f "${LOCK_STAMP}" ] && [ "$(cat "${LOCK_STAMP}")" = "${LOCK_SHA}" ]; then
    echo "package-lock.json unchanged since the last install; skipping npm install"
  else
    install_dependencies
  fi
  build_limited npm run build
fi
verify_backend_build
verify_frontend_build
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_RELEASE_LINK}" 2>/dev/null || true)"
PUBLISH_STARTED=1
npm run publish:release

if [ "${BOOTSTRAP_DB:-0}" = "1" ]; then
  npm run db:bootstrap
fi

ensure_geoip
systemctl daemon-reload
systemctl restart guiatv-api
wait_http "http://127.0.0.1:${API_PORT}/v2/health"
smoke_http "http://127.0.0.1:${API_PORT}/v2/discovery/home" "200"
smoke_http "http://127.0.0.1:${API_PORT}/v2/discovery/browse?type=movie&availability=streaming&limit=1" "200"
smoke_http "http://127.0.0.1:${API_PORT}/v2/tv/surface/guide?date=$(date +%F)&group=tdt" "200"
smoke_http "http://127.0.0.1:${API_PORT}/v2/tv/surface/channels/la_2?date=$(date +%F)" "200"
smoke_http "http://127.0.0.1:${API_PORT}/v2/catalog/platforms" "200"
smoke_http "http://127.0.0.1:${API_PORT}/v2/sports/football/competitions" "200"
smoke_auth_http "http://127.0.0.1:${API_PORT}/v2/discovery/for-you" "200"
smoke_auth_http "http://127.0.0.1:${API_PORT}/v2/user/interactions" "200"

systemctl restart guiatv-ssr
wait_http "http://127.0.0.1:${SSR_PORT}/"
verify_local_ssr_assets
smoke_http "http://127.0.0.1:${SSR_PORT}/" "200"
smoke_http "http://127.0.0.1:${SSR_PORT}/programacion-tv/en-directo" "200"
smoke_http "http://127.0.0.1:${SSR_PORT}/canales/la-2" "200"
smoke_http "http://127.0.0.1:${SSR_PORT}/guias" "200"
# 2026-10-20 URL restructure: the old paths must stay permanent redirects (docs/seo/redirect-map.csv).
smoke_http "http://127.0.0.1:${SSR_PORT}/programacion-tv/guia-canales" "301"
smoke_http "http://127.0.0.1:${SSR_PORT}/canales/la_2" "301"
smoke_http "http://127.0.0.1:${SSR_PORT}/editorial" "301"
smoke_http "http://127.0.0.1:${SSR_PORT}/plataformas" "200"
smoke_http "http://127.0.0.1:${SSR_PORT}/deportes/futbol" "200"
smoke_socket_io
warm_ssr_hubs

# Tell Google about the new release's sitemaps (URLs may have moved). Never fails the deploy: without
# GSC_AUTO_SUBMIT_ENABLED / the service-account file it logs "skipped"; the daily precompute job submits too.
npm run seo:submit-sitemap -w apps/backend || echo "Search Console sitemap submit failed (non-fatal)"

echo "Unified release active: $(readlink -f "${CURRENT_RELEASE_LINK}")"
