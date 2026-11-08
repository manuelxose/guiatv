/**
 * F25: a league table is DERIVED from the real finished results we already store.
 *
 * It must never be invented: a match without a score contributes nothing, and a
 * competition with no finished matches yields an empty table (the UI then says
 * "no tiene clasificación" instead of showing a fake table).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { FootballSnapshotModel } from '@/infrastructure/sports/persistence/models';
import { SnapshotFootballDataProvider } from './SnapshotFootballDataProvider';

test(
  'F25: standings are computed from finished results and ordered by points, GD, goals',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `m06_r1_standings_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName });
    try {
      const team = (slug: string, name: string) => ({ id: slug, slug, name });
      const finished = (id: string, home: any, away: any, hs: number | null, as: number | null) => ({
        canonicalKey: `openligadb:${id}`,
        providerId: 'openligadb',
        matchId: id,
        competitionSlug: 'test-league',
        match: {
          id,
          slug: `m-${id}`,
          status: 'finished',
          homeTeam: home,
          awayTeam: away,
          score: { home: hs, away: as },
          kickoffAt: '2026-11-01T18:00:00.000Z',
          lastUpdatedAt: '2026-11-01T20:00:00.000Z',
          competition: { id: 'catalog:test-league', slug: 'test-league', name: 'Test' },
        },
        sourceTimestamp: new Date('2026-11-01T20:00:00.000Z'),
        ingestedAt: new Date(),
        contentHash: `hash-${id}`,
      });
      await FootballSnapshotModel.collection.insertMany([
        finished('1', team('a', 'Alpha'), team('b', 'Beta'), 3, 0),
        finished('2', team('b', 'Beta'), team('c', 'Gamma'), 1, 1),
        finished('3', team('c', 'Gamma'), team('a', 'Alpha'), 0, 2),
        finished('4', team('a', 'Alpha'), team('c', 'Gamma'), null, null),
      ] as never[]);

      const provider = new SnapshotFootballDataProvider();
      const rows = await provider.getStandings('test-league');
      const byName: Record<string, any> = Object.fromEntries(rows.map((r) => [r.team.name, r]));

      assert.equal(rows.length, 3, 'only teams that played a scored match appear');
      assert.equal(byName['Alpha'].points, 6, 'two wins = 6 points');
      assert.equal(byName['Alpha'].played, 2, 'the unscored match is not counted');
      assert.equal(byName['Alpha'].goalDifference, 5);
      assert.equal(byName['Gamma'].points, 1);
      assert.deepEqual(rows.map((r) => r.position), [1, 2, 3]);
      assert.equal(rows[0].team.name, 'Alpha', 'leader is the most points');
      assert.deepEqual(await provider.getStandings('no-such-league'), []);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);

