import { randomUUID } from 'node:crypto';
import { AnalyticsEventRecord, AnalyticsSessionRecord, IAnalyticsRepository } from '../../../domain/repositories/IAnalyticsRepository';
import { analyticsPiiMode, anonymizeIp, canonicalIp, excludedIpSet } from '../../../infrastructure/analytics/ipPrivacy';
import { GeoIpService, GeoResult } from '../../../infrastructure/analytics/GeoIpService';
import { NormalizedBatch } from './telemetryValidation';
import { TelemetryIngestQueue, DEFAULT_INGEST_OPTIONS, IngestQueueOptions } from './TelemetryIngestQueue';

/** Request facts captured synchronously by the route; the raw address lives only in memory until processed. */
export interface IngestContext {
  ip: string;
  userAgent?: string;
  language?: string;
  admin: boolean;
  /** Bearer token, if any: resolved to a role by the drain loop (no auth/storage I/O on the request path). */
  authToken?: string;
  /** Location from a trusted proxy's headers (Cloudflare), used when local GeoIP has no answer. */
  proxyGeo?: { country?: string; region?: string; city?: string; latitude?: number; longitude?: number };
  receivedAt: number;
}

export interface IngestItem {
  batch: NormalizedBatch;
  ctx: IngestContext;
}

/**
 * Enrichment and persistence of accepted analytics batches, off the request path (see TelemetryIngestQueue).
 * Privacy is applied here for both stores alike: the address is used transiently for exclusion and GeoIP, then only
 * its truncated prefix (or nothing, ANALYTICS_PII=none) is written.
 */
const ROLE_CACHE_MAX = 1_000;
const ROLE_CACHE_MS = 5 * 60_000;
const EXCLUDED_SESSIONS_MAX = 10_000;

export type RoleResolver = (token: string) => Promise<string | undefined>;

export class TelemetryIngestService {
  readonly queue: TelemetryIngestQueue<IngestItem>;
  private readonly roles = new Map<string, { role?: string; until: number }>();
  /** Sessions known to be administrators' (beacons carry no Authorization header, so later batches inherit it). */
  private readonly excludedSessions = new Set<string>();
  private rejectedEvents = 0;
  private invalidBatches = 0;
  private disabledDrops = 0;

  constructor(
    private readonly repository: IAnalyticsRepository,
    private readonly geoip: GeoIpService,
    options: IngestQueueOptions = DEFAULT_INGEST_OPTIONS,
    private readonly resolveRole?: RoleResolver,
    private readonly exclusions?: { isExcluded(ip: string): boolean }
  ) {
    this.queue = new TelemetryIngestQueue<IngestItem>((item) => this.process(item), () => this.repository.isAvailable?.() ?? true, options);
  }

  /** O(1); false = queue full (backpressure). */
  accept(batch: NormalizedBatch, ctx: IngestContext): boolean {
    this.rejectedEvents += batch.rejected;
    return this.queue.offer({ batch, ctx }, batch.events.length + (batch.session ? 1 : 0));
  }

  countInvalid(): void {
    this.invalidBatches++;
  }

  countDisabled(): void {
    this.disabledDrops++;
  }

  /** Local GeoIP can locate new sessions (a city database is loaded). */
  geoAvailable(): boolean {
    return this.geoip.available();
  }

  diagnostics(): Record<string, unknown> {
    return { queue: this.queue.metrics(), rejectedEvents: this.rejectedEvents, invalidBatches: this.invalidBatches, droppedWhileDisabled: this.disabledDrops, storageAvailable: this.repository.isAvailable?.() ?? null, geoip: this.geoip.status() };
  }

