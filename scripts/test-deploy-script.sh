#!/bin/bash
# Integration check for deploy-guiatv.sh and guiatv-ops.sh in a throwaway sandbox (real git, stubbed npm/systemctl/curl):
#   1. the server checkout is aligned with origin even after the remote history was rewritten (force-push);
#   2. a smoke failure after publishing rolls `current` back to the previous release and restarts both services;
#   3. one deploy at a time (lock), and a build that would starve the host is refused before any change;
#   4. a deploy of what is live, or of documentation only, builds and restarts nothing;
#   5. an off-host artifact is verified (checksum, commit) and published without installing or compiling; an install
#      that rewrites the lockfile leaves the checkout clean, so the next deploy still syncs with origin;
#   6. the ops script rolls back to the previous release and verifies the services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "${T}"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- sandbox: origin, a pusher clone and the "server" checkout --------------------------------------------------
git init -q --bare -b main "${T}/origin.git"
git clone -q "${T}/origin.git" "${T}/work"
(cd "${T}/work" && echo one >f && git add f && git commit -qm one && git push -q origin main)
git clone -q "${T}/origin.git" "${T}/srv"
SRV="${T}/srv"
mkdir -p "${SRV}/apps/backend/dist/server" "${SRV}/apps/frontend/dist/guiatv/browser" "${SRV}/apps/frontend/dist/guiatv/server" "${SRV}/releases/R1" "${T}/bin"
touch "${SRV}/apps/backend/dist/server/index.js" "${SRV}/apps/frontend/dist/guiatv/browser/main.js" \
      "${SRV}/apps/frontend/dist/guiatv/server/main.server.mjs" "${SRV}/apps/frontend/dist/guiatv/server/index.server.html"
ln -sfn "${SRV}/releases/R1" "${SRV}/current"

# --- stubs ------------------------------------------------------------------------------------------------------
cat >"${T}/bin/npm" <<'EOF'
#!/bin/bash
echo "$*" >>"${NPM_LOG:-/dev/null}"
# Like npm 10 on the VPS: an install rewrites the lockfile it was given.
if [ "$1" = "install" ] && [ -f package-lock.json ]; then echo '"devOptional": true' >>package-lock.json; fi
if [ "$1 $2" = "run publish:release" ]; then
  n=$(( $(ls "${APP_DIR}/releases" | wc -l) + 1 ))
  mkdir -p "${APP_DIR}/releases/R${n}"
  ln -sfn "${APP_DIR}/releases/R${n}" "${APP_DIR}/current"
fi
exit 0
EOF
cat >"${T}/bin/systemctl" <<'EOF'
#!/bin/bash
echo "$*" >>"${SYSTEMCTL_LOG}"
EOF
cat >"${T}/bin/curl" <<'EOF'
#!/bin/bash
for a in "$@"; do
  if [ "$a" = "-fsS" ]; then echo '<script src="/main.js"></script>'; exit 0; fi
done
if [ -e "${FAIL_FLAG}" ] && [ "$(basename "$(readlink -f "${APP_DIR}/current")")" = "${FAIL_RELEASE}" ]; then echo 500; exit 0; fi
# Cold start: the first discovery/home call of a run times out (000), like production on 2026-10-20.
case "${*: -1}" in */v2/discovery/home) [ -e "${COLD_FLAG}" ] || { touch "${COLD_FLAG}"; echo 000; exit 0; } ;; esac
# A hub page whose render falls back (503) during the warm-up: visible, never counted as warm, never fatal.
case "${*: -1}" in */tendencias) echo 503; exit 0 ;; esac
# Legacy public paths answer like the real SSR server: a permanent redirect.
case "${*: -1}" in */programacion-tv/guia-canales|*/canales/*_*|*/editorial) echo 301 ;; *) echo 200 ;; esac
EOF
chmod +x "${T}/bin/"*
export PATH="${T}/bin:${PATH}" APP_DIR="${SRV}" DEPLOY_ALLOW_NON_ROOT=1 SYSTEMCTL_LOG="${T}/systemctl.log" FAIL_FLAG="${T}/fail" FAIL_RELEASE=none COLD_FLAG="${T}/cold" SMOKE_RETRY_DELAY=0 NPM_LOG="${T}/npm.log" DEPLOY_LOCK_FILE="${T}/deploy.lock" BUILD_MIN_AVAILABLE_MB=1 OPS_POLL_DELAY=0
: >"${SYSTEMCTL_LOG}"

