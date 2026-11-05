import { Request, Response } from 'express';
import { AnalyticsService } from '../../application/services/AnalyticsService';
import { AnalyticsEventModel } from '../../infrastructure/database/models/AnalyticsEvent.model';
import { successResponse } from '../../shared/types/ApiResponse';
import { ValidationError } from '../../shared/errors';
import { analyticsExclusions } from '../../infrastructure/repositories/analyticsExclusions';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import { analyticsClientIp, isTrustedAnalyticsProxy } from './analyticsClientIp';
import { anonymizeIp, canonicalIp } from '../../infrastructure/analytics/ipPrivacy';
import { LIVE_IDLE_LIMIT_SECONDS } from '../../infrastructure/repositories/analyticsActivity';
import { TelemetryIngestService } from '../../application/services/analytics/TelemetryIngestService';
import { TelemetryFlagSource, telemetryFlags } from '../../application/services/analytics/telemetryFlags';
import { NormalizedBatch, TELEMETRY_LIMITS, normalizeEvent, normalizeSession, validateCollectBatch } from '../../application/services/analytics/telemetryValidation';
import { PathLabelResolver } from '../../application/services/analytics/pathLabels';
import { Ga4ReportingService } from '../../infrastructure/analytics/Ga4ReportingService';
import { AnalyticsExclusionService, ExclusionError } from '../../application/services/analytics/AnalyticsExclusionService';

/** Legacy per-event endpoints (pre-consent collector still cached in open tabs). Off unless explicitly accepted. */
const legacyAccepted = () => process.env.ANALYTICS_LEGACY_ENDPOINTS === 'accept';
const ID = /^[A-Za-z0-9-]{8,64}$/;

