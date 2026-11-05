import { Schema, model } from 'mongoose';

/** Addresses or ranges whose traffic analytics never counts (managed from the admin panel). */
const schema = new Schema({
  value: { type: String, required: true, unique: true, trim: true, maxlength: 64 },
  label: { type: String, trim: true, maxlength: 80 },
  createdBy: { type: String, trim: true, maxlength: 80 },
}, { timestamps: true, collection: 'analytics_exclusions' });

export const AnalyticsExclusionModel = model('AnalyticsExclusion', schema);