# --- 1. remote history rewritten after the server last synced --------------------------------------------------
(cd "${T}/work" && git commit -q --amend -m "one (rewritten)" && git push -q --force origin main)
git -C "${SRV}" fetch -q origin
if git -C "${SRV}" merge-base --is-ancestor HEAD origin/main; then fail "setup: history was not rewritten"; fi
git -C "${SRV}" reset -q --hard HEAD # only fetched; the deploy script does the real sync
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run1.log" 2>&1 || { cat "${T}/run1.log"; fail "deploy must succeed after a history rewrite"; }
[ "$(git -C "${SRV}" rev-parse HEAD)" = "$(git -C "${T}/origin.git" rev-parse main)" ] || fail "server checkout not aligned with origin/main"
[ "$(basename "$(readlink -f "${SRV}/current")")" = "R2" ] || fail "release R2 was not activated"
grep -q "SSR warm-up: /programacion-tv/que-ver-hoy -> 200" "${T}/run1.log" || fail "hub pages not warmed after the SSR restart"
grep -q "SSR warm-up: /tendencias -> 503" "${T}/run1.log" || fail "a failed warm-up render is not reported"
grep -q "WARN: SSR warm-up: 1 hub page(s) did not render 200" "${T}/run1.log" || fail "a 503 warm-up was counted as a render"

# --- 2. smoke fails on the new release: roll back to R2 --------------------------------------------------------
touch "${FAIL_FLAG}"
export FAIL_RELEASE=R3
if bash "${ROOT}/deploy-guiatv.sh" >"${T}/run2.log" 2>&1; then fail "deploy must fail when the smoke check fails"; fi
[ "$(basename "$(readlink -f "${SRV}/current")")" = "R2" ] || { cat "${T}/run2.log"; fail "did not roll back to R2"; }
grep -q "rolling back" "${T}/run2.log" || fail "rollback not announced"
[ "$(grep -c 'restart guiatv-api guiatv-ssr' "${SYSTEMCTL_LOG}")" -ge 1 ] || fail "services not restarted after rollback"

# --- 3. one deploy at a time; a build that would starve the host is refused ---------------------------------------
rm -f "${FAIL_FLAG}"
export FAIL_RELEASE=none
live="$(readlink -f "${SRV}/current")"
: >"${T}/npm.log"
( exec 8>"${DEPLOY_LOCK_FILE}"; flock 8; exec sleep 5 ) & # exec: killing the holder must release the lock at once, not after the sleep
holder=$!
sleep 0.5
set +e; bash "${ROOT}/deploy-guiatv.sh" >"${T}/run3.log" 2>&1; code=$?; set -e
kill "${holder}" 2>/dev/null || true; wait "${holder}" 2>/dev/null || true
[ "${code}" = "75" ] || { cat "${T}/run3.log"; fail "a second deploy must exit 75 while one holds the lock (got ${code})"; }
grep -q "Another deploy is running" "${T}/run3.log" || fail "lock refusal not announced"
[ "$(readlink -f "${SRV}/current")" = "${live}" ] && [ ! -s "${T}/npm.log" ] || fail "a refused deploy changed something"

set +e; BUILD_MIN_AVAILABLE_MB=999999999 bash "${ROOT}/deploy-guiatv.sh" >"${T}/run4.log" 2>&1; code=$?; set -e
[ "${code}" = "75" ] || { cat "${T}/run4.log"; fail "low memory must exit 75 (got ${code})"; }
grep -q "the build needs" "${T}/run4.log" || fail "memory refusal not announced"
[ "$(readlink -f "${SRV}/current")" = "${live}" ] && ! grep -q "run build" "${T}/npm.log" || fail "a memory-refused deploy built or published"

