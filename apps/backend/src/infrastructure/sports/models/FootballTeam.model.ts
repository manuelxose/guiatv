import * as mongoose from 'mongoose';
import { Schema } from 'mongoose';

export interface IFootballTeamDocument {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  country?: string;
  crest?: string | null;
  aliases: string[];
  providerIds: Record<string, string>;
  lastUpdatedAt: Date;
}

const FootballTeamSchema = new Schema<IFootballTeamDocument>(
  {
    id: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true },
    country: { type: String, trim: true },
    crest: { type: String, default: null },
    aliases: { type: [String], default: [] },
    providerIds: { type: Schema.Types.Mixed as any, default: {} },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { collection: 'football_teams' }
);

FootballTeamSchema.index({ aliases: 1 });
// F08: deterministic entity-mappings pagination sorts by lastUpdatedAt then slug.
FootballTeamSchema.index(
  { lastUpdatedAt: -1, slug: 1 },
  { name: 'idx_football_team_updated_slug' }
);

export const FootballTeamModel = mongoose.model<IFootballTeamDocument>(
  'FootballTeam',
  FootballTeamSchema
);
