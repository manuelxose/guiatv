import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateSitemapCache, clearSitemapLastGood, SitemapController } from './SitemapController';

// Regression coverage for a real gap: competition/match/team detail pages
// were entirely absent from every sitemap — only the 5 static football hub
// routes were ever listed. This is the fix (sitemap-football.xml).

function fakeFootballQueryService(overrides: Partial<Record<'getCompetitions' | 'getMatches', () => Promise<any>>> = {}) {
  return {
    getCompetitions: overrides.getCompetitions ?? (async () => ({ competitions: [], meta: {} })),
    getMatches: overrides.getMatches ?? (async () => ({ matches: [], meta: {} })),
  } as any;
}

function fakeReqRes() {
  let sentXml = '';
  let statusCode = 0;
  const res: any = {
    set: () => res,
    status(code: number) {
      statusCode = code;
      return res;
    },
    send(body: string) {
      sentXml = body;
    },
  };
  return {
    req: {} as any,
    res,
    getSentXml: () => sentXml,
    getStatusCode: () => statusCode,
  };
}

test('Phase 3A entity detail paths are excluded while enabled, including warmed sitemap caches', async () => {
  const previous = process.env.CONTENT_ENTITY_PUBLIC_READ_ENABLED;
  const previousScope = process.env.CONTENT_ENTITY_PUBLIC_READ_SCOPE;
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, { findByDate: async () => [{ title: 'Verified programme', tmdbId: 1, startTime: new Date() }] } as any);
  const { req, res, getSentXml } = fakeReqRes();
  try {
    process.env.CONTENT_ENTITY_PUBLIC_READ_ENABLED = 'false';
    await controller.getProgramsSitemap(req, res, (() => {}) as any);
    assert.match(getSentXml(), /\/programas\/verified-programme/);
    process.env.CONTENT_ENTITY_PUBLIC_READ_ENABLED = 'true';
    delete process.env.CONTENT_ENTITY_PUBLIC_READ_SCOPE;
    await controller.getProgramsSitemap(req, res, (() => {}) as any);
    assert.match(getSentXml(), /\/programas\/verified-programme/, 'no scope: nothing is visible, so nothing is excluded');
    process.env.CONTENT_ENTITY_PUBLIC_READ_SCOPE = 'all';
    await controller.getProgramsSitemap(req, res, (() => {}) as any);
    assert.doesNotMatch(getSentXml(), /\/programas\/verified-programme/);
    assert.match(getSentXml(), /<urlset/);
  } finally {
    if (previous === undefined) delete process.env.CONTENT_ENTITY_PUBLIC_READ_ENABLED; else process.env.CONTENT_ENTITY_PUBLIC_READ_ENABLED = previous;
    if (previousScope === undefined) delete process.env.CONTENT_ENTITY_PUBLIC_READ_SCOPE; else process.env.CONTENT_ENTITY_PUBLIC_READ_SCOPE = previousScope;
    invalidateSitemapCache();
  }
});

test('sitemap-football.xml quarantines provider-only detail URLs', async () => {
  invalidateSitemapCache(); // module-level cache — same as every other sub-sitemap in this controller
  const footballQueryService = fakeFootballQueryService({
    getCompetitions: async () => ({
      competitions: [{ slug: 'laliga', name: 'LaLiga' }],
      meta: {},
    }),
    getMatches: async () => ({
      matches: [
        {
          slug: 'real-madrid-barcelona-2026-08-21',
          status: 'scheduled',
          kickoffAt: '2026-08-21T19:00:00.000Z',
          lastUpdatedAt: '2026-08-21T10:00:00.000Z',
          homeTeam: { slug: 'real-madrid', name: 'Real Madrid' },
          awayTeam: { slug: 'barcelona', name: 'Barcelona' },
        },
      ],
      meta: {},
    }),
  });

  const controller = new SitemapController({} as any, {} as any, undefined, footballQueryService);
  const { req, res, getSentXml, getStatusCode } = fakeReqRes();
  await controller.getFootballSitemap(req, res, (() => {}) as any);

  const xml = getSentXml();
  assert.equal(getStatusCode(), 200);
  assert.doesNotMatch(xml, /\/deportes\/futbol\/competiciones\/laliga/);
  assert.doesNotMatch(xml, /\/deportes\/futbol\/partido\/real-madrid-barcelona-2026-08-21/);
  assert.doesNotMatch(xml, /\/deportes\/futbol\/equipos\/real-madrid/);
});

