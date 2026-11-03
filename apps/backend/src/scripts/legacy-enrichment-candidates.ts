/**
 * M03-A: candidate films for the legacy-enrichment sample, from the real EPG read model. Read-only (the same guard as
 * `content-certify`: any write ends the process with code 97). Numbers and labels only.
 *
 *   node dist/scripts/legacy-enrichment-candidates.js [--out candidates-raw.json] [--limit 80]
 *
 * A film qualifies when it has a movie catalogue row and at least one airing, tied to that row (`program.mediaId`), on a date
 * beyond the two days the legacy page already lists. The public page checks (path, `index, follow`, no genres or runtime,
 * same identity) are made afterwards from public GETs; the final accept/reject is the preflight's.
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { connectMongoDB, disconnectMongoDB } from '../config/mongodb';
import { installReadOnlyGuard } from './readOnlyGuard';
import { MongoMediaCatalogRepository } from '@/infrastructure/repositories/MongoMediaCatalogRepository';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { broadcastWindowDates, madridDay } from '@/application/services/EntityBroadcastService';

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);

async function main() {
  const guard = installReadOnlyGuard();
  await connectMongoDB();
  try {
    const now = new Date();
    const dates = broadcastWindowDates(now);
    const legacyWindow = new Set([madridDay(now), madridDay(now, 1)]);
    const perFilm = await TVReadAiringModel.aggregate([
      { $match: { date: { $in: dates }, 'program.tmdbId': { $type: 'number' } } },
      { $group: {
        _id: '$program.tmdbId',
        airings: { $sum: 1 },
        withRow: { $sum: { $cond: [{ $ifNull: ['$program.mediaId', false] }, 1, 0] } },
        dates: { $addToSet: '$date' },
        datesWithRow: { $addToSet: { $cond: [{ $ifNull: ['$program.mediaId', false] }, '$date', '$$REMOVE'] } },
      } },
    ]).option({ maxTimeMS: 30_000 });
    const repo = new MongoMediaCatalogRepository();
    const movies = await repo.findManyByTmdbIds('movie', perFilm.map((f) => f._id as number));
    const rows = new Map(movies.map((m) => [m.tmdbId, m]));
    const list = perFilm
      .filter((f) => rows.has(f._id))
      .map((f) => {
        const row = rows.get(f._id)!;
        // Later than the legacy window: the read window also holds yesterday, which is neither listed nor "beyond".
        const beyond = (f.datesWithRow as string[]).filter((d) => d > madridDay(now, 1));
        return {
          tmdbId: f._id as number, title: row.title, releaseYear: row.year ? Number(row.year) : undefined,
          airings: f.airings as number, airingsWithCatalogueRow: f.withRow as number, datesBeyondLegacyWindow: beyond.sort(),
          fullyFetched: Boolean(row.lastEnrichedAt), hasRuntime: Boolean(row.runtimeMinutes), genres: row.tmdbGenres.length + row.canonicalGenres.length,
        };
      })
      .filter((f) => f.datesBeyondLegacyWindow.length > 0)
      .sort((a, b) => b.datesBeyondLegacyWindow.length - a.datesBeyondLegacyWindow.length || b.airingsWithCatalogueRow - a.airingsWithCatalogueRow)
      .slice(0, Number(arg('--limit') ?? 80));
    const report = {
      generatedAt: now.toISOString(), database: mongoose.connection.db?.databaseName, window: dates, legacyWindow: [...legacyWindow],
      filmsWithTmdbInWindow: perFilm.length, withMovieRow: perFilm.filter((f) => rows.has(f._id)).length, qualifying: list.length, candidates: list,
      readOnlyGuard: guard.summary(),
    };
    const out = arg('--out');
    if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, candidates: report.candidates.slice(0, 5) }, null, 2));
  } finally {
    await disconnectMongoDB();
  }
}
void main();