# --- 4. already live / documentation only: no build, no restart -------------------------------------------------
(cd "${T}/work" && echo runtime >f && git commit -qam "runtime change" && git push -q origin main)
: >"${T}/npm.log"
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run5.log" 2>&1 || { cat "${T}/run5.log"; fail "runtime deploy must succeed"; }
grep -q "run build" "${T}/npm.log" || fail "a runtime change was not built"
grep -q "NODE_OPTIONS" "${ROOT}/deploy-guiatv.sh" || fail "the build is not heap-limited"
live="$(readlink -f "${SRV}/current")"
printf '{"gitSha": "%s"}\n' "$(git -C "${SRV}" rev-parse HEAD)" >"${live}/release.json"
: >"${T}/npm.log"; : >"${SYSTEMCTL_LOG}"
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run6.log" 2>&1 || { cat "${T}/run6.log"; fail "redeploying the live commit must be a clean no-op"; }
grep -q "is already live" "${T}/run6.log" || fail "an already-live release was not recognised"
[ ! -s "${T}/npm.log" ] && [ ! -s "${SYSTEMCTL_LOG}" ] || fail "an already-live release built or restarted something"
mkdir -p "${T}/work/docs" && (cd "${T}/work" && echo notes >docs/note.md && git add docs && git commit -qm "docs only" && git push -q origin main)
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run7.log" 2>&1 || { cat "${T}/run7.log"; fail "a docs-only push must exit cleanly"; }
grep -q "Only documentation changed" "${T}/run7.log" || { cat "${T}/run7.log"; fail "docs-only change not recognised"; }
[ ! -s "${T}/npm.log" ] && [ ! -s "${SYSTEMCTL_LOG}" ] && [ "$(readlink -f "${SRV}/current")" = "${live}" ] || fail "a docs-only change built, restarted or switched release"
FORCE_DEPLOY=1 bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8.log" 2>&1 || { cat "${T}/run8.log"; fail "FORCE_DEPLOY must deploy"; }
grep -q "run build" "${T}/npm.log" || fail "FORCE_DEPLOY did not build"

# --- 5. off-host artifact: verified and published, never compiled here -------------------------------------------
(cd "${T}/work" && echo lock1 >package-lock.json && git add package-lock.json && git commit -qm "lock 1" && git push -q origin main)
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8b.log" 2>&1 || { cat "${T}/run8b.log"; fail "deploy with a lockfile must succeed"; }
[ -f "${SRV}/.deploy-lock-sha256" ] || fail "the lockfile hash was not recorded after the install"
git -C "${SRV}" diff --quiet || { git -C "${SRV}" status --short; fail "npm's lockfile rewrite left the checkout dirty (the next deploy would skip the git sync)"; }
grep -q "restoring the committed lockfile" "${T}/run8b.log" || fail "the lockfile restore was not announced"
: >"${T}/npm.log"
(cd "${T}/work" && echo lock2 >package-lock.json && git commit -qam "lock 2" && git push -q origin main)
sha="$(git -C "${T}/origin.git" rev-parse main)"
mkdir -p "${T}/lockart/apps/backend/dist/server" "${T}/lockart/apps/frontend/dist/guiatv/browser" "${T}/lockart/apps/frontend/dist/guiatv/server"
touch "${T}/lockart/apps/backend/dist/server/index.js" "${T}/lockart/apps/frontend/dist/guiatv/browser/main.js" "${T}/lockart/apps/frontend/dist/guiatv/server/main.server.mjs" "${T}/lockart/apps/frontend/dist/guiatv/server/index.server.html"
echo "${sha}" >"${T}/lockart/ARTIFACT_GIT_SHA"; tar -czf "${T}/lockart.tgz" -C "${T}/lockart" ARTIFACT_GIT_SHA apps
live="$(readlink -f "${SRV}/current")"
# A dependency change deploys automatically too: the artifact installs the new lockfile (no build) and publishes.
DEPLOY_ARTIFACT="${T}/lockart.tgz" DEPLOY_ARTIFACT_SHA256="$(sha256sum "${T}/lockart.tgz" | cut -d' ' -f1)" bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8c.log" 2>&1 || { cat "${T}/run8c.log"; fail "an artifact over a changed lockfile must install and deploy"; }
grep -q "installing dependencies (no build)" "${T}/run8c.log" || { cat "${T}/run8c.log"; fail "the changed lockfile was not installed in artifact mode"; }
grep -q "^install" "${T}/npm.log" || fail "the changed lockfile was not installed"
! grep -q "run build" "${T}/npm.log" || fail "artifact mode compiled on the server"
[ "$(readlink -f "${SRV}/current")" != "${live}" ] || fail "the artifact release over a changed lockfile was not activated"
[ "$(git -C "${SRV}" rev-parse HEAD)" = "${sha}" ] || fail "artifact deploy is not at the artifact commit"
git -C "${SRV}" diff --quiet || fail "the checkout is dirty after a lockfile install"
: >"${T}/npm.log"

