import { createClient, RedisClientType } from 'redis';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { excludedAnalyticsIps } from './analyticsExclusions';
import { isLongIdle } from './analyticsActivity';
import {
  AnalyticsEventQuery,
  AnalyticsEventRecord,
  AnalyticsOverview,
  AnalyticsRealtimePages,
  AnalyticsSessionRecord,
  IAnalyticsRepository,
} from '../../domain/repositories/IAnalyticsRepository';
import { logger } from '../../shared/utils/logger';

type PiiMode = 'full' | 'anonymized' | 'none';

const DEFAULT_TTL_DAYS = Number.parseInt(
  process.env.ANALYTICS_TTL_DAYS || '14',
  10
);
const DEFAULT_EVENT_LOG_MAX = Number.parseInt(
  process.env.ANALYTICS_EVENT_LOG_MAX || '5000',
  10
);
const DEFAULT_TOP_LIMIT = Number.parseInt(
  process.env.ANALYTICS_TOP_LIMIT || '200',
  10
);

export class ValkeyAnalyticsRepository implements IAnalyticsRepository {
  private readonly realtimeKey = 'analytics:realtime:events:v2';
  private readonly realtimeCoverageKey = 'analytics:realtime:coverage:v2';
  private coverageResetRequired = false;

  private realtimeSessionKey(sessionId: string): string { return `analytics:realtime:session:v2:${sessionId}`; }
  private normalizeIp(ip?: string): string {
    const kind = ip ? isIP(ip) : 0;
    if (!ip || !kind) return '';
    return new URL(`http://[${kind === 4 ? `::ffff:${ip}` : ip}]/`).hostname;
  }
  private exclusionPolicy(): { ips: Set<string>; fingerprint: string } {
    const values = [...new Set(excludedAnalyticsIps().map((ip) => this.normalizeIp(ip)).filter(Boolean))].sort();
    return { ips: new Set(values), fingerprint: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
  }

  async markExcludedSession(sessionId: string): Promise<void> {
    if (!this.canUse()) throw new Error('Valkey no está disponible para excluir la sesión');
    const key = this.realtimeSessionKey(sessionId);
    await this.client.multi().hSet(key, { excluded: '1' }).expire(key, this.ttlSeconds).exec();
  }

  async getRealtimePages(to: Date): Promise<AnalyticsRealtimePages | null> {
    if (!this.canUse()) return null;
    if (this.coverageResetRequired) {
      await this.client.set(this.realtimeCoverageKey, String(Date.now()));
      this.coverageResetRequired = false;
    }
    await this.client.set(this.realtimeCoverageKey, String(Date.now()), { NX: true });
    const coverage = Number(await this.client.get(this.realtimeCoverageKey));
    if (!Number.isFinite(coverage) || coverage <= 0) throw new Error('Cobertura de Analytics no disponible');
    const from = new Date(to.getTime() - 30 * 60_000);
    const [records, legacyRecords] = await Promise.all([
      this.client.zRangeByScore(this.realtimeKey, from.getTime() + 1, to.getTime()),
      this.client.lRange(this.eventsKey, 0, this.eventLogMax - 1),
    ]);
    const events = records.map((record) => {
      const parsed = this.safeJsonParse<{ eventId: string; sessionId: string; anonId: string; type: string; path?: string; ipKnown: boolean; ipExcluded: boolean; policy: string; timestamp: number }>(record);
      if (!parsed || typeof parsed.sessionId !== 'string' || typeof parsed.anonId !== 'string' || !Number.isFinite(parsed.timestamp)) throw new Error('Registro de Analytics en tiempo real no válido');
      return parsed;
    });
    const sessionIds = [...new Set(events.map((event) => event.sessionId))];
    const pipeline = this.client.multi();
    for (const id of sessionIds) pipeline.hGetAll(this.realtimeSessionKey(id));
    const replies = sessionIds.length ? await pipeline.exec() : [];
    const sessions = new Map(sessionIds.map((id, index) => [id, this.normalizeHashReply(replies[index]) || {}]));
    const policy = this.exclusionPolicy();
    const users = new Set<string>();
    const minuteUsers = Array.from({ length: 30 }, () => new Set<string>());
    const pages = new Map<string, { users: Set<string>; views: number }>();
    let pageViews = 0;
    const indexedIds = new Set(events.map((event) => event.eventId));
    let partial = from.getTime() < coverage || legacyRecords.length >= this.eventLogMax;
    for (const raw of legacyRecords) {
      const event = this.safeJsonParse<AnalyticsEventRecord>(raw);
      if (!event) { partial = true; continue; }
      const timestamp = new Date(event.occurredAt).getTime();
      if (!Number.isFinite(timestamp)) { partial = true; continue; }
      if (timestamp > from.getTime() && timestamp <= to.getTime() && (!event.eventId || !indexedIds.has(event.eventId))) partial = true;
    }
    for (const event of events) {
      const session = sessions.get(event.sessionId)!;
      if (session.excluded === '1') continue;
      if (session.covered !== '1' || session.policy !== policy.fingerprint || event.policy !== policy.fingerprint || session.ipKnown !== '1' || !event.ipKnown) { partial = true; continue; }
      if (session.ipExcluded === '1' || event.ipExcluded) continue;
      if (!event.anonId) continue;
      const index = Math.floor((to.getTime() - event.timestamp) / 60_000);
      if (index < 0 || index >= 30) continue;
      users.add(event.anonId);
      minuteUsers[29 - index].add(event.anonId);
      if (event.type === 'page_view') pageViews++;
      if (event.path) {
        const page = pages.get(event.path) || { users: new Set<string>(), views: 0 };
        page.users.add(event.anonId);
        if (event.type === 'page_view') page.views++;
        pages.set(event.path, page);
      }
    }
    return { from, to, activeUsers: users.size, pageViews, partial, coverageStartedAt: new Date(coverage),
      minutes: minuteUsers.map((set, index) => ({ from: new Date(to.getTime() - (30 - index) * 60_000), users: set.size })),
      pages: [...pages].map(([path, page]) => ({ path, users: page.users.size, views: page.views })).sort((a, b) => b.users - a.users || a.path.localeCompare(b.path)),
    };
  }
  private client: RedisClientType;
  private isConnected = false;
  private warnedDisconnected = false;

  private readonly ttlSeconds =
    Number.isFinite(DEFAULT_TTL_DAYS) && DEFAULT_TTL_DAYS > 0
      ? DEFAULT_TTL_DAYS * 24 * 60 * 60
      : 14 * 24 * 60 * 60;
  private readonly eventLogMax =
    Number.isFinite(DEFAULT_EVENT_LOG_MAX) && DEFAULT_EVENT_LOG_MAX > 0
      ? DEFAULT_EVENT_LOG_MAX
      : 5000;
  private readonly topLimit =
    Number.isFinite(DEFAULT_TOP_LIMIT) && DEFAULT_TOP_LIMIT > 0
      ? DEFAULT_TOP_LIMIT
      : 200;
  private readonly piiMode: PiiMode = this.parsePiiMode(
    process.env.ANALYTICS_PII
  );

  private readonly liveKey = 'analytics:sessions:live';
  private readonly eventsKey = 'analytics:events';

  constructor(
    private readonly redisUrl: string,
    private readonly options?: {
      maxRetries?: number;
      connectTimeout?: number;
    }
  ) {
    this.client = createClient({
      url: this.redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          const maxRetries = this.options?.maxRetries || 10;
          if (retries >= maxRetries) {
            return new Error('Valkey max retries reached');
          }
          return Math.min(retries * 50, 2000);
        },
        connectTimeout: this.options?.connectTimeout || 10000,
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('[Analytics] Connecting to Valkey...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.warnedDisconnected = false;
      logger.info('[Analytics] Valkey connection ready');
    });

    this.client.on('error', (err: Error) => {
      this.isConnected = false;
      this.coverageResetRequired = true;
      logger.error('[Analytics] Valkey error', { error: err });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      this.coverageResetRequired = true;
      logger.warn('[Analytics] Valkey connection closed');
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    await this.client.connect();
    this.isConnected = true;
  }

  async startSession(payload: AnalyticsSessionRecord): Promise<void> {
    if (!this.canUse()) return;

    const nowMs = payload.lastSeenAt.getTime();
    const day = this.toDay(payload.startedAt);
    const sessionKey = this.sessionKey(payload.sessionId);
    const existedBeforeIndex = await this.client.exists(sessionKey);
    const pipeline = this.client.multi();

    const realtimeSession = this.realtimeSessionKey(payload.sessionId);
    if (!existedBeforeIndex) {
      const policy = this.exclusionPolicy();
      const ip = this.normalizeIp(payload.ip);
      pipeline.hSetNX(realtimeSession, 'covered', '1');
      pipeline.hSetNX(realtimeSession, 'ipKnown', ip ? '1' : '0');
      pipeline.hSetNX(realtimeSession, 'ipExcluded', policy.ips.has(ip) ? '1' : '0');
      pipeline.hSetNX(realtimeSession, 'policy', policy.fingerprint);
    }
    if (payload.excluded) pipeline.hSet(realtimeSession, { excluded: '1' });
    pipeline.expire(realtimeSession, this.ttlSeconds);

    pipeline.hSet(sessionKey, this.buildSessionMap(payload));
    pipeline.expire(sessionKey, this.ttlSeconds);
    if (isLongIdle(payload.metadata)) pipeline.zRem(this.liveKey, payload.sessionId);
    else pipeline.zAdd(this.liveKey, [{ score: nowMs, value: payload.sessionId }]);
    pipeline.incr(this.sessionCountKey(day));
    pipeline.expire(this.sessionCountKey(day), this.ttlSeconds);
    pipeline.pfAdd(this.uniqueKey(day), payload.anonId);
    pipeline.expire(this.uniqueKey(day), this.ttlSeconds);

    await pipeline.exec();
  }

  async heartbeatSession(payload: {
    sessionId: string;
    lastSeenAt: Date;
    lastPath?: string;
    metadata?: Record<string, any>;
  }): Promise<AnalyticsSessionRecord | null> {
    if (!this.canUse()) return null;

    const nowMs = payload.lastSeenAt.getTime();
    const sessionKey = this.sessionKey(payload.sessionId);
    const activityMetadata = payload.metadata ?? this.safeJsonParse(await this.client.hGet(sessionKey, 'metadata'));
    const updateMap: Record<string, string> = {
      sessionId: payload.sessionId,
      lastSeenAt: payload.lastSeenAt.toISOString(),
    };
    if (payload.lastPath) {
      updateMap.lastPath = payload.lastPath;
    }
    if (payload.metadata) {
      updateMap.metadata = JSON.stringify(payload.metadata);
    }

    const pipeline = this.client.multi();
    pipeline.hSet(sessionKey, updateMap);
    pipeline.expire(sessionKey, this.ttlSeconds);
    if (isLongIdle(activityMetadata)) pipeline.zRem(this.liveKey, payload.sessionId);
    else pipeline.zAdd(this.liveKey, [{ score: nowMs, value: payload.sessionId }]);
    await pipeline.exec();

    return this.fetchSession(payload.sessionId);
  }

  async endSession(payload: {
    sessionId: string;
    endedAt: Date;
    lastSeenAt: Date;
    lastPath?: string;
    endReason?: string;
  }): Promise<AnalyticsSessionRecord | null> {
    if (!this.canUse()) return null;

    const session = await this.fetchSession(payload.sessionId);
    const durationSec = session?.startedAt
      ? Math.max(
          0,
          Math.round(
            (payload.endedAt.getTime() - session.startedAt.getTime()) / 1000
          )
        )
      : undefined;

    const updateMap: Record<string, string> = {
      endedAt: payload.endedAt.toISOString(),
      lastSeenAt: payload.lastSeenAt.toISOString(),
    };
    if (payload.lastPath) {
      updateMap.lastPath = payload.lastPath;
    }
    if (payload.endReason) {
      updateMap.endReason = payload.endReason;
    }
    if (durationSec !== undefined) {
      updateMap.durationSec = String(durationSec);
    }

    const pipeline = this.client.multi();
    pipeline.hSet(this.sessionKey(payload.sessionId), updateMap);
    pipeline.expire(this.sessionKey(payload.sessionId), this.ttlSeconds);
    pipeline.zRem(this.liveKey, payload.sessionId);

    if (durationSec !== undefined) {
      const day = this.toDay(payload.endedAt);
      pipeline.incrBy(this.durationSumKey(day), durationSec);
      pipeline.incr(this.durationCountKey(day));
      pipeline.expire(this.durationSumKey(day), this.ttlSeconds);
      pipeline.expire(this.durationCountKey(day), this.ttlSeconds);
    }

    await pipeline.exec();

    return this.fetchSession(payload.sessionId);
  }

  async createEvent(payload: AnalyticsEventRecord): Promise<void> {
    if (!this.canUse()) return;

    const occurredAt = payload.occurredAt || new Date();
    const day = this.toDay(occurredAt);
    const event = this.buildEventRecord(payload, occurredAt);

    const pipeline = this.client.multi();
    const policy = this.exclusionPolicy();
    const ip = this.normalizeIp(payload.ip);
    pipeline.set(this.realtimeCoverageKey, String(Date.now()), { NX: true });
    pipeline.zAdd(this.realtimeKey, [{ score: occurredAt.getTime(), value: JSON.stringify({ eventId: payload.eventId, sessionId: payload.sessionId, anonId: payload.anonId, type: payload.type, path: payload.path, ipKnown: Boolean(ip), ipExcluded: policy.ips.has(ip), policy: policy.fingerprint, timestamp: occurredAt.getTime() }) }]);
    pipeline.zRemRangeByScore(this.realtimeKey, '-inf', Date.now() - 30 * 60_000);
    pipeline.expire(this.realtimeKey, 3600);
    pipeline.lPush(this.eventsKey, JSON.stringify(event));
    pipeline.lTrim(this.eventsKey, 0, this.eventLogMax - 1);
    pipeline.expire(this.eventsKey, this.ttlSeconds);

    if (payload.type === 'page_view') {
      pipeline.incr(this.pageViewKey(day));
      pipeline.expire(this.pageViewKey(day), this.ttlSeconds);
    }

    if (event.path) {
      pipeline.zIncrBy(this.topPagesKey(day), 1, event.path);
      pipeline.expire(this.topPagesKey(day), this.ttlSeconds);
      this.pruneTopSet(pipeline, this.topPagesKey(day));
    }

    if (event.referrer) {
      pipeline.zIncrBy(this.topReferrersKey(day), 1, event.referrer);
      pipeline.expire(this.topReferrersKey(day), this.ttlSeconds);
      this.pruneTopSet(pipeline, this.topReferrersKey(day));
    }

    await pipeline.exec();
  }

  async getLiveSessions(
    windowSec: number,
    limit: number
  ): Promise<AnalyticsSessionRecord[]> {
    if (!this.canUse()) return [];

    const now = Date.now();
    const min = now - windowSec * 1000;
    await this.client.zRemRangeByScore(
      this.liveKey,
      0,
      now - this.ttlSeconds * 1000
    );

    const sessionIds = await this.client.zRange(
      this.liveKey,
      now,
      min,
      { BY: 'SCORE', REV: true, LIMIT: { offset: 0, count: limit } }
    );

    if (!sessionIds.length) return [];

    const pipeline = this.client.multi();
    sessionIds.forEach((sessionId) => pipeline.hGetAll(this.sessionKey(sessionId)));
    const results = await pipeline.exec();

    const sessions: AnalyticsSessionRecord[] = [];
    results.forEach((result, index) => {
      const normalized = this.normalizeHashReply(result);
      const parsed = this.parseSessionMap(normalized, sessionIds[index]);
      if (parsed) sessions.push(parsed);
    });

    return sessions;
  }

  async countLiveSessions(windowSec: number): Promise<number> {
    if (!this.canUse()) return 0;
    const now = Date.now();
    const min = now - windowSec * 1000;
    return this.client.zCount(this.liveKey, min, now);
  }

  async getOverview(
    from: Date,
    to: Date,
    liveWindowSec: number
  ): Promise<AnalyticsOverview> {
    if (!this.canUse()) {
      return this.emptyOverview();
    }

    const days = this.buildDays(from, to);
    const sessionKeys = days.map((day) => this.sessionCountKey(day));
    const pageKeys = days.map((day) => this.pageViewKey(day));
    const durationSumKeys = days.map((day) => this.durationSumKey(day));
    const durationCountKeys = days.map((day) => this.durationCountKey(day));
    const uniqueKeys = days.map((day) => this.uniqueKey(day));

    const [sessionCounts, pageCounts, durationSums, durationCounts] =
      await Promise.all([
        this.client.mGet(sessionKeys),
        this.client.mGet(pageKeys),
        this.client.mGet(durationSumKeys),
        this.client.mGet(durationCountKeys),
      ]);

    const sessionsByDay = days.map((day, index) => ({
      date: day,
      count: this.toNumber(sessionCounts[index]),
    }));

    const totalSessions = sessionsByDay.reduce((acc, item) => acc + item.count, 0);
    const totalPageViews = pageCounts.reduce(
      (acc, value) => acc + this.toNumber(value),
      0
    );

    const durationSum = durationSums.reduce(
      (acc, value) => acc + this.toNumber(value),
      0
    );
    const durationCount = durationCounts.reduce(
      (acc, value) => acc + this.toNumber(value),
      0
    );

    const uniqueVisitors = await this.countUniques(uniqueKeys);

    const [topPages, topReferrers, activeNow] = await Promise.all([
      this.aggregateTopPages(days),
      this.aggregateTopReferrers(days),
      this.countLiveSessions(liveWindowSec),
    ]);

    return {
      activeNow,
      totalSessions,
      uniqueVisitors,
      totalPageViews,
      avgSessionDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
      topPages,
      topReferrers,
      sessionsByDay,
      aggregateLimitations: true,
      geographyCollectionEnabled: this.piiMode !== 'none',
    };
  }

  async getRecentEvents(
    query: AnalyticsEventQuery
  ): Promise<AnalyticsEventRecord[]> {
    if (!this.canUse()) return [];

    const limit = query.limit ?? 50;
    const fetchLimit = Math.min(
      this.eventLogMax,
      Math.max(limit * 5, 200)
    );

    const rawEvents = await this.client.lRange(this.eventsKey, 0, fetchLimit - 1);
    if (!rawEvents.length) return [];

    const filtered: AnalyticsEventRecord[] = [];
    for (const raw of rawEvents) {
      const parsed = this.safeJsonParse<AnalyticsEventRecord>(raw);
      if (!parsed) continue;
      const occurredAt = parsed.occurredAt ? new Date(parsed.occurredAt as any) : undefined;
      if (query.from && occurredAt && occurredAt < query.from) continue;
      if (query.to && occurredAt && occurredAt > query.to) continue;
      if (query.type && parsed.type !== query.type) continue;
      if (query.sessionId && parsed.sessionId !== query.sessionId) continue;
      filtered.push({
        ...parsed,
        occurredAt: occurredAt || new Date(),
      });
      if (filtered.length >= limit) break;
    }

    return filtered;
  }

  private canUse(): boolean {
    if (this.isConnected) return true;
    if (!this.warnedDisconnected) {
      logger.warn('[Analytics] Valkey not connected, analytics will be skipped');
      this.warnedDisconnected = true;
    }
    return false;
  }

  private buildSessionMap(payload: AnalyticsSessionRecord): Record<string, string> {
    const map: Record<string, string> = {
      sessionId: payload.sessionId,
      anonId: payload.anonId,
      startedAt: payload.startedAt.toISOString(),
      lastSeenAt: payload.lastSeenAt.toISOString(),
    };

    if (payload.userId) map.userId = payload.userId;
    if (payload.initialPath) map.initialPath = payload.initialPath;
    if (payload.lastPath) map.lastPath = payload.lastPath;
    if (payload.referrer) map.referrer = payload.referrer;
    if (this.piiMode !== 'none') {
      if (payload.country) map.country = payload.country;
      if (payload.region) map.region = payload.region;
      if (payload.city) map.city = payload.city;
      if (payload.latitude !== undefined) map.latitude = String(payload.latitude);
      if (payload.longitude !== undefined) map.longitude = String(payload.longitude);
    }

    const userAgent = this.sanitizeUserAgent(payload.userAgent);
    const ip = this.sanitizeIp(payload.ip);

    if (userAgent) map.userAgent = userAgent;
    if (ip) map.ip = ip;
    if (payload.language) map.language = payload.language;
    if (payload.timezone) map.timezone = payload.timezone;
    if (payload.screen) map.screen = JSON.stringify(payload.screen);
    if (payload.viewport) map.viewport = JSON.stringify(payload.viewport);
    if (payload.metadata) map.metadata = JSON.stringify(payload.metadata);

    return map;
  }

  private buildEventRecord(payload: AnalyticsEventRecord, occurredAt: Date): AnalyticsEventRecord {
    return {
      ...payload,
      occurredAt,
      userAgent: this.sanitizeUserAgent(payload.userAgent),
      ip: this.sanitizeIp(payload.ip),
    };
  }

  private async fetchSession(sessionId: string): Promise<AnalyticsSessionRecord | null> {
    const data = await this.client.hGetAll(this.sessionKey(sessionId));
    return this.parseSessionMap(this.normalizeHashReply(data));
  }

  private parseSessionMap(
    data?: Record<string, string> | null,
    fallbackSessionId?: string
  ): AnalyticsSessionRecord | null {
    const safe = data ?? {};
    const sessionId = safe.sessionId || fallbackSessionId;
    if (!sessionId) return null;
    const anonId = safe.anonId || fallbackSessionId || 'unknown';
    const startedAt =
      this.toDate(safe.startedAt) ||
      this.toDate(safe.lastSeenAt) ||
      new Date();
    const lastSeenAt = this.toDate(safe.lastSeenAt) || new Date();
    return {
      sessionId,
      anonId,
      userId: safe.userId,
      startedAt,
      lastSeenAt,
      endedAt: this.toDate(safe.endedAt),
      endReason: safe.endReason,
      durationSec: safe.durationSec ? Number(safe.durationSec) : Math.max(0, Math.floor((lastSeenAt.getTime() - startedAt.getTime()) / 1000)),
      initialPath: safe.initialPath,
      lastPath: safe.lastPath,
      referrer: safe.referrer,
      userAgent: this.sanitizeUserAgent(safe.userAgent),
      ip: this.sanitizeIp(safe.ip),
      country: this.piiMode === 'none' ? undefined : safe.country,
      region: this.piiMode === 'none' ? undefined : safe.region,
      city: this.piiMode === 'none' ? undefined : safe.city,
      latitude: this.piiMode !== 'none' && safe.latitude !== undefined && Number.isFinite(Number(safe.latitude)) ? Number(safe.latitude) : undefined,
      longitude: this.piiMode !== 'none' && safe.longitude !== undefined && Number.isFinite(Number(safe.longitude)) ? Number(safe.longitude) : undefined,
      language: safe.language,
      timezone: safe.timezone,
      screen: this.safeJsonParse(safe.screen),
      viewport: this.safeJsonParse(safe.viewport),
      metadata: this.safeJsonParse(safe.metadata),
    };
  }

  private normalizeHashReply(data: unknown): Record<string, string> | null {
    if (!data) return null;
    if (data instanceof Map) {
      const normalized: Record<string, string> = {};
      data.forEach((value, key) => {
        if (key === undefined || key === null) return;
        normalized[String(key)] = value === undefined || value === null ? '' : String(value);
      });
      return normalized;
    }
    if (Array.isArray(data)) {
      const normalized: Record<string, string> = {};
      for (let i = 0; i < data.length; i += 2) {
        const key = data[i];
        const value = data[i + 1];
        if (key === undefined || key === null) continue;
        normalized[String(key)] = value === undefined || value === null ? '' : String(value);
      }
      return normalized;
    }
    if (typeof data === 'object') {
      return data as Record<string, string>;
    }
    return null;
  }

  private async countUniques(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    if (keys.length === 1) {
      return this.client.pfCount(keys[0]);
    }
    const tmpKey = `analytics:uniques:tmp:${Date.now()}`;
    await this.client.pfMerge(tmpKey, keys);
    await this.client.expire(tmpKey, 60);
    return this.client.pfCount(tmpKey);
  }

  private async aggregateTopPages(days: string[]): Promise<Array<{ path: string; count: number }>> {
    if (this.topLimit <= 0) return [];
    const aggregate = new Map<string, number>();
    await Promise.all(
      days.map(async (day) => {
        const entries = await this.client.zRangeWithScores(
          this.topPagesKey(day),
          0,
          Math.max(0, this.topLimit - 1),
          { REV: true }
        );
        entries.forEach((entry) => {
          aggregate.set(
            entry.value,
            (aggregate.get(entry.value) || 0) + entry.score
          );
        });
      })
    );

    return Array.from(aggregate.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));
  }

  private async aggregateTopReferrers(days: string[]): Promise<Array<{ referrer: string; count: number }>> {
    if (this.topLimit <= 0) return [];
    const aggregate = new Map<string, number>();
    await Promise.all(
      days.map(async (day) => {
        const entries = await this.client.zRangeWithScores(
          this.topReferrersKey(day),
          0,
          Math.max(0, this.topLimit - 1),
          { REV: true }
        );
        entries.forEach((entry) => {
          aggregate.set(
            entry.value,
            (aggregate.get(entry.value) || 0) + entry.score
          );
        });
      })
    );

    return Array.from(aggregate.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([referrer, count]) => ({ referrer, count }));
  }

  private pruneTopSet(pipeline: ReturnType<RedisClientType['multi']>, key: string): void {
    if (this.topLimit <= 0) return;
    pipeline.zRemRangeByRank(key, 0, -this.topLimit - 1);
  }

  private sessionKey(sessionId: string): string {
    return `analytics:session:${sessionId}`;
  }

  private sessionCountKey(day: string): string {
    return `analytics:sessions:count:${day}`;
  }

  private pageViewKey(day: string): string {
    return `analytics:pageviews:count:${day}`;
  }

  private uniqueKey(day: string): string {
    return `analytics:uniques:${day}`;
  }

  private durationSumKey(day: string): string {
    return `analytics:sessions:duration:sum:${day}`;
  }

  private durationCountKey(day: string): string {
    return `analytics:sessions:duration:count:${day}`;
  }

  private topPagesKey(day: string): string {
    return `analytics:top:pages:${day}`;
  }

  private topReferrersKey(day: string): string {
    return `analytics:top:referrers:${day}`;
  }

  private toDay(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private buildDays(from: Date, to: Date): string[] {
    const days: string[] = [];
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    return days;
  }

  private toDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private toNumber(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private parsePiiMode(value?: string): PiiMode {
    const normalized = (value || 'anonymized').toLowerCase();
    if (normalized === 'full' || normalized === 'none' || normalized === 'anonymized') {
      return normalized;
    }
    return 'anonymized';
  }

  private sanitizeUserAgent(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;
    if (this.piiMode === 'none') return undefined;
    return String(userAgent).slice(0, 180);
  }

  private sanitizeIp(ip?: string): string | undefined {
    if (!ip) return undefined;
    if (this.piiMode === 'none') return undefined;

    const normalized = ip.replace('::ffff:', '');
    if (this.piiMode === 'full') return normalized;

    if (normalized.includes(':')) {
      const parts = normalized.split(':');
      return `${parts.slice(0, 4).join(':')}::`;
    }

    const octets = normalized.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
    }
    return normalized;
  }

  private safeJsonParse<T = any>(value?: string | null): T | undefined {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  private emptyOverview(): AnalyticsOverview {
    return {
      activeNow: 0,
      totalSessions: 0,
      uniqueVisitors: 0,
      totalPageViews: 0,
      avgSessionDurationSec: 0,
      topPages: [],
      topReferrers: [],
      sessionsByDay: [],
    };
  }
}
