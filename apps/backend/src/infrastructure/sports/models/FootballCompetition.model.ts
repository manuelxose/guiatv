import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';

export interface IFootballCompetitionDocument {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  country?: string;
  logo?: string | null;
  type: 'league' | 'cup' | 'international' | 'national_team' | 'other';
  currentSeason?: string;
  providerIds: Record<string, string>;
  lastUpdatedAt: Date;
}

const FootballCompetitionSchema = new Schema<IFootballCompetitionDocument>(
  {
    id: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true },
    country: { type: String, trim: true },
    logo: { type: String, default: null },
    type: {
      type: String,
      enum: ['league', 'cup', 'international', 'national_team', 'other'],
      default: 'league',
      index: true,
    },
    currentSeason: { type: String, trim: true },
    providerIds: { type: Schema.Types.Mixed as any, default: {} },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { collection: 'football_competitions' }
);

// F08: deterministic entity-mappings pagination sorts by lastUpdatedAt then slug.
FootballCompetitionSchema.index(
  { lastUpdatedAt: -1, slug: 1 },
  { name: 'idx_football_competition_updated_slug' }
);

export const FootballCompetitionModel = mongoose.model<IFootballCompetitionDocument>(
  'FootballCompetition',
  FootballCompetitionSchema
);
