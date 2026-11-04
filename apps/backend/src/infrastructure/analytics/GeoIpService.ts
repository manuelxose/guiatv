import { promises as fs } from 'node:fs';
import { isIP } from 'node:net';
import { logger } from '../../shared/utils/logger';
import { canonicalIp, isPrivateOrLocalIp } from './ipPrivacy';

/**
 * Local MaxMind GeoLite2 City + ASN enrichment (IPv4 and IPv6). No network call per event: the `.mmdb` files are
 * read from disk at start-up with async I/O and lookups are in-memory tree walks (microseconds).
 * Files are installed and refreshed by `scripts/geoip-update.sh` (systemd timer, license key outside the repo);
 * this service re-opens them when their modification time changes (checked every 6 h, unref'd timer).
 *
 * The result is approximate by nature and says so: `geoStatus`, `accuracyRadiusKm` and the database build are kept
 * with every record. It never claims a precise position, an identity, or anything about the person (age, gender…).
 * VPN/proxy use cannot be detected with GeoLite2 (it has no anonymizer data); the ASN organisation is reported as is.
 */
export type GeoStatus = 'located' | 'country_only' | 'unknown' | 'private' | 'invalid' | 'unavailable' | 'disabled';

export interface GeoResult {
  geoStatus: GeoStatus;
  geoSource?: 'maxmind' | 'proxy_header';
  country?: string;
  region?: string;
  regionName?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  accuracyRadiusKm?: number;
  asn?: number;
  asOrg?: string;
  geoDb?: string;
}

interface MmdbReader<T> {
  get(ip: string): T | null;
  metadata: { databaseType: string; buildEpoch: Date };
}

interface CityRecord {
  country?: { iso_code?: string };
  registered_country?: { iso_code?: string };
  subdivisions?: Array<{ iso_code?: string; names?: Record<string, string> }>;
  city?: { names?: Record<string, string> };
  location?: { latitude?: number; longitude?: number; accuracy_radius?: number };
}

interface AsnRecord {
  autonomous_system_number?: number;
  autonomous_system_organization?: string;
}

interface DbState<T> {
  path: string;
  reader: MmdbReader<T> | null;
  mtimeMs: number;
  version?: string;
  error?: string;
}

const RELOAD_CHECK_MS = 6 * 60 * 60_000;

function pickName(names?: Record<string, string>): string | undefined {
  const name = names?.es || names?.en;
  return name && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) ? name : undefined;
}

export class GeoIpService {
  private readonly city: DbState<CityRecord>;
  private readonly asn: DbState<AsnRecord>;
  private timer: NodeJS.Timeout | null = null;
  private lookups = 0;
  private located = 0;

  constructor(
    private readonly options: { enabled: boolean; cityPath?: string; asnPath?: string } = {
      enabled: process.env.ANALYTICS_GEOIP_ENABLED === 'true',
      cityPath: process.env.ANALYTICS_GEOIP_CITY_DB || '/var/lib/GeoIP/GeoLite2-City.mmdb',
      asnPath: process.env.ANALYTICS_GEOIP_ASN_DB || '/var/lib/GeoIP/GeoLite2-ASN.mmdb',
    },
    private readonly openReader: <T>(buffer: Buffer) => MmdbReader<T> = defaultOpenReader
  ) {
    this.city = { path: options.cityPath || '', reader: null, mtimeMs: 0 };
    this.asn = { path: options.asnPath || '', reader: null, mtimeMs: 0 };
  }

  /** Non-blocking for the caller's request path: call it once at start-up without awaiting. */
  async init(): Promise<void> {
    if (!this.options.enabled) return;
    await Promise.all([this.load(this.city), this.load(this.asn)]);
    if (!this.timer) {
      this.timer = setInterval(() => void this.reloadIfChanged(), RELOAD_CHECK_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reloadIfChanged(): Promise<void> {
    await Promise.all([this.load(this.city, true), this.load(this.asn, true)]);
  }

  lookup(rawIp: string | undefined): GeoResult {
    if (!this.options.enabled) return { geoStatus: 'disabled' };
    const ip = canonicalIp(rawIp);
    if (!ip || !isIP(ip)) return { geoStatus: 'invalid' };
    if (isPrivateOrLocalIp(ip)) return { geoStatus: 'private' };
    if (!this.city.reader && !this.asn.reader) return { geoStatus: 'unavailable' };
    this.lookups++;
    const result: GeoResult = { geoStatus: 'unknown', geoSource: 'maxmind', geoDb: [this.city.version, this.asn.version].filter(Boolean).join(' + ') || undefined };
    try {
      const city = this.city.reader?.get(ip);
      if (city) {
        const country = city.country?.iso_code || city.registered_country?.iso_code;
        if (country && /^[A-Z]{2}$/.test(country)) {
          result.country = country;
          result.geoStatus = 'country_only';
        }
        const subdivision = city.subdivisions?.[0];
        if (subdivision?.iso_code && /^[A-Z0-9]{1,3}$/.test(subdivision.iso_code)) result.region = subdivision.iso_code;
        result.regionName = pickName(subdivision?.names);
        result.city = pickName(city.city?.names);
        const { latitude, longitude, accuracy_radius: radius } = city.location || {};
        if (typeof latitude === 'number' && typeof longitude === 'number' && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
          // 0.1° (~11 km): an approximate area, never a precise position.
          result.latitude = Math.round(latitude * 10) / 10;
          result.longitude = Math.round(longitude * 10) / 10;
        }
        if (typeof radius === 'number' && radius > 0) result.accuracyRadiusKm = radius;
        if (result.country && result.city) result.geoStatus = 'located';
      }
    } catch {
      result.geoStatus = 'unknown';
    }
    try {
      const asn = this.asn.reader?.get(ip);
      if (asn?.autonomous_system_number) {
        result.asn = asn.autonomous_system_number;
        result.asOrg = asn.autonomous_system_organization?.slice(0, 120);
      }
    } catch {
      // ASN is optional
    }
    if (result.geoStatus !== 'unknown') this.located++;
    return result;
  }

  status(): Record<string, unknown> {
    const describe = (db: DbState<unknown>) => ({ loaded: Boolean(db.reader), version: db.version || null, error: db.error || null });
    return { enabled: this.options.enabled, city: describe(this.city), asn: describe(this.asn), lookups: this.lookups, located: this.located };
  }

  private async load<T>(db: DbState<T>, onlyIfChanged = false): Promise<void> {
    if (!db.path) return;
    try {
      const stat = await fs.stat(db.path);
      if (onlyIfChanged && db.reader && stat.mtimeMs === db.mtimeMs) return;
      const buffer = await fs.readFile(db.path);
      const reader = this.openReader<T>(buffer);
      db.reader = reader;
      db.mtimeMs = stat.mtimeMs;
      db.version = `${reader.metadata.databaseType} ${new Date(reader.metadata.buildEpoch).toISOString().slice(0, 10)}`;
      db.error = undefined;
      logger.info('[Analytics] GeoIP database loaded', { database: db.version });
    } catch (error) {
      // Keep the previous reader if a refresh fails (e.g. a half-written file); report the error.
      db.error = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
      if (!db.reader) logger.warn('[Analytics] GeoIP database unavailable; sessions are stored without location', { path: db.path, error: db.error });
    }
  }
}

function defaultOpenReader<T>(buffer: Buffer): MmdbReader<T> {
  // Lazy require: the dependency is only loaded when GeoIP is enabled.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Reader } = require('maxmind') as { Reader: new <R>(db: Buffer) => MmdbReader<R> };
  return new Reader<T>(buffer);
}
