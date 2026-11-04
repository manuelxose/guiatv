#!/usr/bin/env bash
# Download/refresh the MaxMind GeoLite2 City + ASN databases used by the API's local GeoIP enrichment.
#
# Credentials are NEVER in the repository: they come from GEOIP_ENV_FILE (default /etc/guiatv/geoip.env, root 0600):
#   MAXMIND_ACCOUNT_ID=<account id>
#   MAXMIND_LICENSE_KEY=<license key>
# Optional: GEOIP_DIR (default /var/lib/GeoIP), GEOIP_EDITIONS (default "GeoLite2-City GeoLite2-ASN"),
#           MAXMIND_BASE_URL (default https://download.maxmind.com, overridable for tests).
#
# Each edition is downloaded with its SHA-256 file, verified, extracted to a temp dir on the same filesystem and moved
# into place atomically (rename), keeping the previous file as <name>.mmdb.prev for rollback. A failed or corrupt
# download leaves the current database untouched. The API notices the new file (mtime) within 6 h, without a restart
# (restart guiatv-api for an immediate reload). The key is passed to curl through a config on stdin, never argv, and
# is never printed.
set -euo pipefail

ENV_FILE="${GEOIP_ENV_FILE:-/etc/guiatv/geoip.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
: "${MAXMIND_ACCOUNT_ID:?MAXMIND_ACCOUNT_ID missing (set it in $ENV_FILE)}"
: "${MAXMIND_LICENSE_KEY:?MAXMIND_LICENSE_KEY missing (set it in $ENV_FILE)}"
DIR="${GEOIP_DIR:-/var/lib/GeoIP}"
EDITIONS="${GEOIP_EDITIONS:-GeoLite2-City GeoLite2-ASN}"
BASE="${MAXMIND_BASE_URL:-https://download.maxmind.com}"

mkdir -p "$DIR"
WORK="$(mktemp -d "$DIR/.geoip-update.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fetch() { # url output
  printf 'user = "%s:%s"\n' "$MAXMIND_ACCOUNT_ID" "$MAXMIND_LICENSE_KEY" | \
    curl --config - --fail --silent --show-error --location --max-time 300 --retry 3 --retry-delay 10 -o "$2" "$1"
}

updated=0
for edition in $EDITIONS; do
  url="$BASE/geoip/databases/$edition/download?suffix=tar.gz"
  fetch "$url" "$WORK/$edition.tar.gz"
  fetch "$BASE/geoip/databases/$edition/download?suffix=tar.gz.sha256" "$WORK/$edition.sha256"
  expected="$(awk '{print $1}' "$WORK/$edition.sha256")"
  actual="$(sha256sum "$WORK/$edition.tar.gz" | awk '{print $1}')"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "geoip-update: $edition checksum mismatch; keeping the current database" >&2
    exit 1
  fi
  mkdir -p "$WORK/$edition"
  tar -xzf "$WORK/$edition.tar.gz" -C "$WORK/$edition"
  mmdb="$(find "$WORK/$edition" -name "$edition.mmdb" -type f | head -n 1)"
  if [[ -z "$mmdb" || ! -s "$mmdb" ]]; then
    echo "geoip-update: $edition.mmdb not found in the archive; keeping the current database" >&2
    exit 1
  fi
  target="$DIR/$edition.mmdb"
  if [[ -f "$target" ]] && cmp -s "$mmdb" "$target"; then
    echo "geoip-update: $edition unchanged"
    continue
  fi
  chmod 0644 "$mmdb"
  [[ -f "$target" ]] && cp -p "$target" "$target.prev"
  mv -f "$mmdb" "$target"
  echo "geoip-update: $edition updated"
  updated=$((updated + 1))
done
echo "geoip-update: done ($updated updated)"