test('sitemap-football.xml does not leak team URLs from repeated provider matches', async () => {
  invalidateSitemapCache();
  const footballQueryService = fakeFootballQueryService({
    getMatches: async () => ({
      matches: [
        {
          slug: 'match-1',
          status: 'finished',
          kickoffAt: '2026-08-20T19:00:00.000Z',
          lastUpdatedAt: '2026-08-20T21:00:00.000Z',
          homeTeam: { slug: 'real-madrid', name: 'Real Madrid' },
          awayTeam: { slug: 'sevilla', name: 'Sevilla' },
        },
        {
          slug: 'match-2',
          status: 'scheduled',
          kickoffAt: '2026-08-27T19:00:00.000Z',
          lastUpdatedAt: '2026-08-21T10:00:00.000Z',
          homeTeam: { slug: 'real-madrid', name: 'Real Madrid' },
          awayTeam: { slug: 'valencia', name: 'Valencia' },
        },
      ],
      meta: {},
    }),
  });

  const controller = new SitemapController({} as any, {} as any, undefined, footballQueryService);
  const { req, res, getSentXml } = fakeReqRes();
  await controller.getFootballSitemap(req, res, (() => {}) as any);

  const xml = getSentXml();
  const occurrences = xml.match(/\/deportes\/futbol\/equipos\/real-madrid</g) || [];
  assert.equal(occurrences.length, 0, 'provider-only team pages must remain quarantined');
});

test('sitemap-football.xml degrades gracefully when the football query service is absent', async () => {
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, {} as any, undefined, undefined);
  const { req, res, getSentXml, getStatusCode } = fakeReqRes();
  await controller.getFootballSitemap(req, res, (() => {}) as any);

  assert.equal(getStatusCode(), 200);
  assert.match(getSentXml(), /<urlset/);
  assert.doesNotMatch(getSentXml(), /deportes\/futbol/);
});

test('sitemap-football.xml remains empty when the provider fails', async () => {
  invalidateSitemapCache();
  const footballQueryService = fakeFootballQueryService({
    getCompetitions: async () => {
      throw new Error('provider down');
    },
    getMatches: async () => ({
      matches: [
        {
          slug: 'match-1',
          status: 'scheduled',
          kickoffAt: '2026-08-21T19:00:00.000Z',
          lastUpdatedAt: '2026-08-21T10:00:00.000Z',
          homeTeam: { slug: 'real-madrid', name: 'Real Madrid' },
          awayTeam: { slug: 'sevilla', name: 'Sevilla' },
        },
      ],
      meta: {},
    }),
  });

  const controller = new SitemapController({} as any, {} as any, undefined, footballQueryService);
  const { req, res, getSentXml, getStatusCode } = fakeReqRes();
  await controller.getFootballSitemap(req, res, (() => {}) as any);

  assert.equal(getStatusCode(), 200);
  assert.doesNotMatch(getSentXml(), /\/deportes\/futbol\/partido\/match-1/);
});

test('sitemap index excludes quarantined provider-only child sitemaps', async () => {
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, {} as any, {} as any, fakeFootballQueryService());
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getSitemapIndex(req, res, (() => {}) as any);

  assert.doesNotMatch(getSentXml(), /sitemap-streaming\.xml/);
  assert.doesNotMatch(getSentXml(), /sitemap-football\.xml/);
});

test('sitemap-streaming.xml is a non-empty valid urlset', async () => {
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, {} as any);
  const { req, res, getSentXml, getStatusCode } = fakeReqRes();

  await controller.getStreamingSitemap(req, res, (() => {}) as any);

  const xml = getSentXml();
  assert.equal(getStatusCode(), 200);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url>/g) || []).length, 4);
  assert.match(xml, /<loc>https:\/\/guiaprogramaciontv\.com\/plataformas<\/loc>/);
});

