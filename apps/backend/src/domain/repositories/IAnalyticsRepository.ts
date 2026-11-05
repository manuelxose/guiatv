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
  /** Provenance and uncertainty of the location (never a precise position). */
  geo?: {
    status?: string;
    source?: string;
    regionName?: string;
    accuracyRadiusKm?: number;
    asn?: number;
    asOrg?: string;
    db?: string;
  };
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
  /** Administrator or excluded-address traffic, decided at ingestion (the full address is not stored). */
  excluded?: boolean;
  language?: string;
  timezone?: string;
}

export interface AnalyticsSessionActivity {
  idleSec: number;
  isIdle: boolean;
  lastActivityAt: string;
  visible?: boolean;
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
  /** Country / region / city breakdown (top 200 by sessions); absent fields mean unknown, never guessed. */
  geographyDetail?: AnalyticsGeoBucket[];
  /** Sessions by location outcome: located, country_only, unknown, private, invalid, unavailable, disabled, none (no data). */
  geographyStatus?: Array<{ status: string; count: number }>;
  aggregateLimitations?: boolean;
  geographyCollectionEnabled?: boolean;
}

export interface AnalyticsGeoBucket {
  country?: string;
  region?: string;
  regionName?: string;
  city?: string;
  count: number;
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
    /** Updates only `metadata.activity` (keeps the device/utm metadata written at session start). */
    activity?: AnalyticsSessionActivity;
    /** A BFCache-restored page: the session is open again. */
    resume?: boolean;
  }): Promise<AnalyticsSessionRecord | null>;
  endSession(payload: {
    sessionId: string;
    endedAt: Date;
    lastSeenAt: Date;
    lastPath?: string;
    endReason?: string;
  }): Promise<AnalyticsSessionRecord | null>;
  createEvent(payload: AnalyticsEventRecord): Promise<void>;
  /** Bulk insert; idempotent on `eventId` (a repeated id is ignored). */
  createEvents?(payloads: AnalyticsEventRecord[]): Promise<void>;
  /** False while the store cannot accept writes (the ingestion queue waits instead of losing events). */
  isAvailable?(): boolean;
  getLiveSessions(windowSec: number, limit: number): Promise<AnalyticsSessionRecord[]>;
  countLiveSessions(windowSec: number): Promise<number>;
  getOverview(from: Date, to: Date, liveWindowSec: number): Promise<AnalyticsOverview>;
  getRecentEvents(query: AnalyticsEventQuery): Promise<AnalyticsEventRecord[]>;
  getRealtimePages(to: Date): Promise<AnalyticsRealtimePages | null>;
}
