import { existsSync } from 'node:fs';

/**
 * Analytics feature flags, re-read at most every 5 s so the emergency switch works without a restart:
 *
 *   ANALYTICS_INGEST_ENABLED=false | ANALYTICS_KILL_FILE=<path that exists>
 *       first-party collection off: `/collect` and the legacy endpoints accept and drop (answering
 *       `X-Telemetry-Disabled: 1`), and `/config` tells browsers to stop and remove their identifiers.
 *   ANALYTICS_GA4_ENABLED=true          load GA4 (after consent) — off by default (progressive rollout)
 *   ANALYTICS_GA4_MEASUREMENT_ID=G-…    GA4 property (default: the frontend's environment value)
 *   ANALYTICS_GEOIP_ENABLED=true        local MaxMind enrichment (needs the .mmdb files, see GeoIpService)
 */
export interface TelemetryFlags {
  ingestEnabled: boolean;
  killed: boolean;
  ga4Enabled: boolean;
  ga4MeasurementId?: string;
  geoipEnabled: boolean;
}

const RECHECK_MS = 5_000;
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;

export class TelemetryFlagSource {
  private cached: { at: number; flags: TelemetryFlags } | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly exists: (path: string) => boolean = existsSync,
    private readonly now: () => number = Date.now
  ) {}

  get(): TelemetryFlags {
    const at = this.now();
    if (this.cached && at - this.cached.at < RECHECK_MS) return this.cached.flags;
    const killFile = this.env.ANALYTICS_KILL_FILE;
    let killedByFile = false;
    try {
      killedByFile = Boolean(killFile && this.exists(killFile));
    } catch {
      killedByFile = false;
    }
    const killed = this.env.ANALYTICS_INGEST_ENABLED === 'false' || killedByFile;
    const id = (this.env.ANALYTICS_GA4_MEASUREMENT_ID || '').trim();
    const flags: TelemetryFlags = {
      ingestEnabled: !killed,
      killed,
      ga4Enabled: !killed && this.env.ANALYTICS_GA4_ENABLED === 'true',
      ga4MeasurementId: MEASUREMENT_ID.test(id) ? id : undefined,
      geoipEnabled: this.env.ANALYTICS_GEOIP_ENABLED === 'true',
    };
    this.cached = { at, flags };
    return flags;
  }
}

export const telemetryFlags = new TelemetryFlagSource();
