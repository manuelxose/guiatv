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

export interface IAnalyticsEventDocument {
  eventId: string;
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
  excluded?: boolean;
  language?: string;
  timezone?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEventDocument>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
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
    type: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    path: {
      type: String,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
    },
    referrer: {
      type: String,
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    ip: {
      type: String,
      trim: true,
    },
    excluded: { type: Boolean },
    language: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'analytics_events',
  }
);

AnalyticsEventSchema.index({ occurredAt: 1, type: 1 });
AnalyticsEventSchema.index({ path: 1, occurredAt: 1 });
if (ANALYTICS_TTL_SECONDS) {
  AnalyticsEventSchema.index(
    { occurredAt: 1 },
    { expireAfterSeconds: ANALYTICS_TTL_SECONDS }
  );
}

export const AnalyticsEventModel = mongoose.model<IAnalyticsEventDocument>(
  'AnalyticsEvent',
  AnalyticsEventSchema
);
