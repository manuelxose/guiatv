import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProgrammeEligibility,
  clearProgrammeEligibilityLastGood,
  invalidateProgrammeEligibility,
  programmePathFor,
  type ProgrammePageLookup,
} from './ProgrammeEligibility';
import { invalidateSitemapCache, clearSitemapLastGood, SitemapController } from '../../presentation/controllers/SitemapController';
import { TvSurfaceService } from './TvSurfaceService';
import { DateUtils } from '@/shared/utils/dateUtils';
import type { ProgrammeDisposition } from './ProgrammeSeoPolicy';

// Production runs the M09-B policy `on`; with it off any resolving slug is eligible (the pre-M09-B rule, unchanged).
const previousPolicy = process.env.PROGRAMME_SEO_POLICY;
process.env.PROGRAMME_SEO_POLICY = 'on';
after(() => {
  if (previousPolicy === undefined) delete process.env.PROGRAMME_SEO_POLICY; else process.env.PROGRAMME_SEO_POLICY = previousPolicy;
});

// M10-E fixtures: titles and dispositions of the M10-D inventory (docs/roadmap/M10D-DELIVERY.md, PR #137).
const PAGES: Record<string, { title: string; disposition: ProgrammeDisposition }> = {
  'comicos-nuestros': { title: 'Cómicos nuestros', disposition: 'standalone' },
  aida: { title: 'Aída', disposition: 'standalone' },
  'com-si-fos-ahir': { title: 'Com si fos ahir', disposition: 'standalone' },
  'quien-da-mas': { title: '¿Quién da más', disposition: 'standalone' },
  'modern-family': { title: 'Modern Family', disposition: 'ambiguous' }, // unverified TMDB identity: noindex
  gladiator: { title: 'Gladiator', disposition: 'work' }, // canonical = /peliculas/gladiator
  'friends-t1-e3': { title: 'Friends T1 E3', disposition: 'episode' },
  'sin-sinopsis': { title: 'Sin sinopsis', disposition: 'thin' },
};

const row = (title: string, updatedAt = '2026-11-02T08:00:00.000Z') => ({ title, start: '2026-11-02T20:00:00.000Z', updatedAt: new Date(updatedAt) });

