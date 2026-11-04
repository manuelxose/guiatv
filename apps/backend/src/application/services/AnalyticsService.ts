import { randomUUID } from 'crypto';
import {
  AnalyticsEventQuery,
  AnalyticsEventRecord,
  AnalyticsOverview,
  AnalyticsSessionRecord,
  IAnalyticsRepository,
} from '../../domain/repositories/IAnalyticsRepository';

export class AnalyticsService {
  constructor(private readonly repository: IAnalyticsRepository) {}

  async markExcludedSession(sessionId: string): Promise<void> {
    await this.repository.markExcludedSession(sessionId);
  }

  async getRealtimePages() {
    return this.repository.getRealtimePages(new Date());
  }

  async startSession(payload: AnalyticsSessionRecord): Promise<void> {
    await this.repository.startSession(payload);
  }

  async heartbeatSession(payload: {
    sessionId: string;
    lastSeenAt: Date;
    lastPath?: string;
    metadata?: Record<string, any>;
  }): Promise<AnalyticsSessionRecord | null> {
    return this.repository.heartbeatSession(payload);
  }

  async endSession(payload: {
    sessionId: string;
    endedAt: Date;
    lastSeenAt: Date;
    lastPath?: string;
    endReason?: string;
  }): Promise<AnalyticsSessionRecord | null> {
    return this.repository.endSession(payload);
  }

  async trackEvent(payload: AnalyticsEventRecord): Promise<void> {
    const eventId = payload.eventId || randomUUID();
    await this.repository.createEvent({
      ...payload,
      eventId,
      occurredAt: payload.occurredAt || new Date(),
    });
  }

  async getLiveSessions(
    windowSec: number,
    limit: number
  ): Promise<AnalyticsSessionRecord[]> {
    return this.repository.getLiveSessions(windowSec, limit);
  }

  async getLiveSnapshot(
    windowSec: number,
    limit: number
  ): Promise<{ activeCount: number; sessions: AnalyticsSessionRecord[] }> {
    const [sessions, activeCount] = await Promise.all([
      this.repository.getLiveSessions(windowSec, limit),
      this.repository.countLiveSessions(windowSec),
    ]);

    return { activeCount, sessions };
  }

  async getOverview(
    from: Date,
    to: Date,
    liveWindowSec: number
  ): Promise<AnalyticsOverview> {
    return this.repository.getOverview(from, to, liveWindowSec);
  }

  async getRecentEvents(
    query: AnalyticsEventQuery
  ): Promise<AnalyticsEventRecord[]> {
    return this.repository.getRecentEvents(query);
  }
}