test('static sitemap excludes volatile trends until the page has an indexable quality signal', async () => {
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, {} as any);
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getStaticSitemap(req, res, (() => {}) as any);

  assert.doesNotMatch(getSentXml(), /<loc>[^<]*\/tendencias<\/loc>/);
});

test('sitemap-programs.xml only queries the same today/tomorrow window the slug resolver supports', async () => {
  invalidateSitemapCache();
  const requestedDates: string[] = [];
  const programRepository = {
    findByDate: async (date: string) => {
      requestedDates.push(date);
      return [{
        title: `Programa ${requestedDates.length}`,
        tmdbId: requestedDates.length,
        startTime: new Date(),
      }];
    },
  } as any;
  const controller = new SitemapController({} as any, programRepository);
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getProgramsSitemap(req, res, (() => {}) as any);

  assert.equal(requestedDates.length, 2, 'yesterday must not be queried for sitemap-only URLs');
  assert.match(getSentXml(), /\/programas\/programa-1/);
  assert.match(getSentXml(), /\/programas\/programa-2/);
});

test('sitemap-programs.xml uses the public TV read model instead of repository-only rows', async () => {
  invalidateSitemapCache();
  const programRepository = {
    findByDate: async () => [{
      title: 'Raw programme that cannot resolve',
      tmdbId: 999,
      startTime: new Date('2026-08-31T20:00:00.000Z'),
    }],
  } as any;
  const tvReadQueryService = {
    getChannels: async () => ({ channels: [], meta: {} }),
    getIndexableProgramSitemapRows: async (dates: string[]) => {
      assert.equal(dates.length, 2);
      return [
        {
          title: 'Resolvable programme',
          start: '2026-08-31T21:00:00.000Z',
        },
        {
          title: 'El último pase',
          start: '2026-08-31T22:00:00.000Z',
        },
      ];
    },
  } as any;
  const controller = new SitemapController(
    {} as any,
    programRepository,
    undefined,
    undefined,
    tvReadQueryService
  );
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getProgramsSitemap(req, res, (() => {}) as any);

  assert.match(getSentXml(), /\/programas\/resolvable-programme/);
  assert.match(getSentXml(), /\/programas\/el-ltimo-pase/);
  assert.doesNotMatch(getSentXml(), /\/programas\/el-ultimo-pase/);
  assert.doesNotMatch(getSentXml(), /raw-programme-that-cannot-resolve/);
});

test('M09: sitemap-programs.xml lists only slugs the /programas/:slug resolver answers, and a lookup failure is not cached', async () => {
  invalidateSitemapCache();
  clearSitemapLastGood();
  const tvReadQueryService = {
    getChannels: async () => ({ channels: [], meta: {} }),
    getIndexableProgramSitemapRows: async () => [
      { title: 'Resolvable', start: '2026-08-31T21:00:00.000Z' },
      { title: 'Bonanza', start: '2026-08-31T21:00:00.000Z' },
      { title: 'Sentimos las molestias T2 E1', start: '2026-08-31T21:00:00.000Z' },
    ],
  } as any;
  const asked: string[] = [];
  let failing = false;
  const controller = new SitemapController({} as any, {} as any, undefined, undefined, tvReadQueryService,
    async (slug) => { asked.push(slug); if (failing) throw new Error('db down'); return slug === 'resolvable'; });

  const first = fakeReqRes();
  await controller.getProgramsSitemap(first.req, first.res, (() => {}) as any);
  assert.deepEqual([...asked].sort(), ['bonanza', 'resolvable', 'sentimos-las-molestias-t2-e1']);
  assert.match(first.getSentXml(), /\/programas\/resolvable</);
  assert.doesNotMatch(first.getSentXml(), /bonanza|sentimos/);

  invalidateSitemapCache();
  clearSitemapLastGood(); // no previous build to fall back to
  failing = true;
  let error: unknown;
  await controller.getProgramsSitemap(first.req, first.res, ((e: unknown) => { error = e; }) as any);
  assert.ok(error, 'an outage must surface as an error, not as a truncated sitemap');
});

