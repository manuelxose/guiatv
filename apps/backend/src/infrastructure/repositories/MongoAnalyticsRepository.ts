import * as mongoose from 'mongoose';
import { AnalyticsEventModel } from '../database/models/AnalyticsEvent.model';
import { analyticsPiiMode, anonymizeIp } from '../analytics/ipPrivacy';
import { AnalyticsSessionModel } from '../database/models/AnalyticsSession.model';
import { analyticsExclusions } from './analyticsExclusions';
import { LIVE_IDLE_LIMIT_SECONDS } from './analyticsActivity';
import {
  AnalyticsEventQuery,
  AnalyticsEventRecord,
  AnalyticsOverview,
  AnalyticsRealtimePages,
  AnalyticsSessionActivity,
  AnalyticsSessionRecord,
  IAnalyticsRepository,
} from '../../domain/repositories/IAnalyticsRepository';

/** Same privacy policy as the Valkey store: only a truncated prefix (or nothing) is ever written. */
function storedIp(ip?: string): string | undefined {
  return analyticsPiiMode() === 'none' ? undefined : anonymizeIp(ip);
}

function storedUserAgent(userAgent?: string): string | undefined {
  return analyticsPiiMode() === 'none' || !userAgent ? undefined : String(userAgent).slice(0, 180);
}

export class MongoAnalyticsRepository implements IAnalyticsRepository {
  isAvailable(): boolean {
    return mongoose.connection.readyState === 1;
  }

  async markExcludedSession(sessionId: string): Promise<void> {
    await AnalyticsSessionModel.updateOne({ sessionId }, { $set: { excluded: true } }).exec();
  }
  async getRealtimePages(to: Date): Promise<AnalyticsRealtimePages> {
    const from = new Date(to.getTime() - 30 * 60_000);
    const exclusions = await analyticsExclusions();
    const [result] = await AnalyticsEventModel.aggregate([
      { $match: { ...exclusions.events, occurredAt: { $gt: from, $lte: to }, anonId: { $type: 'string', $ne: '' } } },
      { $facet: {
        totals: [
          { $group: { _id: '$anonId', views: { $sum: { $cond: [{ $eq: ['$type', 'page_view'] }, 1, 0] } } } },
          { $group: { _id: null, users: { $sum: 1 }, views: { $sum: '$views' } } },
        ],
        minutes: [
          { $group: { _id: { minute: { $floor: { $divide: [{ $subtract: [to, '$occurredAt'] }, 60_000] } }, user: '$anonId' } } },
          { $group: { _id: '$_id.minute', users: { $sum: 1 } } },
        ],
        pages: [
          { $match: { path: { $type: 'string', $ne: '' } } },
          { $group: { _id: { path: '$path', user: '$anonId' }, views: { $sum: { $cond: [{ $eq: ['$type', 'page_view'] }, 1, 0] } } } },
          { $group: { _id: '$_id.path', users: { $sum: 1 }, views: { $sum: '$views' } } },
          { $project: { _id: 0, path: '$_id', users: 1, views: 1 } },
          { $sort: { users: -1, path: 1 } },
        ],
      } },
    ]).exec();
    const counts = new Map<number, number>(result.minutes.map((minute: { _id: number; users: number }) => [minute._id, minute.users]));
    return {
      from, to, activeUsers: result.totals[0]?.users || 0, pageViews: result.totals[0]?.views || 0,
      minutes: Array.from({ length: 30 }, (_, index) => ({ from: new Date(to.getTime() - (30 - index) * 60_000), users: counts.get(29 - index) || 0 })),
      pages: result.pages,
    };
  }
  async startSession(payload: AnalyticsSessionRecord): Promise<void> {
    const startedAt = payload.startedAt || new Date();
    const lastSeenAt = payload.lastSeenAt || startedAt;
    const setOnInsert: Record<string, any> = {
      sessionId: payload.sessionId,
      anonId: payload.anonId,
      userId: payload.userId,
      startedAt,
      initialPath: payload.initialPath,
      referrer: payload.referrer,
      userAgent: storedUserAgent(payload.userAgent),
      ip: storedIp(payload.ip),
      excluded: payload.excluded || false,
      ...(analyticsPiiMode() === 'none' ? {} : {
        country: payload.country,
        region: payload.region,
        city: payload.city,
        latitude: payload.latitude,
        longitude: payload.longitude,
        geo: payload.geo,
      }),
      language: payload.language,
      timezone: payload.timezone,
      screen: payload.screen,
      viewport: payload.viewport,
      // `metadata` must not appear in $setOnInsert: when it is also present in
      // the `$set` below, MongoDB rejects the upsert with
      // "Updating the path 'metadata' would create a conflict at 'metadata'".
      endedAt: null,
      durationSec: 0,
    };

    const set: Record<string, any> = {
      lastSeenAt,
    };

    if (payload.lastPath || payload.initialPath) {
      set.lastPath = payload.lastPath || payload.initialPath;
    }
    if (payload.metadata) {
      set.metadata = payload.metadata;
    }

    await AnalyticsSessionModel.updateOne(
      { sessionId: payload.sessionId },
      { $setOnInsert: setOnInsert, $set: set },
      { upsert: true }
    ).exec();
  }

