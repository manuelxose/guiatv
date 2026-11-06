/**
 * F08 boundedness — entity mappings must paginate in the database, never load
 * both collections into memory.
 *
 * The parser caps huge limits and rejects unknown sort/kind/order before any
 * database access. The Mongo test (skipped without TEST_MONGO_URI) seeds a
 * 5,000+ entity dataset and proves the page respects the limit, the total is
 * correct, ordering is stable across the page boundary, and the search regex is
 * escaped. The throwaway dbName always contains "adminapi".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { FootballAdminService } from './FootballAdminService';
import { FootballTeamModel } from '@/infrastructure/sports/models/FootballTeam.model';
import { FootballCompetitionModel } from '@/infrastructure/sports/models/FootballCompetition.model';
import { parseEntityMappingQuery, MAX_PAGE_SIZE } from '../dto/FootballAdminDTO';

test('parseEntityMappingQuery caps a huge limit and rejects unknown sort/order/kind', () => {
  const capped = parseEntityMappingQuery({ limit: '999999' });
  assert.ok(capped.ok);
  if (capped.ok) {
    assert.equal(capped.value.limit, MAX_PAGE_SIZE, 'a deliberately huge limit must be capped');
    assert.equal(capped.value.sort, 'lastUpdatedAt');
    assert.equal(capped.value.order, 'desc');
  }

  assert.equal(parseEntityMappingQuery({ sort: 'bogus' }).ok, false);
  assert.equal(parseEntityMappingQuery({ order: 'sideways' }).ok, false);
  assert.equal(parseEntityMappingQuery({ kind: 'player' }).ok, false);
  assert.equal(parseEntityMappingQuery({ page: 0 }).ok, false);
});

test(
  'entity mappings paginate in the database with a stable total ordering',
  { skip: !process.env.TEST_MONGO_URI },
  async () => {
    const dbName = `guiatv_adminapi_f08_${process.pid}`;
    await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName, autoCreate: false, autoIndex: false });
    try {
      const base = Date.UTC(2026, 0, 1);
      const teams = Array.from({ length: 5000 }, (_, i) => ({
        id: `team-${String(i).padStart(5, '0')}`,
        slug: `team-${String(i).padStart(5, '0')}`,
        name: `Team ${i}`,
        providerIds: { openligadb: String(i) },
        lastUpdatedAt: new Date(base + (i % 50) * 1000),
      }));
      const competitions = Array.from({ length: 50 }, (_, i) => ({
        id: `comp-${String(i).padStart(3, '0')}`,
        slug: `comp-${String(i).padStart(3, '0')}`,
        name: `Competition ${i}`,
        providerIds: { openligadb: `c${i}` },
        lastUpdatedAt: new Date(base + (i % 50) * 1000),
      }));
      await FootballTeamModel.insertMany(teams, { ordered: false });
      await FootballCompetitionModel.insertMany(competitions, { ordered: false });

      const service = new FootballAdminService();
      const sort = 'lastUpdatedAt' as const;
      const order = 'desc' as const;
      const page1 = await service.listEntityMappings({ page: 1, limit: 25, sort, order });
      const page2 = await service.listEntityMappings({ page: 2, limit: 25, sort, order });

      assert.equal(page1.total, 5050, 'total must count both collections exactly once');
      assert.equal(page1.limit, 25);
      assert.equal(page1.items.length, 25, 'page must respect the limit');
      assert.equal(page2.items.length, 25);

      // No overlap across the page boundary.
      const page1Slugs = new Set(page1.items.map((e) => e.slug));
      for (const e of page2.items) assert.equal(page1Slugs.has(e.slug), false, 'pages must be disjoint');

      // Stable total ordering: (lastUpdatedAt desc, slug asc, _id asc).
      const combined = [...page1.items, ...page2.items];
      for (let i = 1; i < combined.length; i++) {
        const a = combined[i - 1];
        const b = combined[i];
        const aTime = a.lastUpdatedAt ?? '';
        const bTime = b.lastUpdatedAt ?? '';
        assert.ok(
          aTime > bTime || (aTime === bTime && a.slug <= b.slug),
          `ordering violated at ${i}: (${aTime}, ${a.slug}) -> (${bTime}, ${b.slug})`
        );
      }

      // kind filter stays server-side.
      const teamsOnly = await service.listEntityMappings({ page: 1, limit: 10, kind: 'team', sort, order });
      assert.equal(teamsOnly.total, 5000);
      assert.ok(teamsOnly.items.every((e) => e.kind === 'team'));

      // Search input is escaped: the literal `.*` matches nothing (not "everything").
      const escaped = await service.listEntityMappings({ page: 1, limit: 25, q: '.*', sort: 'slug', order: 'asc' });
      assert.equal(escaped.total, 0);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
);
