export interface AnalyticsSessionRecord {
  sessionId: string;
  anonId: string;
  userId?: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt?: Date;
  endReason?: string;
  durationSec?: number;
  initialPath?: string;
  lastPath?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  excluded?: boolean;
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  language?: string;
  timezone?: string;
  screen?: Record<string, any>;
  viewport?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AnalyticsEventRecord {
  eventId?: string;
  sessionId: string;
  anonId: string;
  userId?: string;
  type: string;
  name?: string;
  path?: string;
  title?: string;
  referrer?: string;
  occurredAt: Date;
  data?: Record<string, any>;
  userAgent?: string;
  ip?: string;
  language?: string;
  timezone?: string;
}

export interface AnalyticsOverview {
  activeNow: number;
  totalSessions: number;
  uniqueVisitors: number;
  totalPageViews: number;
  avgSessionDurationSec: number;
  topPages: Array<{ path: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  sessionsByDay: Array<{ date: string; count: number }>;
  geography?: Array<{ country: string; region: string; count: number }>;
  aggregateLimitations?: boolean;
  geographyCollectionEnabled?: boolean;
}

export interface AnalyticsRealtimePages {
  from: Date;
  to: Date;
  activeUsers: number;
  pageViews: number;
  minutes: Array<{ from: Date; users: number }>;
  pages: Array<{ path: string; users: number; views: number }>;
  partial?: boolean;
  coverageStartedAt?: Date;
}

export interface AnalyticsEventQuery {
  from?: Date;
  to?: Date;
  type?: string;
  sessionId?: string;
  limit?: number;
}

export interface IAnalyticsRepository {
  markExcludedSession(sessionId: string): Promise<void>;
  startSession(payload: AnalyticsSessionRecord): Promise<void>;
  heartbeatSession(payload: {
    sessionId: string;
    lastSeenAt: Date;
    lastPath?: string;
    metadata?: Record<string, any>;
  }): Promise<AnalyticsSessionRecord | null>;
  endSession(payload: {
    sessionId: string;
    endedAt: Date;
    lastSeenAt: Date;
    lastPath?: string;
    endReason?: string;
  }): Promise<AnalyticsSessionRecord | null>;
  createEvent(payload: AnalyticsEventRecord): Promise<void>;
  getLiveSessions(windowSec: number, limit: number): Promise<AnalyticsSessionRecord[]>;
  countLiveSessions(windowSec: number): Promise<number>;
  getOverview(from: Date, to: Date, liveWindowSec: number): Promise<AnalyticsOverview>;
  getRecentEvents(query: AnalyticsEventQuery): Promise<AnalyticsEventRecord[]>;
  getRealtimePages(to: Date): Promise<AnalyticsRealtimePages | null>;
}