  async heartbeatSession(payload: {
    sessionId: string;
    lastSeenAt: Date;
    lastPath?: string;
    metadata?: Record<string, any>;
    activity?: AnalyticsSessionActivity;
    resume?: boolean;
  }): Promise<AnalyticsSessionRecord | null> {
    const session = await AnalyticsSessionModel.findOne({
      sessionId: payload.sessionId,
    })
      .lean()
      .exec();
    if (!session) return null;

    const durationSec = this.calculateDurationSec(
      session.startedAt,
      payload.lastSeenAt
    );

    const update: Record<string, any> = {
      lastSeenAt: payload.lastSeenAt,
      durationSec,
    };
    if (payload.lastPath) {
      update.lastPath = payload.lastPath;
    }
    if (payload.metadata) {
      update.metadata = payload.metadata;
    } else if (payload.activity) {
      update['metadata.activity'] = payload.activity;
    }
    if (payload.resume) {
      update.endedAt = null;
    }

    const updated = await AnalyticsSessionModel.findOneAndUpdate(
      { sessionId: payload.sessionId },
      payload.resume ? { $set: update, $unset: { endReason: '' } } : { $set: update },
      { new: true }
    )
      .lean()
      .exec();

    return updated ? this.mapSession(updated) : this.mapSession(session);
  }

  async endSession(payload: {
    sessionId: string;
    endedAt: Date;
    lastSeenAt: Date;
    lastPath?: string;
    endReason?: string;
  }): Promise<AnalyticsSessionRecord | null> {
    const session = await AnalyticsSessionModel.findOne({
      sessionId: payload.sessionId,
    })
      .lean()
      .exec();
    if (!session) return null;

    const durationSec = this.calculateDurationSec(
      session.startedAt,
      payload.endedAt
    );

    const update: Record<string, any> = {
      endedAt: payload.endedAt,
      endReason: payload.endReason,
      lastSeenAt: payload.lastSeenAt,
      durationSec,
    };
    if (payload.lastPath) {
      update.lastPath = payload.lastPath;
    }

    const updated = await AnalyticsSessionModel.findOneAndUpdate(
      { sessionId: payload.sessionId },
      { $set: update },
      { new: true }
    )
      .lean()
      .exec();

    return updated ? this.mapSession(updated) : this.mapSession(session);
  }

  async createEvent(payload: AnalyticsEventRecord): Promise<void> {
    await this.createEvents([payload]);
  }

