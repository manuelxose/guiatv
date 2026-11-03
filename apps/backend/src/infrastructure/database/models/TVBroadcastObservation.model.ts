import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';
import type { BroadcastObservation } from '@/domain/services/BroadcastObservation';

const TVBroadcastObservationSchema = new Schema<BroadcastObservation>(
  {
    _id: { type: String, required: true },
    channelId: { type: String, required: true },
    startUtc: { type: Date, required: true },
    endUtc: { type: Date, required: true },
    madridDate: { type: String, required: true },
    title: { type: String, required: true },
    titleKey: { type: String, required: true },
    workRef: { type: String },
    sources: { type: [String], required: true },
    contentHash: { type: String, required: true },
    state: { type: String, enum: ['scheduled'], required: true },
    rev: { type: Number, required: true },
    seenCount: { type: Number, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    prev: { type: Schema.Types.Mixed },
  },
  { collection: 'tv_broadcast_observations', versionKey: false, autoIndex: false }
);

/** The only secondary index (the _id already enforces uniqueness). Built by the archiver on first enabled run, never at boot. */
export const TV_BROADCAST_OBSERVATION_INDEX = { key: { channelId: 1, startUtc: 1 }, options: { name: 'idx_obs_channel_start' } } as const;

export const TVBroadcastObservationModel = mongoose.model<BroadcastObservation>('TVBroadcastObservation', TVBroadcastObservationSchema);
