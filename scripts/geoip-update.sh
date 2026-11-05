#!/usr/bin/env bash
# Download/refresh the City + ASN databases used by the API's local GeoIP enrichment (no per-request lookups).
#
# Two sources, same .mmdb format (the API prefers MaxMind when both are present):
#  * MaxMind GeoLite2 (accuracy radius, region codes) when credentials exist. They are NEVER in the repository: they
#    come from GEOIP_ENV_FILE (default /etc/guiatv/geoip.env, root 0600) or the environment:
#      MAXMIND_ACCOUNT_ID=<account id>
#      MAXMIND_LICENSE_KEY=<license key>
#  * Otherwise DB-IP Lite (City + ASN, CC BY 4.0, monthly, no account): dbip-city-lite.mmdb and dbip-asn-lite.mmdb.
#    The attribution "IP Geolocation by DB-IP" is shown wherever the admin panel displays locations.
# Optional: GEOIP_DIR (default /var/lib/GeoIP), GEOIP_EDITIONS (default "GeoLite2-City GeoLite2-ASN"),
#           GEOIP_SOURCE (auto|maxmind|dbip, default auto), MAXMIND_BASE_URL / DBIP_BASE_URL (overridable for tests).
#
# Every download is verified before it replaces anything (MaxMind: SHA-256 file; DB-IP: gzip integrity and the .mmdb
# metadata marker), extracted to a temp dir on the same filesystem and moved into place atomically (rename), keeping
# the previous file as <name>.mmdb.prev for rollback. A failed or corrupt download leaves the current database
# untouched. The API notices a new file (mtime) within 6 h, without a restart (restart guiatv-api for an immediate
# reload). The MaxMind key is passed to curl through a config on stdin, never argv, and is never printed.
set -euo pipefail

ENV_FILE="${GEOIP_ENV_FILE:-/etc/guiatv/geoip.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
SOURCE="${GEOIP_SOURCE:-auto}"
if [[ "$SOURCE" == "auto" ]]; then
  if [[ -n "${MAXMIND_ACCOUNT_ID:-}" && -n "${MAXMIND_LICENSE_KEY:-}" ]]; then SOURCE=maxmind; else SOURCE=dbip; fi
fi
DIR="${GEOIP_DIR:-/var/lib/GeoIP}"
EDITIONS="${GEOIP_EDITIONS:-GeoLite2-City GeoLite2-ASN}"
BASE="${MAXMIND_BASE_URL:-https://download.maxmind.com}"
DBIP_BASE="${DBIP_BASE_URL:-https://download.db-ip.com}"

mkdir -p "$DIR"
WORK="$(mktemp -d "$DIR/.geoip-update.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

install_mmdb() { # source-file target-name label -> installs atomically unless unchanged; echoes the outcome
  local mmdb="$1" target="$DIR/$2" label="${3:-$2}"
  if [[ -f "$target" ]] && cmp -s "$mmdb" "$target"; then
    echo "geoip-update: $label unchanged"
    return 0
  fi
  chmod 0644 "$mmdb"
  [[ -f "$target" ]] && cp -p "$target" "$target.prev"
  mv -f "$mmdb" "$target"
  echo "geoip-update: $label updated"
  updated=$((updated + 1))
}

updated=0
if [[ "$SOURCE" == "dbip" ]]; then
  # The current month's file appears during the first days of the month: fall back to the previous one.
  months="$(date -u +%Y-%m) $(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m 2>/dev/null || date -u -v-1m +%Y-%m)"
  for kind in city asn; do
    got=""
    for month in $months; do
      gz="$WORK/dbip-$kind-lite.mmdb.gz"
      if curl --fail --silent --show-error --location --max-time 300 --retry 2 --retry-delay 10 \
           -o "$gz" "$DBIP_BASE/free/dbip-$kind-lite-$month.mmdb.gz" 2>"$WORK/curl.err"; then
        got="$month"
        break
      fi
    done
    if [[ -z "$got" ]]; then
      echo "geoip-update: DB-IP $kind download failed ($(tr -d '\n' < "$WORK/curl.err" | cut -c1-200)); keeping the current database" >&2
      exit 1
    fi
    if ! gzip -t "$gz" 2>/dev/null; then
      echo "geoip-update: DB-IP $kind archive is corrupt; keeping the current database" >&2
      exit 1
    fi
    gzip -dc "$gz" > "$WORK/dbip-$kind-lite.mmdb"
    # Every .mmdb ends with a metadata section introduced by this marker.
    if [[ ! -s "$WORK/dbip-$kind-lite.mmdb" ]] || ! tail -c 262144 "$WORK/dbip-$kind-lite.mmdb" | LC_ALL=C grep -aq $'\xab\xcd\xefMaxMind.com'; then
      echo "geoip-update: DB-IP $kind file is not a valid .mmdb; keeping the current database" >&2
      exit 1
    fi
    install_mmdb "$WORK/dbip-$kind-lite.mmdb" "dbip-$kind-lite.mmdb"
  done
  echo "geoip-update: done ($updated updated, DB-IP Lite $got)"
  exit 0
fi

: "${MAXMIND_ACCOUNT_ID:?MAXMIND_ACCOUNT_ID missing (set it in $ENV_FILE)}"
: "${MAXMIND_LICENSE_KEY:?MAXMIND_LICENSE_KEY missing (set it in $ENV_FILE)}"

fetch() { # url output
  printf 'user = "%s:%s"\n' "$MAXMIND_ACCOUNT_ID" "$MAXMIND_LICENSE_KEY" | \
    curl --config - --fail --silent --show-error --location --max-time 300 --retry 3 --retry-delay 10 -o "$2" "$1"
}

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
  install_mmdb "$mmdb" "$edition.mmdb" "$edition"
done
echo "geoip-update: done ($updated updated)"