  async createEvents(payloads: AnalyticsEventRecord[]): Promise<void> {
    if (!payloads.length) return;
    // lean insert (no Mongoose document hydration): undefined fields are stripped so they are not stored as null.
    const docs = payloads.map((payload) => Object.fromEntries(Object.entries({
      ...payload,
      ip: storedIp(payload.ip),
      userAgent: storedUserAgent(payload.userAgent),
      occurredAt: payload.occurredAt || new Date(),
      createdAt: new Date(),
    }).filter(([, value]) => value !== undefined)));
    try {
      await AnalyticsEventModel.insertMany(docs, { ordered: false, lean: true });
    } catch (error) {
      // Idempotency: a retried batch re-sends the same eventIds; duplicates (E11000) are expected and ignored.
      // Decided on every write error: a mixed batch (one duplicate + a real failure) must still fail and be retried.
      const raw = (error as { writeErrors?: unknown }).writeErrors;
      const writeErrors = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ code?: number; err?: { code?: number } }>;
      const onlyDuplicates = writeErrors.length > 0
        ? writeErrors.every((e) => (e.code ?? e.err?.code) === 11000)
        : (error as { code?: number }).code === 11000;
      if (!onlyDuplicates) throw error;
    }
  }

  async getLiveSessions(
    windowSec: number,
    limit: number
  ): Promise<AnalyticsSessionRecord[]> {
    const now = new Date();
    const since = new Date(now.getTime() - windowSec * 1000);
    const exclusions = await analyticsExclusions();
    const sessions = await AnalyticsSessionModel.find({
      ...exclusions.sessions,
      lastSeenAt: { $gte: since, $lte: now },
      $nor: [{ 'metadata.activity.idleSec': { $gte: LIVE_IDLE_LIMIT_SECONDS } }],
      $or: [{ endedAt: null }, { endedAt: { $exists: false } }],
    })
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return sessions.map((session) => this.mapSession(session));
  }

  async countLiveSessions(windowSec: number): Promise<number> {
    const now = new Date();
    const since = new Date(now.getTime() - windowSec * 1000);
    const exclusions = await analyticsExclusions();
    return AnalyticsSessionModel.countDocuments({
      ...exclusions.sessions,
      lastSeenAt: { $gte: since, $lte: now },
      $nor: [{ 'metadata.activity.idleSec': { $gte: LIVE_IDLE_LIMIT_SECONDS } }],
      $or: [{ endedAt: null }, { endedAt: { $exists: false } }],
    }).exec();
  }

  async getOverview(
    from: Date,
    to: Date,
    liveWindowSec: number
  ): Promise<AnalyticsOverview> {
    const exclusions = await analyticsExclusions();
    const [totalSessions, uniqueVisitors, totalPageViews] = await Promise.all([
      AnalyticsSessionModel.countDocuments({
        ...exclusions.sessions,
        startedAt: { $gte: from, $lte: to },
      }).exec(),
      AnalyticsSessionModel.distinct('anonId', {
        ...exclusions.sessions,
        startedAt: { $gte: from, $lte: to },
      }).then((items) => items.length),
      AnalyticsEventModel.countDocuments({
        ...exclusions.events,
        type: 'page_view',
        occurredAt: { $gte: from, $lte: to },
      }).exec(),
    ]);

    const avgDurationAgg = await AnalyticsSessionModel.aggregate([
      {
        $match: {
          ...exclusions.sessions,
          endedAt: { $gte: from, $lte: to },
          durationSec: { $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avgDurationSec: { $avg: '$durationSec' },
        },
      },
    ]).exec();

    const topPages = await AnalyticsEventModel.aggregate([
      {
        $match: {
          ...exclusions.events,
          type: 'page_view',
          occurredAt: { $gte: from, $lte: to },
          path: { $nin: [null, ''] },
        },
      },
      { $group: { _id: '$path', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, path: '$_id', count: 1 } },
    ]).exec();

    const topReferrers = await AnalyticsEventModel.aggregate([
      {
        $match: {
          ...exclusions.events,
          type: 'page_view',
          occurredAt: { $gte: from, $lte: to },
          referrer: { $nin: [null, ''] },
        },
      },
      { $group: { _id: '$referrer', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, referrer: '$_id', count: 1 } },
    ]).exec();

    const sessionsByDay = await AnalyticsSessionModel.aggregate([
      {
        $match: {
          ...exclusions.sessions,
          startedAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$startedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', count: 1 } },
    ]).exec();

    const liveCount = await this.countLiveSessions(liveWindowSec);
    const geography = await AnalyticsSessionModel.aggregate([
      { $match: { ...exclusions.sessions, startedAt: { $gte: from, $lte: to } } },
      { $group: { _id: { country: { $ifNull: ['$country', 'Desconocido'] }, region: { $ifNull: ['$region', 'Desconocido'] } }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, country: '$_id.country', region: '$_id.region', count: 1 } },
    ]).exec();

    return {
      activeNow: liveCount,
      totalSessions,
      uniqueVisitors,
      totalPageViews,
      avgSessionDurationSec: Math.round(
        avgDurationAgg[0]?.avgDurationSec || 0
      ),
      topPages,
      topReferrers,
      sessionsByDay,
      geography,
    };
  }

  async getRecentEvents(
    query: AnalyticsEventQuery
  ): Promise<AnalyticsEventRecord[]> {
    const limit = query.limit || 50;
    const filters: Record<string, any> = (await analyticsExclusions()).events;

    if (query.type) filters.type = query.type;
    if (query.sessionId) filters.$and = [{ sessionId: query.sessionId }];
    if (query.from || query.to) {
      filters.occurredAt = {};
      if (query.from) filters.occurredAt.$gte = query.from;
      if (query.to) filters.occurredAt.$lte = query.to;
    }

    const events = await AnalyticsEventModel.find(filters)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return events.map((event) => this.mapEvent(event));
  }

  private calculateDurationSec(start: Date, end: Date): number {
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  }

  private mapSession(doc: any): AnalyticsSessionRecord {
    return {
      sessionId: doc.sessionId,
      anonId: doc.anonId,
      userId: doc.userId,
      startedAt: doc.startedAt,
      lastSeenAt: doc.lastSeenAt,
      endedAt: doc.endedAt,
      endReason: doc.endReason,
      durationSec: doc.durationSec,
      initialPath: doc.initialPath,
      lastPath: doc.lastPath,
      referrer: doc.referrer,
      userAgent: doc.userAgent,
      ip: doc.ip,
      country: doc.country,
      region: doc.region,
      city: doc.city,
      latitude: doc.latitude,
      longitude: doc.longitude,
      geo: doc.geo,
      language: doc.language,
      timezone: doc.timezone,
      screen: doc.screen,
      viewport: doc.viewport,
      metadata: doc.metadata,
    };
  }

  private mapEvent(doc: any): AnalyticsEventRecord {
    return {
      eventId: doc.eventId,
      sessionId: doc.sessionId,
      anonId: doc.anonId,
      userId: doc.userId,
      type: doc.type,
      name: doc.name,
      path: doc.path,
      title: doc.title,
      referrer: doc.referrer,
      occurredAt: doc.occurredAt,
      data: doc.data,
      userAgent: doc.userAgent,
      ip: doc.ip,
      language: doc.language,
      timezone: doc.timezone,
    };
  }
}
