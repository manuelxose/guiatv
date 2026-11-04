# GeoIP test fixtures

`GeoIP2-City-Test.mmdb` and `GeoLite2-ASN-Test.mmdb` are MaxMind's official **test** databases, copied unchanged
from <https://github.com/maxmind/MaxMind-DB/tree/main/test-data> (licence: `LICENSE-MaxMind-DB-test-data.md`, MIT).
They contain a handful of synthetic test networks only (e.g. `81.2.69.142` → London, `2001:218::/32` → Japan,
`1.128.0.0/11` → AS1221) and are used by `src/infrastructure/analytics/analyticsGeo.test.ts`. They are not usable for
production lookups; production uses GeoLite2 databases installed by `scripts/geoip-update.sh`.
