import { Request, Response } from 'express';
import { AnalyticsService } from '../../application/services/AnalyticsService';
import { AnalyticsEventModel } from '../../infrastructure/database/models/AnalyticsEvent.model';
import { successResponse } from '../../shared/types/ApiResponse';
import { ValidationError } from '../../shared/errors';
import { analyticsExclusions } from '../../infrastructure/repositories/analyticsExclusions';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import { analyticsClientIp, isTrustedAnalyticsProxy } from './analyticsClientIp';
import { LIVE_IDLE_LIMIT_SECONDS } from '../../infrastructure/repositories/analyticsActivity';

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  async markExcludedSession(sessionId: string): Promise<void> {
    await this.analyticsService.markExcludedSession(sessionId);
  }

  async startSession(req: Request, res: Response): Promise<void> {
    const {
      sessionId,
      anonId,
      userId,
      initialPath,
      lastPath,
      referrer,
      metadata,
      screen,
      viewport,
      timezone,
      startedAt,
    } = req.body || {};

    if (!sessionId || !anonId) {
      throw new ValidationError('Missing required session fields', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
        { field: 'anonId', message: 'anonId is required', value: anonId },
      ]);
    }

    const now = this.parseDate(startedAt, new Date()) as Date;
    const client = this.getClientInfo(req);

    await this.analyticsService.startSession({
      sessionId,
      anonId,
      userId,
      startedAt: now,
      lastSeenAt: now,
      initialPath,
      lastPath,
      referrer: referrer || client.referrer,
      userAgent: client.userAgent,
      ip: client.ip,
      excluded: (req as AuthenticatedRequest).user?.role === 'admin',
      ...this.getGeography(req),
      language: client.language,
      timezone,
      screen,
      viewport,
      metadata,
    });

    await this.analyticsService.trackEvent({
      sessionId,
      anonId,
      userId,
      type: 'session_start',
      name: 'session_start',
      path: initialPath || lastPath,
      referrer: referrer || client.referrer,
      occurredAt: now,
      data: { screen, viewport },
      userAgent: client.userAgent,
      ip: client.ip,
      language: client.language,
      timezone,
    });

    res.status(201).json(successResponse({ sessionId }));
  }

  async heartbeatSession(req: Request, res: Response): Promise<void> {
    const { sessionId, lastPath, metadata, lastSeenAt } = req.body || {};

    if (!sessionId) {
      throw new ValidationError('Missing sessionId', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
      ]);
    }

    const now = this.parseDate(lastSeenAt, new Date()) as Date;

    const updated = await this.analyticsService.heartbeatSession({
      sessionId,
      lastSeenAt: now,
      lastPath,
      metadata,
    });

    res.status(200).json(successResponse({ session: updated }));
  }

  async endSession(req: Request, res: Response): Promise<void> {
    const { sessionId, lastPath, endReason, endedAt } = req.body || {};

    if (!sessionId) {
      throw new ValidationError('Missing sessionId', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
      ]);
    }

    const now = this.parseDate(endedAt, new Date()) as Date;

    const updated = await this.analyticsService.endSession({
      sessionId,
      endedAt: now,
      lastSeenAt: now,
      lastPath,
      endReason,
    });

    if (updated?.anonId) {
      const client = this.getClientInfo(req);
      await this.analyticsService.trackEvent({
        sessionId,
        anonId: updated.anonId,
        userId: updated.userId,
        type: 'session_end',
        name: 'session_end',
        path: lastPath || updated.lastPath,
        occurredAt: now,
        data: { endReason, durationSec: updated.durationSec },
        userAgent: client.userAgent,
        ip: client.ip,
        language: client.language,
        timezone: updated.timezone,
      });
    }

    res.status(200).json(successResponse({ session: updated }));
  }

  async trackEvent(req: Request, res: Response): Promise<void> {
    const {
      eventId,
      sessionId,
      anonId,
      userId,
      type,
      name,
      path,
      title,
      referrer,
      occurredAt,
      data,
      timezone,
    } = req.body || {};

    if (!sessionId || !anonId || !type) {
      throw new ValidationError('Missing required event fields', [
        { field: 'sessionId', message: 'sessionId is required', value: sessionId },
        { field: 'anonId', message: 'anonId is required', value: anonId },
        { field: 'type', message: 'type is required', value: type },
      ]);
    }

    const client = this.getClientInfo(req);
    const occurred = this.parseDate(occurredAt, new Date()) as Date;

    await this.analyticsService.trackEvent({
      eventId,
      sessionId,
      anonId,
      userId,
      type,
      name,
      path,
      title,
      referrer: referrer || client.referrer,
      occurredAt: occurred,
      data,
      userAgent: client.userAgent,
      ip: client.ip,
      language: client.language,
      timezone,
    });

    res.status(201).json(successResponse({ ok: true }));
  }

  async getLive(req: Request, res: Response): Promise<void> {
    const windowSec = this.parseNumber(req.query.windowSec, 90);
    const limit = this.parseNumber(req.query.limit, 50);

    const snapshot = await this.analyticsService.getLiveSnapshot(
      windowSec,
      limit
    );

    res.status(200).json(
      successResponse({
        activeCount: snapshot.activeCount,
        sessions: snapshot.sessions,
        idleTimeoutSec: LIVE_IDLE_LIMIT_SECONDS,
      })
    );
  }

  async getRealtimePages(_req: Request, res: Response): Promise<void> {
    const report = await this.analyticsService.getRealtimePages();
    if (!report) {
      res.status(503).json({ success: false, message: 'El almacenamiento activo no permite calcular este informe de forma fiable.' });
      return;
    }
    res.status(200).json(successResponse({ report }));
  }

  async getOverview(req: Request, res: Response): Promise<void> {
    const from =
      this.parseDate(
        req.query.from,
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      ) || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = this.parseDate(req.query.to, new Date()) || new Date();
    const liveWindowSec = this.parseNumber(req.query.windowSec, 90);

    const overview = await this.analyticsService.getOverview(from, to, liveWindowSec);

    res.status(200).json(successResponse({ range: { from, to }, overview: {
      ...overview,
      geographyConfigured: Boolean((process.env.ANALYTICS_GEO_TRUSTED_PROXIES || '').split(',').some((ip) => ip.trim())),
      geographyDetailConfigured: Boolean((process.env.ANALYTICS_GEO_DETAIL_TRUSTED_PROXIES || '').split(',').some((ip) => ip.trim())),
    } }));
  }

  async getEvents(req: Request, res: Response): Promise<void> {
    const from = this.parseDate(req.query.from, undefined);
    const to = this.parseDate(req.query.to, undefined);
    const limit = this.parseNumber(req.query.limit, 50);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const sessionId =
      typeof req.query.sessionId === 'string'
        ? req.query.sessionId
        : undefined;

    const events = await this.analyticsService.getRecentEvents({
      from,
      to,
      type,
      sessionId,
      limit,
    });

    res.status(200).json(successResponse({ events }));
  }

  /**
   * Simple real "journeys": the most common first page sequences per session
   * over the last N days, built from page_view events. No fabricated funnels.
   */
  async getJourneys(req: Request, res: Response): Promise<void> {
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

    const journeys = Array.from(sequences.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.status(200).json(successResponse({ days, sessionsAnalyzed: sessions.length, journeys }));
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
    const ip = analyticsClientIp(req.socket.remoteAddress, req.get('X-Forwarded-For'), process.env.ANALYTICS_TRUSTED_PROXIES || '');

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