test('M09: a failing rebuild serves the last good sitemap, retries later, and stops the other workers', async () => {
  invalidateSitemapCache();
  clearSitemapLastGood();
  const rows = Array.from({ length: 200 }, (_, i) => ({ title: `Programa ${i}`, start: '2026-08-31T21:00:00.000Z' }));
  const tvReadQueryService = { getChannels: async () => ({ channels: [], meta: {} }), getIndexableProgramSitemapRows: async () => rows } as any;
  let calls = 0;
  let failing = false;
  const controller = new SitemapController({} as any, {} as any, undefined, undefined, tvReadQueryService,
    async () => { calls++; await new Promise((r) => setImmediate(r)); if (failing) throw new Error('db down'); return true; });

  const ok = fakeReqRes();
  await controller.getProgramsSitemap(ok.req, ok.res, (() => {}) as any);
  const good = ok.getSentXml();
  assert.equal((good.match(/<url>/g) || []).length, 200);

  invalidateSitemapCache(); // an EPG rebuild: the cache is dropped, the last good build is kept
  failing = true;
  calls = 0;
  const stale = fakeReqRes();
  let error: unknown;
  await controller.getProgramsSitemap(stale.req, stale.res, ((e: unknown) => { error = e; }) as any);
  assert.equal(error, undefined);
  assert.equal(stale.getSentXml(), good, 'stale XML instead of a 5xx');
  assert.ok(calls <= 16, `workers stopped after the first failure (${calls} of 200 lookups ran)`);

  const before = calls;
  await controller.getProgramsSitemap(stale.req, stale.res, (() => {}) as any);
  assert.equal(calls, before, 'the stale answer is cached briefly: no rebuild on the next request');
});

test('M09: sitemap index declares no invented lastmod', async () => {
  invalidateSitemapCache();
  const controller = new SitemapController({} as any, {} as any);
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getSitemapIndex(req, res, (() => {}) as any);

  assert.match(getSentXml(), /<sitemap>\s*<loc>[^<]+sitemap-programs\.xml<\/loc>\s*<\/sitemap>/);
  assert.doesNotMatch(getSentXml(), /lastmod/);
});

test('sitemap-blog.xml excludes categories with fewer than three approved posts', async () => {
  invalidateSitemapCache();
  const originalFind = (await import('../../infrastructure/database/models/BlogPost.model')).BlogPostModel.find;
  const posts = [
    { slug: 'uno', categories: [{ slug: 'sparse' }, { slug: 'enough' }] },
    { slug: 'dos', categories: [{ slug: 'enough' }] },
    { slug: 'tres', categories: [{ slug: 'enough' }] },
  ];
  (await import('../../infrastructure/database/models/BlogPost.model')).BlogPostModel.find = (() => ({
    select: () => ({ lean: () => ({ exec: async () => posts }) }),
  })) as any;
  try {
    const controller = new SitemapController({} as any, {} as any);
    const { req, res, getSentXml } = fakeReqRes();
    await controller.getBlogSitemap(req, res, (() => {}) as any);
    assert.match(getSentXml(), /\/guias\/categoria\/enough/);
    assert.doesNotMatch(getSentXml(), /\/guias\/categoria\/sparse/);
  } finally {
    (await import('../../infrastructure/database/models/BlogPost.model')).BlogPostModel.find = originalFind;
  }
});

test('sitemap-channels.xml excludes channels without a resolvable schedule', async () => {
  invalidateSitemapCache();
  const tvReadQueryService = {
    getChannels: async () => ({
      channels: [{
        channel: {
          id: 'la-1',
          name: 'La 1',
          normalizedName: 'la_1',
          group: 'tdt',
        },
      }],
      meta: {},
    }),
  } as any;
  const controller = new SitemapController(
    {} as any,
    {} as any,
    undefined,
    undefined,
    tvReadQueryService
  );
  const { req, res, getSentXml } = fakeReqRes();

  await controller.getChannelsSitemap(req, res, (() => {}) as any);

  assert.match(getSentXml(), /\/canales\/la-1</);
  assert.doesNotMatch(getSentXml(), /\/canales\/canal[-_]vacio/);
});

