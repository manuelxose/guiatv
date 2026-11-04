import { Schema, model } from 'mongoose';

const schema = new Schema({
  userId: { type: String, required: true, unique: true },
  tab: { type: String, required: true },
  rangeHours: { type: Number, required: true },
  eventFilter: { type: String },
}, { timestamps: true, collection: 'analytics_views' });

export const AnalyticsViewModel = model('AnalyticsView', schema);