# --- 5b. main moved on after the artifact was built: deploy the artifact's commit, never a mismatch ------------
art_old_sha="$(git -C "${T}/origin.git" rev-parse main)"
(cd "${T}/work" && echo third >f && git commit -qam "newer commit on main" && git push -q origin main)
oldart="${T}/oldart"; mkdir -p "${oldart}/apps/backend/dist/server" "${oldart}/apps/frontend/dist/guiatv/browser" "${oldart}/apps/frontend/dist/guiatv/server"
touch "${oldart}/apps/backend/dist/server/index.js" "${oldart}/apps/frontend/dist/guiatv/browser/main.js" "${oldart}/apps/frontend/dist/guiatv/server/main.server.mjs" "${oldart}/apps/frontend/dist/guiatv/server/index.server.html"
echo "${art_old_sha}" >"${oldart}/ARTIFACT_GIT_SHA"; tar -czf "${T}/oldart.tgz" -C "${oldart}" ARTIFACT_GIT_SHA apps
FORCE_DEPLOY=1 DEPLOY_ARTIFACT="${T}/oldart.tgz" DEPLOY_ARTIFACT_SHA256="$(sha256sum "${T}/oldart.tgz" | cut -d' ' -f1)" bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8e.log" 2>&1 || { cat "${T}/run8e.log"; fail "an artifact of an older main commit must deploy at that commit"; }
[ "$(git -C "${SRV}" rev-parse HEAD)" = "${art_old_sha}" ] || fail "the server checkout is not at the artifact's commit"

# --- 5c. a dirty checkout is never deployed silently ------------------------------------------------------------
echo "hand edit" >>"${SRV}/f"
live="$(readlink -f "${SRV}/current")"; : >"${T}/npm.log"
set +e; bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8f.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] && grep -q "refusing to deploy a checkout that is not origin/main" "${T}/run8f.log" && grep -q " M f" "${T}/run8f.log" || { cat "${T}/run8f.log"; fail "a dirty checkout must fail loudly and list the files"; }
[ "$(readlink -f "${SRV}/current")" = "${live}" ] && ! grep -q "run build" "${T}/npm.log" || fail "a refused dirty deploy built or switched release"
DEPLOY_ALLOW_DIRTY=1 bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8g.log" 2>&1 || { cat "${T}/run8g.log"; fail "DEPLOY_ALLOW_DIRTY=1 must deploy the checkout as is"; }
grep -q "DEPLOY_ALLOW_DIRTY=1" "${T}/run8g.log" || fail "the dirty override was not announced"
git -C "${SRV}" checkout -q -- f
# Only a rewritten lockfile: restored automatically and the deploy syncs.
echo '"devOptional": true' >>"${SRV}/package-lock.json"
bash "${ROOT}/deploy-guiatv.sh" >"${T}/run8h.log" 2>&1 || { cat "${T}/run8h.log"; fail "a deploy over a rewritten lockfile must restore it and sync"; }
grep -q "HEAD is now at" "${T}/run8h.log" || { cat "${T}/run8h.log"; fail "the deploy over a rewritten lockfile did not sync"; }
git -C "${SRV}" diff --quiet || fail "the rewritten lockfile was not restored"
(cd "${T}/work" && echo second >f && git commit -qam "runtime change 2" && git push -q origin main)
sha="$(git -C "${T}/origin.git" rev-parse main)"
art="${T}/art"; mkdir -p "${art}/apps/backend/dist/server" "${art}/apps/frontend/dist/guiatv/browser" "${art}/apps/frontend/dist/guiatv/server"
touch "${art}/apps/backend/dist/server/index.js" "${art}/apps/frontend/dist/guiatv/browser/main.js" "${art}/apps/frontend/dist/guiatv/server/main.server.mjs" "${art}/apps/frontend/dist/guiatv/server/index.server.html"
echo "${sha}" >"${art}/ARTIFACT_GIT_SHA"
tar -czf "${T}/artifact.tgz" -C "${art}" ARTIFACT_GIT_SHA apps
asum="$(sha256sum "${T}/artifact.tgz" | cut -d' ' -f1)"
live="$(readlink -f "${SRV}/current")"; : >"${T}/npm.log"
set +e; DEPLOY_ARTIFACT="${T}/artifact.tgz" DEPLOY_ARTIFACT_SHA256="$(printf '0%.0s' {1..64})" bash "${ROOT}/deploy-guiatv.sh" >"${T}/run9.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] && grep -q "checksum mismatch" "${T}/run9.log" && [ "$(readlink -f "${SRV}/current")" = "${live}" ] || fail "a corrupt artifact must be refused before any change"
echo "0000000000000000000000000000000000000000" >"${art}/ARTIFACT_GIT_SHA"; tar -czf "${T}/stale.tgz" -C "${art}" ARTIFACT_GIT_SHA apps
set +e; DEPLOY_ARTIFACT="${T}/stale.tgz" DEPLOY_ARTIFACT_SHA256="$(sha256sum "${T}/stale.tgz" | cut -d' ' -f1)" bash "${ROOT}/deploy-guiatv.sh" >"${T}/run10.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] && grep -qE "not built from the checked-out commit|is not on origin/main; refusing" "${T}/run10.log" && [ "$(readlink -f "${SRV}/current")" = "${live}" ] || fail "an artifact from another commit must be refused"
DEPLOY_ARTIFACT="${T}/artifact.tgz" DEPLOY_ARTIFACT_SHA256="${asum}" bash "${ROOT}/deploy-guiatv.sh" >"${T}/run11.log" 2>&1 || { cat "${T}/run11.log"; fail "a valid artifact must deploy"; }
[ "$(readlink -f "${SRV}/current")" != "${live}" ] || fail "the artifact release was not activated"
! grep -qE "run build|^install" "${T}/npm.log" || { cat "${T}/npm.log"; fail "artifact mode installed or compiled on the server"; }