test('sitemap-blog.xml lists the rankings hub only when a ranking post is published', async () => {
  invalidateSitemapCache();
  const Model = (await import('../../infrastructure/database/models/BlogPost.model')).BlogPostModel;
  const originalFind = Model.find;
  const run = async (posts: unknown[]) => {
    invalidateSitemapCache();
    (Model as any).find = () => ({ select: () => ({ lean: () => ({ exec: async () => posts }) }) });
    const controller = new SitemapController({} as any, {} as any);
    const { req, res, getSentXml } = fakeReqRes();
    await controller.getBlogSitemap(req, res, (() => {}) as any);
    return getSentXml();
  };
  try {
    assert.doesNotMatch(await run([{ slug: 'a', contentType: 'guide', categories: [] }]), /guias\/rankings/);
    assert.match(await run([{ slug: 'b', contentType: 'ranking', categories: [] }]), /guias\/rankings/);
  } finally {
    (Model as any).find = originalFind;
    invalidateSitemapCache();
  }
});

// Phase 1 TS-13: lastmod carried the airing start (tomorrow's airings => future dates) and "today" on every static page.
test('sitemap lastmod is a real change date: never in the future, absent when unknown', async () => {
  invalidateSitemapCache();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const tvReadQueryService = {
    getChannels: async () => ({ channels: [], meta: {} }),
    getIndexableProgramSitemapRows: async () => [
      { title: 'Mañana estreno', start: tomorrow, updatedAt: '2026-10-18T09:00:00.000Z' },
      { title: 'Mañana estreno', start: tomorrow, updatedAt: '2026-10-19T09:00:00.000Z' },
      { title: 'Reloj adelantado', start: tomorrow, updatedAt: tomorrow },
      { title: 'Sin fecha de cambio', start: tomorrow },
    ],
  } as any;
  const controller = new SitemapController({} as any, {} as any, undefined, undefined, tvReadQueryService);
  const programs = fakeReqRes();
  await controller.getProgramsSitemap(programs.req, programs.res, (() => {}) as any);
  const xml = programs.getSentXml();
  const entry = (slug: string) => new RegExp(`/programas/${slug}</loc>\\n(\\s*<lastmod>([^<]+)</lastmod>)?`).exec(xml);
  assert.equal(entry('maana-estreno')?.[2], '2026-10-19', 'newest change among the rows of that page');
  assert.equal(entry('reloj-adelantado')?.[2], today, 'a future change time is clamped to today');
  assert.equal(entry('sin-fecha-de-cambio')?.[1], undefined, 'unknown change time: no lastmod');
  assert.equal(xml.match(/\/programas\/maana-estreno</g)?.length, 1);

  invalidateSitemapCache();
  const statics = fakeReqRes();
  await controller.getStaticSitemap(statics.req, statics.res, (() => {}) as any);
  const staticXml = statics.getSentXml();
  assert.match(staticXml, /\/programacion-tv\/en-directo<\/loc>\n\s*<lastmod>/, 'schedule pages change daily');
  assert.match(staticXml, /\/avisolegal<\/loc>\n\s*<changefreq>/, 'stable pages carry no lastmod');
  for (const [, date] of staticXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.ok(date <= today, date);
});

test('sitemap-blog.xml dates listings by their newest post and leaves out the redirected rankings category', async () => {
  const Model = (await import('../../infrastructure/database/models/BlogPost.model')).BlogPostModel;
  const originalFind = Model.find;
  const ranking = (slug: string, updatedAt: string) => ({ slug, contentType: 'ranking', updatedAt: new Date(updatedAt), categories: [{ slug: 'rankings' }] });
  (Model as any).find = () => ({ select: () => ({ lean: () => ({ exec: async () => [
    ranking('a', '2026-10-01T10:00:00Z'), ranking('b', '2026-10-15T10:00:00Z'), ranking('c', '2026-10-05T10:00:00Z'),
  ] }) }) });
  try {
    invalidateSitemapCache();
    const controller = new SitemapController({} as any, {} as any);
    const { req, res, getSentXml } = fakeReqRes();
    await controller.getBlogSitemap(req, res, (() => {}) as any);
    assert.match(getSentXml(), /\/guias\/rankings<\/loc>\n\s*<lastmod>2026-10-15<\/lastmod>/);
    assert.doesNotMatch(getSentXml(), /\/guias\/categoria\/rankings/);
  } finally {
    (Model as any).find = originalFind;
    invalidateSitemapCache();
  }
});
