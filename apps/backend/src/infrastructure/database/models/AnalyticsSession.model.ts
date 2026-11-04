import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';

const ANALYTICS_TTL_DAYS = Number.parseInt(
  process.env.ANALYTICS_TTL_DAYS || '14',
  10
);
const ANALYTICS_TTL_SECONDS =
  Number.isFinite(ANALYTICS_TTL_DAYS) && ANALYTICS_TTL_DAYS > 0
    ? ANALYTICS_TTL_DAYS * 24 * 60 * 60
    : null;

export interface IAnalyticsSessionDocument {
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
  geo?: Record<string, any>;
  language?: string;
  timezone?: string;
  screen?: Record<string, any>;
  viewport?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const AnalyticsSessionSchema = new Schema<IAnalyticsSessionDocument>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    anonId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
      index: true,
    },
    endReason: {
      type: String,
      trim: true,
    },
    durationSec: {
      type: Number,
      index: true,
    },
    initialPath: {
      type: String,
      trim: true,
    },
    lastPath: {
      type: String,
      trim: true,
      index: true,
    },
    referrer: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    ip: {
      type: String,
      trim: true,
    },
    excluded: { type: Boolean, default: false, index: true },
    country: { type: String },
    region: { type: String },
    city: { type: String },
    latitude: { type: Number },
    longitude: { type: Number },
    // Location provenance/uncertainty: status, source, accuracy radius, ASN, database build.
    geo: { type: Schema.Types.Mixed },
    language: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      trim: true,
    },
    screen: {
      type: Schema.Types.Mixed,
    },
    viewport: {
      type: Schema.Types.Mixed,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    collection: 'analytics_sessions',
  }
);

AnalyticsSessionSchema.index({ anonId: 1, startedAt: 1 });
AnalyticsSessionSchema.index({ lastSeenAt: 1, endedAt: 1 });
if (ANALYTICS_TTL_SECONDS) {
  AnalyticsSessionSchema.index(
    { lastSeenAt: 1 },
    { expireAfterSeconds: ANALYTICS_TTL_SECONDS }
  );
}

export const AnalyticsSessionModel = mongoose.model<IAnalyticsSessionDocument>(
  'AnalyticsSession',
  AnalyticsSessionSchema
);