# --- 6. ops script: rollback to the previous release, verified -----------------------------------------------------
now_live="$(basename "$(readlink -f "${SRV}/current")")"
: >"${SYSTEMCTL_LOG}"
bash "${ROOT}/scripts/guiatv-ops.sh" rollback >"${T}/ops1.log" 2>&1 || { cat "${T}/ops1.log"; fail "ops rollback must succeed"; }
[ "$(basename "$(readlink -f "${SRV}/current")")" != "${now_live}" ] || fail "ops rollback did not move current"
grep -q "restart guiatv-api" "${SYSTEMCTL_LOG}" && grep -q "restart guiatv-ssr" "${SYSTEMCTL_LOG}" || fail "ops rollback did not restart both services"
grep -q "verified: release" "${T}/ops1.log" || fail "ops rollback did not verify health"
set +e; bash "${ROOT}/scripts/guiatv-ops.sh" rollback not-a-release >"${T}/ops2.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] || fail "rolling back to a release that does not exist must fail"
bash "${ROOT}/scripts/guiatv-ops.sh" status >"${T}/ops3.log" 2>&1 || fail "ops status must work"

# --- 7. rollback simulation with the production release ids (sandbox only, not evidence of a live rollback) ------------
rm -rf "${SRV}/releases" && mkdir -p "${SRV}/releases"
for r in 20261021190805 20261021195307 20261021205747 20261022010257 20261022103818; do mkdir -p "${SRV}/releases/${r}"; done
ln -sfn "${SRV}/releases/20261022103818" "${SRV}/current"
bash "${ROOT}/scripts/guiatv-ops.sh" rollback >"${T}/ops4.log" 2>&1 || { cat "${T}/ops4.log"; fail "production-shaped rollback must succeed"; }
[ "$(basename "$(readlink -f "${SRV}/current")")" = "20261022010257" ] || fail "default rollback must pick the newest release older than the live one"
[ ! -e "${SRV}/current.rollback" ] || fail "the temporary rollback link must not survive the atomic switch"
set +e; bash "${ROOT}/scripts/guiatv-ops.sh" rollback 20261022010257 >"${T}/ops5.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] || fail "rolling back to the release that is already live must fail"