function setup(options: { rows?: ReturnType<typeof row>[]; failing?: () => boolean; now?: () => number; ttlMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const asked: string[] = [];
  let rowReads = 0;
  const rows = options.rows ?? Object.values(PAGES).map((p) => row(p.title)).concat([row('[object Object]'), row('Aída', '2026-11-02T09:00:00.000Z')]);
  const tvRead = {
    getIndexableProgramSitemapRows: async (dates: string[]) => {
      rowReads++;
      const today = new Date(now());
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      assert.deepEqual(dates, [DateUtils.formatYYYYMMDD(today), DateUtils.formatYYYYMMDD(tomorrow)], 'today and tomorrow, Madrid');
      return rows;
    },
  } as any;
  const page: ProgrammePageLookup = async (slug) => {
    asked.push(slug);
    if (options.failing?.()) throw new Error('db down');
    return PAGES[slug] ?? null;
  };
  const eligibility = new ProgrammeEligibility(tvRead, page, options.ttlMs, now);
  return { eligibility, asked, tvRead, rowReads: () => rowReads };
}

test('M10-E: the snapshot holds exactly the standalone slugs, deduplicated, with the title each page loads', async () => {
  invalidateProgrammeEligibility();
  const { eligibility, asked } = setup();
  const snapshot = await eligibility.snapshot();
  assert.deepEqual([...snapshot.entries.keys()], ['comicos-nuestros', 'aida', 'com-si-fos-ahir', 'quien-da-mas']);
  assert.equal(snapshot.entries.get('aida')!.title, 'Aída');
  assert.equal(snapshot.entries.get('aida')!.lastChanged, new Date('2026-11-02T09:00:00.000Z').getTime(), 'newest change of its airings');
  assert.equal(asked.filter((slug) => slug === 'aida').length, 1, 'one lookup per slug, not per airing');
  assert.ok(!asked.includes('object-object'), 'a non-text title never becomes a slug');
  assert.ok(!snapshot.entries.has('modern-family') && !snapshot.entries.has('gladiator') && !snapshot.entries.has('friends-t1-e3') && !snapshot.entries.has('sin-sinopsis'));
});

test('M10-E: the sitemap lists exactly the snapshot the channel links come from', async () => {
  invalidateSitemapCache();
  clearSitemapLastGood();
  const { eligibility } = setup();
  const controller = new SitemapController({} as any, {} as any, undefined, undefined, { getChannels: async () => ({ channels: [] }) } as any,
    undefined, undefined, undefined, eligibility);
  let xml = '';
  const res: any = { set: () => res, status: () => res, send: (body: string) => { xml = body; } };
  await controller.getProgramsSitemap({} as any, res, (() => {}) as any);
  const listed = [...xml.matchAll(/<loc>[^<]*\/programas\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(listed, [...(await eligibility.snapshot()).entries.keys()]);
  assert.match(xml, /<loc>[^<]*\/programas\/aida<\/loc>\s*<lastmod>2026-11-02/);
  invalidateSitemapCache();
});

test('M10-E: concurrent callers share one build; a cached snapshot answers until its TTL', async () => {
  invalidateProgrammeEligibility();
  let clock = new Date(2026, 10, 2, 10, 0).getTime();
  const { eligibility, rowReads } = setup({ now: () => clock, ttlMs: 60_000 });
  const [a, b, c] = await Promise.all([eligibility.snapshot(), eligibility.snapshot(), eligibility.snapshot()]);
  assert.equal(rowReads(), 1);
  assert.ok(a === b && b === c);
  assert.equal(eligibility.current()?.entries.size, 4);
  clock += 59_000;
  await eligibility.snapshot();
  assert.equal(rowReads(), 1, 'cache hit');
  clock += 2_000;
  assert.equal(eligibility.current(), undefined, 'expired: no link is drawn from it');
  await eligibility.snapshot();
  assert.equal(rowReads(), 2, 'rebuilt after expiry');
});

test('M10-E: a snapshot never outlives the Madrid day it was built for', async () => {
  invalidateProgrammeEligibility();
  const built = new Date(2026, 10, 2, 23, 0).getTime(); // 23:00 Madrid (test TZ is Europe/Madrid)
  let clock = built;
  const { eligibility, rowReads } = setup({ now: () => clock });
  const snapshot = await eligibility.snapshot();
  assert.deepEqual(snapshot.dates, ['20261102', '20261103']);
  assert.equal(snapshot.validUntil, new Date(2026, 10, 3, 0, 0).getTime(), 'expires at the next midnight, not 6 h later');
  clock = new Date(2026, 10, 3, 0, 1).getTime();
  assert.equal(eligibility.current(), undefined, "yesterday's eligibility draws no link after midnight");
  const next = await eligibility.snapshot();
  assert.deepEqual(next.dates, ['20261103', '20261104'], 'next-day window: the new today and its tomorrow');
  assert.equal(rowReads(), 2);
});

test('M10-E: invalidation (a read-model rebuild) drops the snapshot and does not keep a build already running', async () => {
  invalidateProgrammeEligibility();
  const { eligibility, rowReads } = setup();
  await eligibility.snapshot();
  invalidateSitemapCache(['blog', 'index']);
  assert.ok(eligibility.current(), 'a guide publish does not touch programme eligibility');
  invalidateSitemapCache();
  assert.equal(eligibility.current(), undefined);
  const running = eligibility.snapshot();
  invalidateProgrammeEligibility(); // rebuilt again while the build ran
  await running;
  assert.equal(eligibility.current(), undefined, 'the older answer is not cached');
  await eligibility.snapshot();
  assert.ok(rowReads() >= 3);
});

test('M10-E: a repository failure never turns into an empty population', async () => {
  invalidateProgrammeEligibility();
  clearProgrammeEligibilityLastGood();
  let failing = true;
  const { eligibility } = setup({ failing: () => failing });
  await assert.rejects(eligibility.snapshot(), /db down/, 'no previous build: the error surfaces');
  assert.equal(eligibility.current(), undefined, 'no links, never an empty-but-valid snapshot');

  failing = false;
  const good = await eligibility.snapshot();
  invalidateProgrammeEligibility();
  failing = true;
  const stale = await eligibility.snapshot();
  assert.deepEqual([...stale.entries.keys()], [...good.entries.keys()], "same day: the last good snapshot, not a partial one");
  assert.ok(stale.validUntil <= Date.now() + 60_000, 'retried within a minute');
});

test('M10-E: programmePathFor links only the exact title of an eligible slug and never a verified work', async () => {
  invalidateProgrammeEligibility();
  const snapshot = await setup().eligibility.snapshot();
  assert.equal(programmePathFor(snapshot, { title: 'Aída' }), '/programas/aida');
  assert.equal(programmePathFor(snapshot, { title: 'Cómicos nuestros' }), '/programas/comicos-nuestros');
  assert.equal(programmePathFor(snapshot, { title: '¿Quién da más' }), '/programas/quien-da-mas');
  assert.equal(programmePathFor(snapshot, { title: 'Com si fos ahir' }), '/programas/com-si-fos-ahir');
  assert.equal(programmePathFor(snapshot, { title: 'AIDA' }), undefined, 'same slug, different title: the page loads another row');
  assert.equal(programmePathFor(snapshot, { title: 'Aída', workPath: '/series/aida' }), undefined, 'a verified work keeps its work page');
  assert.equal(programmePathFor(snapshot, { title: 'Modern Family' }), undefined, 'unverified identity: noindex page');
  assert.equal(programmePathFor(snapshot, { title: 'Gladiator' }), undefined, 'canonical is /peliculas/gladiator');
  assert.equal(programmePathFor(snapshot, { title: '[object Object]' }), undefined);
  assert.equal(programmePathFor(snapshot, { title: '' }), undefined);
});

test('M10-E: the channel surface links eligible rows from the current snapshot on every read, cached or not, with no lookup per row', async () => {
  invalidateProgrammeEligibility();
  const { eligibility, asked } = setup();
  await eligibility.snapshot();
  const lookupsAfterBuild = asked.length;
  const item = (id: string, title: string, workPath?: string) => ({
    id,
    channel: { id: 'fdf', normalizedName: 'factoria-de-ficcion', name: 'FDF', group: 'tdt' },
    program: { title, workPath },
    airing: { start: '2026-11-02T20:00:00.000Z', end: '2026-11-02T21:00:00.000Z' },
    detailPath: `/contenido/program:${id}`,
  });
  const items = [item('1', 'Aída'), item('2', 'Modern Family'), item('3', 'Gladiator', '/peliculas/gladiator'), item('4', 'Aída', '/series/aida')];
  const store = new Map<string, unknown>();
  const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); } } as any;
  const tvRead = {
    getChannelDetail: async () => ({ date: '20261102', channels: [], items }),
    getChannels: async () => ({ channels: [] }),
  } as any;
  const service = new TvSurfaceService(tvRead, cache, undefined, eligibility);

  for (const read of ['fresh', 'cached']) {
    const surface = await service.getChannelSurface('factoria-de-ficcion');
    const paths = surface.scheduleItems.map((i) => i.program.programmePath);
    assert.deepEqual(paths, ['/programas/aida', undefined, undefined, undefined], read);
    assert.equal(surface.scheduleItems[2].program.workPath, '/peliculas/gladiator', 'work path untouched');
  }
  assert.ok(![...store.values()].some((v) => JSON.stringify(v).includes('programmePath')), 'never cached with the surface');
  assert.equal(asked.length, lookupsAfterBuild, 'no lookup on the request path');

  invalidateProgrammeEligibility(); // rebuild: links drop until the new snapshot answers, never a stale one
  const during = await service.getChannelSurface('factoria-de-ficcion');
  assert.equal(during.scheduleItems[0].program.programmePath, undefined);
  await eligibility.snapshot();
  const after = await service.getChannelSurface('factoria-de-ficcion');
  assert.equal(after.scheduleItems[0].program.programmePath, '/programas/aida', 'back after the refresh');
});