  async process({ batch, ctx }: IngestItem): Promise<void> {
    const now = new Date(ctx.receivedAt);
    const pii = analyticsPiiMode();
    const ip = canonicalIp(ctx.ip);
    const admin = ctx.admin || (ctx.authToken ? (await this.role(ctx.authToken)) === 'admin' : false);
    if (admin && !this.excludedSessions.has(batch.sessionId)) {
      this.rememberExcluded(batch.sessionId);
      if (!batch.session) await this.repository.markExcludedSession(batch.sessionId);
    }
    const excluded = admin || this.excludedSessions.has(batch.sessionId) || (ip !== '' && (this.exclusions ? this.exclusions.isExcluded(ip) : excludedIpSet().has(ip)));
    const storedIp = pii === 'none' ? undefined : anonymizeIp(ip);
    const userAgent = pii === 'none' ? undefined : ctx.userAgent?.slice(0, 180) || undefined;
    // `excluded` is always an explicit boolean: stores use it instead of re-deriving it from the (truncated) address.
    const base = { sessionId: batch.sessionId, anonId: batch.anonId, ip: storedIp, userAgent, language: ctx.language, excluded };

    if (batch.session) {
      const s = batch.session;
      const geo = pii === 'none' ? ({ geoStatus: 'disabled' } as GeoResult) : this.locate(ip, ctx);
      const session: AnalyticsSessionRecord = {
        ...base,
        startedAt: s.startedAt,
        lastSeenAt: now,
        initialPath: s.initialPath,
        lastPath: s.initialPath,
        referrer: s.referrer,
        excluded,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        geo: pii === 'none' ? undefined : { status: geo.geoStatus, source: geo.geoSource, regionName: geo.regionName, accuracyRadiusKm: geo.accuracyRadiusKm, asn: geo.asn, asOrg: geo.asOrg, db: geo.geoDb },
        language: s.language || ctx.language,
        timezone: s.timezone,
        screen: s.screen,
        viewport: s.viewport,
        metadata: { device: s.device, utm: s.utm, colorScheme: s.colorScheme, activity: { idleSec: 0, isIdle: false, lastActivityAt: now.toISOString() } },
      };
      await this.repository.startSession(session);
      await this.writeEvents([{ ...base, eventId: `ss-${batch.sessionId}`, type: 'session_start', name: 'session_start', path: s.initialPath, referrer: s.referrer, occurredAt: s.startedAt, timezone: s.timezone, data: s.device ? { device: s.device.type, orientation: s.device.orientation } : undefined }]);
    }

    if (batch.events.length) {
      await this.writeEvents(batch.events.map((event) => ({ ...base, ...event, eventId: event.eventId || randomUUID(), timezone: batch.session?.timezone })));
    }

    const lastPath = [...batch.events].reverse().find((event) => event.type === 'page_view')?.path;
    if (batch.end) {
      const ended = await this.repository.endSession({ sessionId: batch.sessionId, endedAt: now, lastSeenAt: now, lastPath, endReason: batch.end.reason });
      if (ended?.anonId) {
        await this.writeEvents([{ ...base, anonId: ended.anonId, eventId: `se-${batch.sessionId}-${now.getTime()}`, type: 'session_end', name: 'session_end', path: lastPath || ended.lastPath, occurredAt: now, data: { endReason: batch.end.reason, durationSec: ended.durationSec } }]);
      }
    } else if (batch.heartbeat || batch.resume || batch.events.length) {
      const idleSec = batch.heartbeat?.idleSec ?? 0;
      await this.repository.heartbeatSession({
        sessionId: batch.sessionId,
        lastSeenAt: now,
        lastPath,
        activity: { idleSec, isIdle: idleSec >= 60, lastActivityAt: new Date(now.getTime() - idleSec * 1000).toISOString(), visible: batch.heartbeat?.visible ?? true },
        resume: batch.resume,
      });
    }
  }

  private async role(token: string): Promise<string | undefined> {
    if (!this.resolveRole) return undefined;
    const now = Date.now();
    const hit = this.roles.get(token);
    if (hit && hit.until > now) return hit.role;
    let role: string | undefined;
    try {
      role = await this.resolveRole(token);
    } catch {
      role = undefined; // expired/invalid token: an ordinary visitor
    }
    if (this.roles.size >= ROLE_CACHE_MAX) this.roles.delete(this.roles.keys().next().value as string);
    this.roles.set(token, { role, until: now + ROLE_CACHE_MS });
    return role;
  }

  private rememberExcluded(sessionId: string): void {
    if (this.excludedSessions.size >= EXCLUDED_SESSIONS_MAX) this.excludedSessions.delete(this.excludedSessions.values().next().value as string);
    this.excludedSessions.add(sessionId);
  }

  private locate(ip: string, ctx: IngestContext): GeoResult {
    const local = this.geoip.lookup(ip);
    if ((local.geoStatus === 'located' || local.geoStatus === 'country_only') || !ctx.proxyGeo?.country) return local;
    return { ...ctx.proxyGeo, geoStatus: ctx.proxyGeo.city ? 'located' : 'country_only', geoSource: 'proxy_header', asn: local.asn, asOrg: local.asOrg };
  }

  private async writeEvents(events: AnalyticsEventRecord[]): Promise<void> {
    if (this.repository.createEvents) await this.repository.createEvents(events);
    else for (const event of events) await this.repository.createEvent(event);
  }
}