export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly ingest?: TelemetryIngestService,
    private readonly flags: TelemetryFlagSource = telemetryFlags,
    private readonly labels?: PathLabelResolver,
    private readonly storeKind: 'mongo' | 'valkey' = 'mongo',
    private readonly ga4Reporting?: Ga4ReportingService,
    private readonly exclusions?: AnalyticsExclusionService
  ) {}

  /** `GET /exclusions` (admin): every rule (built-in and manual) plus the requester's own address and status. */
  async getExclusions(req: Request, res: Response): Promise<void> {
    if (!this.exclusions) { res.status(501).json({ success: false, code: 'unsupported', message: 'Exclusiones no disponibles en este backend.' }); return; }
    const ip = canonicalIp(this.getClientInfo(req).ip);
    // The requester's own address only, to themselves (admin-only, no-store): needed to exclude it.
    res.status(200).json(successResponse({ entries: await this.exclusions.list(), you: { ip: ip || null, excludedBy: ip ? this.exclusions.matching(ip) : [] } }));
  }

  /** `POST /exclusions` (admin): `{ value: ip|cidr, label? }` or `{ mine: true, label? }`. */
  async addExclusion(req: Request, res: Response): Promise<void> {
    if (!this.exclusions) { res.status(501).json({ success: false, code: 'unsupported', message: 'Exclusiones no disponibles en este backend.' }); return; }
    const body = req.body || {};
    const value = body.mine === true ? canonicalIp(this.getClientInfo(req).ip) : typeof body.value === 'string' ? body.value : '';
    const user = (req as AuthenticatedRequest).user;
    try {
      const entry = await this.exclusions.add(value, typeof body.label === 'string' ? body.label : body.mine === true ? 'Mi IP (administración)' : undefined, user?.email || user?.id || 'admin-key');
      res.status(201).json(successResponse({ entry }));
    } catch (error) {
      if (error instanceof ExclusionError) { res.status(400).json({ success: false, message: error.message }); return; }
      throw error;
    }
  }

  /** `DELETE /exclusions/:id` (admin). */
  async removeExclusion(req: Request, res: Response): Promise<void> {
    if (!this.exclusions) { res.status(501).json({ success: false, code: 'unsupported', message: 'Exclusiones no disponibles en este backend.' }); return; }
    const id = String(req.params.id || '');
    if (!/^[a-f0-9]{24}$/i.test(id)) { res.status(400).json({ success: false, message: 'Identificador no válido.' }); return; }
    const removed = await this.exclusions.remove(id);
    res.status(removed ? 200 : 404).json(removed ? successResponse({ removed: true }) : { success: false, message: 'No existe esa exclusión.' });
  }

  /** `GET /ga4/demographics` (admin): aggregate GA4 age/gender/interests exactly as GA4 reports them, or why not. */
  async getGa4Demographics(req: Request, res: Response): Promise<void> {
    const days = this.clamp(this.parseNumber(req.query.days, 28), 1, 90);
    const result = this.ga4Reporting ? await this.ga4Reporting.demographics(days) : { available: false as const, reason: 'not_configured' as const, message: 'GA4 Data API no configurada.' };
    res.status(200).json(successResponse({ ga4: result }));
  }

  /** `POST /collect`: validate, enqueue, answer 202. No storage I/O on the request path. */
  async collect(req: Request, res: Response): Promise<void> {
    if (!this.flags.get().ingestEnabled || !this.ingest) {
      this.ingest?.countDisabled();
      res.set('X-Telemetry-Disabled', '1').status(204).end();
      return;
    }
    const length = Number(req.get('content-length') || 0);
    if (length > TELEMETRY_LIMITS.maxBodyBytes) {
      res.status(413).json({ success: false, message: 'Payload too large' });
      return;
    }
    const result = validateCollectBatch(req.body);
    if (!result.ok) {
      this.ingest.countInvalid();
      res.status(400).json({ success: false, message: `Invalid telemetry batch (${result.reason})` });
      return;
    }
    if (!this.enqueue(req, result.batch)) {
      res.set('Retry-After', '30').status(503).json({ success: false, message: 'Telemetry queue full' });
      return;
    }
    res.status(202).json(successResponse({ accepted: result.batch.events.length }));
  }

  /** `GET /config`: emergency switch and GA4 rollout flag for browsers (cached 60 s, see publicCachePolicy). */
  getConfig(_req: Request, res: Response): void {
    const flags = this.flags.get();
    res.status(200).json(successResponse({ enabled: flags.ingestEnabled, ga4: { enabled: flags.ga4Enabled, measurementId: flags.ga4MeasurementId } }));
  }

  /** `GET /diagnostics` (admin): queue, drops, storage and GeoIP state — measured values only. */
  getDiagnostics(_req: Request, res: Response): void {
    const flags = this.flags.get();
    res.status(200).json(successResponse({
      store: this.storeKind,
      flags: { ingestEnabled: flags.ingestEnabled, killed: flags.killed, ga4Enabled: flags.ga4Enabled, geoipEnabled: flags.geoipEnabled, legacyEndpoints: legacyAccepted() ? 'accept' : 'drop' },
      ingest: this.ingest?.diagnostics() ?? null,
      generatedAt: new Date().toISOString(),
    }));
  }

  private enqueue(req: Request, batch: NormalizedBatch): boolean {
    if (!this.ingest) return false;
    const client = this.getClientInfo(req);
    const geo = this.getGeography(req);
    return this.ingest.accept(batch, {
      ip: client.ip,
      userAgent: client.userAgent || undefined,
      language: client.language && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(client.language) ? client.language : undefined,
      admin: (req as AuthenticatedRequest).user?.role === 'admin',
      authToken: this.bearer(req),
      proxyGeo: geo.country ? geo : undefined,
      receivedAt: Date.now(),
    });
  }

  /**
   * Legacy endpoints keep their response contract. Their data was produced without a consent check, so by default
   * it is not persisted (`X-Telemetry-Disabled: 1` tells current clients to stop); ANALYTICS_LEGACY_ENDPOINTS=accept
   * routes it through the same validated queue as `/collect`.
   */
  private legacyIngest(req: Request, res: Response, build: () => NormalizedBatch | null): void {
    if (!this.flags.get().ingestEnabled || !legacyAccepted() || !this.ingest) {
      res.set('X-Telemetry-Disabled', '1');
      return;
    }
    const batch = build();
    // Same id rules as /collect; an invalid legacy payload is dropped (the old response contract is kept).
    if (!batch || !ID.test(String(batch.sessionId)) || !ID.test(String(batch.anonId))) {
      this.ingest.countInvalid();
      return;
    }
    if (!this.enqueue(req, batch)) res.set('X-Telemetry-Queue', 'full');
  }

  private bearer(req: Request): string | undefined {
    const header = req.get('authorization') || '';
    return /^bearer /i.test(header) && header.length <= 4096 ? header.slice(7).trim() || undefined : undefined;
  }

  private requireStorage(res: Response): boolean {
    if (this.analyticsService.isAvailable()) return true;
    res.status(503).json({ success: false, code: 'storage_unavailable', message: `El almacenamiento de Analytics (${this.storeKind}) no está disponible en este momento.` });
    return false;
  }

  async markExcludedSession(sessionId: string): Promise<void> {
    await this.analyticsService.markExcludedSession(sessionId);
  }

  async startSession(req: Request, res: Response): Promise<void> {
    const { sessionId, anonId, initialPath, referrer, metadata, screen, viewport, timezone, startedAt } = req.body || {};
    if (!sessionId || !anonId) {
      throw new ValidationError('Missing required session fields', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
        { field: 'anonId', message: 'anonId is required', value: anonId },
      ]);
    }
    this.legacyIngest(req, res, () => ({
      sessionId, anonId, events: [], rejected: 0,
      session: normalizeSession({ startedAt, initialPath, referrer, screen, viewport, timezone, device: metadata?.device }, Date.now()),
    }));
    res.status(201).json(successResponse({ sessionId }));
  }

  async heartbeatSession(req: Request, res: Response): Promise<void> {
    const { sessionId, metadata } = req.body || {};
    if (!sessionId) {
      throw new ValidationError('Missing sessionId', [{ field: 'sessionId', message: 'sessionId is required', value: sessionId }]);
    }
    const idle = metadata?.activity?.idleSec;
    this.legacyIngest(req, res, () => ({
      sessionId, anonId: 'legacy-heartbeat', events: [], rejected: 0,
      heartbeat: { idleSec: typeof idle === 'number' && idle >= 0 ? Math.min(Math.floor(idle), 86_400) : 0, visible: true },
    }));
    res.status(200).json(successResponse({ session: null }));
  }

  async endSession(req: Request, res: Response): Promise<void> {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      throw new ValidationError('Missing sessionId', [{ field: 'sessionId', message: 'sessionId is required', value: sessionId }]);
    }
    this.legacyIngest(req, res, () => ({ sessionId, anonId: 'legacy-end', events: [], rejected: 0, end: { reason: 'pagehide' } }));
    res.status(200).json(successResponse({ session: null }));
  }

  async trackEvent(req: Request, res: Response): Promise<void> {
    const { eventId, sessionId, anonId, type, name, path, title, referrer, occurredAt, data } = req.body || {};
    if (!sessionId || !anonId || !type) {
      throw new ValidationError('Missing required event fields', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
        { field: 'anonId', message: 'anonId is required', value: anonId },
        { field: 'type', message: 'type is required', value: type },
      ]);
    }
    this.legacyIngest(req, res, () => {
      const event = normalizeEvent({ eventId, type, name, path, title, referrer, occurredAt, data }, Date.now());
      return event ? { sessionId, anonId, events: [event], rejected: 0 } : null;
    });
    res.status(201).json(successResponse({ ok: true }));
  }

  async getLive(req: Request, res: Response): Promise<void> {
    if (!this.requireStorage(res)) return;
    const windowSec = this.clamp(this.parseNumber(req.query.windowSec, 90), 10, 3600);
    const limit = this.clamp(this.parseNumber(req.query.limit, 50), 1, 200);

    const snapshot = await this.analyticsService.getLiveSnapshot(windowSec, limit);
    const labels = await this.labelsFor(snapshot.sessions.flatMap((session) => [session.initialPath, session.lastPath]));

    res.status(200).json(
      successResponse({
        activeCount: snapshot.activeCount,
        sessions: snapshot.sessions.map((session) => ({
          ...session,
          ip: anonymizeIp(session.ip),
          initialPathLabel: labels.get(session.initialPath || ''),
          lastPathLabel: labels.get(session.lastPath || ''),
        })),
        idleTimeoutSec: LIVE_IDLE_LIMIT_SECONDS,
      })
    );
  }

  async getRealtimePages(_req: Request, res: Response): Promise<void> {
    if (!this.requireStorage(res)) return;
    const report = await this.analyticsService.getRealtimePages();
    if (!report) {
      res.status(503).json({ success: false, code: 'storage_unavailable', message: 'El almacenamiento activo no permite calcular este informe de forma fiable.' });
      return;
    }
    const labels = await this.labelsFor(report.pages.map((page) => page.path));
    res.status(200).json(successResponse({ report: { ...report, pages: report.pages.map((page) => ({ ...page, label: labels.get(page.path) })) } }));
  }

  async getOverview(req: Request, res: Response): Promise<void> {
    if (!this.requireStorage(res)) return;
    const defaultFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = this.parseDate(req.query.to, new Date()) || new Date();
    let from = this.parseDate(req.query.from, defaultFrom) || defaultFrom;
    // Bounded range: at most the retention window (older data has expired anyway).
    const maxRangeMs = 31 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxRangeMs) from = new Date(to.getTime() - maxRangeMs);
    const liveWindowSec = this.clamp(this.parseNumber(req.query.windowSec, 90), 10, 3600);

    const overview = await this.analyticsService.getOverview(from, to, liveWindowSec);
    const labels = await this.labelsFor(overview.topPages.map((page) => page.path));

    res.status(200).json(successResponse({ range: { from, to }, overview: {
      ...overview,
      topPages: overview.topPages.slice(0, 200).map((page) => ({ ...page, label: labels.get(page.path) })),
      store: this.storeKind,
      geoipEnabled: this.flags.get().geoipEnabled,
      geographyConfigured: Boolean((process.env.ANALYTICS_GEO_TRUSTED_PROXIES || '').split(',').some((ip) => ip.trim())) || this.flags.get().geoipEnabled,
      geographyDetailConfigured: Boolean((process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES || '').split(',').some((ip) => ip.trim())) || this.flags.get().geoipEnabled,
    } }));
  }

  async getEvents(req: Request, res: Response): Promise<void> {
    if (!this.requireStorage(res)) return;
    const from = this.parseDate(req.query.from, undefined);
    const to = this.parseDate(req.query.to, undefined);
    const limit = this.clamp(this.parseNumber(req.query.limit, 50), 1, 500);
    const type = typeof req.query.type === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(req.query.type) ? req.query.type : undefined;
    const sessionId =
      typeof req.query.sessionId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(req.query.sessionId)
        ? req.query.sessionId
        : undefined;

    const events = await this.analyticsService.getRecentEvents({ from, to, type, sessionId, limit });
    const labels = await this.labelsFor(events.map((event) => event.path));

    res.status(200).json(successResponse({ events: events.map((event) => ({ ...event, ip: anonymizeIp(event.ip), pathLabel: labels.get(event.path || '') })) }));
  }

  /**
   * Simple real "journeys": the most common first page sequences per session
   * over the last N days, built from page_view events. No fabricated funnels.
   */
  async getJourneys(req: Request, res: Response): Promise<void> {
    if (this.storeKind !== 'mongo') {
      res.status(501).json({ success: false, code: 'unsupported_store', message: 'Los recorridos solo se calculan con el almacenamiento Mongo (ANALYTICS_STORE=valkey activo).' });
      return;
    }
    if (!this.requireStorage(res)) return;
    const days = Math.min(Math.max(this.parseNumber(req.query.days, 7), 1), 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const exclusions = await analyticsExclusions();
    const sessions = await AnalyticsEventModel.aggregate([
      { $match: { ...exclusions.events, type: 'page_view', occurredAt: { $gte: since }, path: { $exists: true, $ne: '' } } },
      { $sort: { occurredAt: 1 } },
      { $group: { _id: '$sessionId', paths: { $push: '$path' }, last: { $max: '$occurredAt' } } },
      { $sort: { last: -1 } },
      { $limit: 5000 },
    ]).exec();

    const sequences = new Map<string, { steps: string[]; count: number }>();
    for (const session of sessions) {
      const steps: string[] = [];
      for (const path of session.paths as string[]) {
        if (steps[steps.length - 1] !== path) steps.push(path);
        if (steps.length === 3) break;
      }
      if (!steps.length) continue;
      const key = steps.join(' → ');
      const entry = sequences.get(key) || { steps, count: 0 };
      entry.count += 1;
      sequences.set(key, entry);
    }

    const top = Array.from(sequences.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const labels = await this.labelsFor(top.flatMap((journey) => journey.steps));
    const journeys = top.map((journey) => ({ ...journey, labels: journey.steps.map((step) => labels.get(step) || step) }));

    res.status(200).json(successResponse({ days, sessionsAnalyzed: sessions.length, journeys }));
  }

  private async labelsFor(paths: Array<string | undefined>): Promise<Map<string, string>> {
    if (!this.labels) return new Map();
    try {
      return await this.labels.resolve(paths.filter((path): path is string => Boolean(path)));
    } catch {
      return new Map(); // labels are cosmetic: a lookup failure never fails the report
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  private parseNumber(
    input: unknown,
    fallback: number
  ): number {
    const parsed = typeof input === 'string' ? Number(input) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseDate(
    input: unknown,
    fallback?: Date
  ): Date | undefined {
    if (typeof input !== 'string') return fallback;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private getClientInfo(req: Request): {
    ip: string;
    userAgent: string;
    language: string | undefined;
    referrer: string | undefined;
  } {
    // Default trusted proxy = the local nginx (loopback): ports 3000/4000 are closed to the outside, so a loopback
    // peer is nginx, which appends the real peer to X-Forwarded-For. Without this default every visitor resolved to
    // 127.0.0.1 — an always-excluded address — and analytics silently counted nothing.
    const trusted = process.env.ANALYTICS_TRUSTED_PROXIES?.trim() || '127.0.0.1,::1';
    const ip = analyticsClientIp(req.socket.remoteAddress, req.get('X-Forwarded-For'), trusted);

    return {
      ip,
      userAgent: String(req.headers['user-agent'] || ''),
      language: typeof req.headers['accept-language'] === 'string'
        ? req.headers['accept-language'].split(',')[0]
        : undefined,
      referrer: typeof req.headers['referer'] === 'string'
        ? req.headers['referer']
        : undefined,
    };
  }

  private getGeography(req: Request): { country?: string; region?: string; city?: string; latitude?: number; longitude?: number } {
    if (!isTrustedAnalyticsProxy(req.socket.remoteAddress, process.env.ANALYTICS_GEO_TRUSTED_PROXIES || '')) return {};
    const country = req.get('CF-IPCountry');
    const region = req.get('CF-Region-Code');
    const validCountry = country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : undefined;
    const detailTrusted = isTrustedAnalyticsProxy(req.socket.remoteAddress, process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES || '');
    const rawCity = detailTrusted ? req.get('CF-IPCity') : undefined;
    const city = validCountry && rawCity && rawCity.length <= 100 && !/[\x00-\x1f\x7f]/.test(rawCity) ? rawCity.trim() || undefined : undefined;
    const lat = detailTrusted ? req.get('CF-IPLatitude') : undefined;
    const lon = detailTrusted ? req.get('CF-IPLongitude') : undefined;
    const latitude = lat && /^-?\d{1,3}(?:\.\d+)?$/.test(lat) ? Number(lat) : NaN;
    const longitude = lon && /^-?\d{1,3}(?:\.\d+)?$/.test(lon) ? Number(lon) : NaN;
    const validCoordinates = validCountry && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    return {
      country: validCountry,
      region: validCountry && region && /^[A-Za-z0-9-]{1,10}$/.test(region) ? region : undefined,
      city,
      latitude: validCoordinates ? Math.round(latitude * 10) / 10 : undefined,
      longitude: validCoordinates ? Math.round(longitude * 10) / 10 : undefined,
    };
  }
}