# --- 8. the CI wrapper (scripts/deploy-ssh.sh) turns the real deploy script's failures into a failing step -----------
# fake ssh runs the remote script locally; fake sudo runs the sandboxed deploy-guiatv.sh instead of /var/www/guiatv's.
cat >"${T}/bin/fakessh" <<'EOF'
#!/bin/bash
while [ "$1" != bash ]; do shift; done
exec "$@"
EOF
cat >"${T}/bin/sudo" <<'EOF'
#!/bin/bash
exec env DEPLOY_ARTIFACT="${VT}/${SHA_DIR}/guiatv-artifact.tgz" DEPLOY_ARTIFACT_SHA256="$4" FORCE_DEPLOY=1 bash "${ROOT}/deploy-guiatv.sh" main
EOF
chmod +x "${T}/bin/fakessh" "${T}/bin/sudo"
export ROOT SSH_BIN="${T}/bin/fakessh" DEPLOY_SSH_HOST=h DEPLOY_SSH_USER=u DEPLOY_SSH_KEY=k VT="${T}/vt"
W40="$(printf 'c%.0s' {1..40})"; W64="$(printf 'd%.0s' {1..64})"
live="$(readlink -f "${SRV}/current")"
( exec 8>"${DEPLOY_LOCK_FILE}"; flock 8; exec sleep 5 ) &
holder=$!; sleep 0.5
set +e; SHA_DIR=none bash "${ROOT}/scripts/deploy-ssh.sh" "${W40}" "${W64}" >"${T}/ci1.log" 2>&1; code=$?; set -e
kill "${holder}" 2>/dev/null || true; wait "${holder}" 2>/dev/null || true
[ "${code}" = "75" ] || { cat "${T}/ci1.log"; fail "the CI step must fail with 75 on lock contention (got ${code})"; }
[ "$(readlink -f "${SRV}/current")" = "${live}" ] || fail "a lock-refused CI deploy changed the release"
art2="${T}/art2"; mkdir -p "${art2}/apps/backend/dist/server" "${art2}/apps/frontend/dist/guiatv/browser" "${art2}/apps/frontend/dist/guiatv/server"
touch "${art2}/apps/backend/dist/server/index.js" "${art2}/apps/frontend/dist/guiatv/browser/main.js" "${art2}/apps/frontend/dist/guiatv/server/main.server.mjs" "${art2}/apps/frontend/dist/guiatv/server/index.server.html"
sha2="$(git -C "${SRV}" rev-parse HEAD)"; echo "${sha2}" >"${art2}/ARTIFACT_GIT_SHA"
mkdir -p "${VT}/a"; tar -czf "${VT}/a/guiatv-artifact.tgz" -C "${art2}" ARTIFACT_GIT_SHA apps
sum2="$(sha256sum "${VT}/a/guiatv-artifact.tgz" | cut -d' ' -f1)"
export SHA_DIR=a
n=$(ls "${SRV}/releases" | wc -l); touch "${FAIL_FLAG}"; export FAIL_RELEASE="R$((n + 1))"
set +e; bash "${ROOT}/scripts/deploy-ssh.sh" "${sha2}" "${sum2}" >"${T}/ci2.log" 2>&1; code=$?; set -e
[ "${code}" != "0" ] || { cat "${T}/ci2.log"; fail "the CI step must fail when the smoke check fails"; }
[ "$(readlink -f "${SRV}/current")" = "${live}" ] || { cat "${T}/ci2.log"; fail "smoke failure through the CI wrapper did not roll back"; }
grep -q "rolling back" "${T}/ci2.log" && grep -q "Remote deploy FAILED" "${T}/ci2.log" || fail "the failed CI deploy was not reported"
rm -f "${FAIL_FLAG}"; export FAIL_RELEASE=none
bash "${ROOT}/scripts/deploy-ssh.sh" "${sha2}" "${sum2}" >"${T}/ci3.log" 2>&1 || { cat "${T}/ci3.log"; fail "a healthy CI deploy must exit 0"; }
[ "$(readlink -f "${SRV}/current")" != "${live}" ] || fail "the healthy CI deploy did not publish"

echo "deploy script checks passed"
