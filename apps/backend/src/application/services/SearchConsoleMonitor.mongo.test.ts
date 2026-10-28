/**
 * Read-only Search Console monitor against a real Mongo and a scripted Google (no network): indexed vs not indexed,
 * missing credentials, no data, quota and permission stops, preliminary rows and the once-per-24h inspection rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { classifyInspection, runSearchConsoleMonitor, searchConsoleOverview } from './SearchConsoleMonitor';

const NOW = new Date('2026-10-28T06:00:00Z');
const A = 'https://guiaprogramaciontv.com/guias/guia-a';
const B = 'https://guiaprogramaciontv.com/guias/guia-b';
const SITE = 'sc-domain:guiaprogramaciontv.com';

const INDEXED = { verdict: 'PASS', coverageState: 'Submitted and indexed', indexingState: 'INDEXING_ALLOWED', robotsTxtState: 'ALLOWED', pageFetchState: 'SUCCESSFUL', lastCrawlTime: '2026-10-26T10:00:00Z', googleCanonical: A, userCanonical: A, sitemap: ['https://guiaprogramaciontv.com/sitemap.xml'] };
const NOT_INDEXED = { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed', indexingState: 'INDEXING_ALLOWED', robotsTxtState: 'ROBOTS_TXT_STATE_UNSPECIFIED', pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED' };

interface Script { inspect?: (url: string) => [number, unknown]; pages?: unknown; queries?: unknown }
function google(script: Script) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    const [status, payload] = url.endsWith('index:inspect')
      ? script.inspect!(body.inspectionUrl)
      : [200, body.dimensions.length === 2 ? script.pages ?? {} : script.queries ?? {}];
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchImpl, getToken: async () => 'test-token', siteUrl: SITE };
}
const inspectOk = (url: string): [number, unknown] => [200, { inspectionResult: { indexStatusResult: url === A ? INDEXED : NOT_INDEXED } }];
const inspectCalls = (calls: Array<{ url: string }>) => calls.filter((c) => c.url.endsWith('index:inspect')).length;

test('Search Console monitor stores genuine observations only', { skip: !process.env.TEST_MONGO_URI }, async (t) => {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `guiatv_test_gsc_${process.pid}` });
  const col = (name: string) => mongoose.connection.collection(name);
  const reset = () => Promise.all(['editorial_gsc_inspections', 'editorial_gsc_inspection_history', 'editorial_gsc_performance', 'editorial_gsc_runs'].map((n) => col(n).deleteMany({})));
  try {
    await BlogPostModel.collection.insertMany([
      { slug: 'guia-a', title: 'A', status: 'publish', reviewState: 'approved', publishedAt: new Date('2026-10-01') },
      { slug: 'guia-b', title: 'B', status: 'publish', reviewState: 'approved', publishedAt: new Date('2026-09-01') },
      { slug: 'borrador', title: 'C', status: 'draft', reviewState: 'unreviewed' },
    ]);

    await t.test('missing credentials: recorded, nothing called', async () => {
      await reset();
      const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      let called = 0;
      try {
        const run = await runSearchConsoleMonitor({ now: NOW, siteUrl: SITE, fetch: (async () => { called++; return new Response('{}'); }) as unknown as typeof fetch });
        assert.equal(run.status, 'missing-credentials');
        assert.equal(run.message, 'GOOGLE_APPLICATION_CREDENTIALS is not set');
      } finally {
        if (saved !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
      }
      assert.equal(called, 0);
      assert.equal((await searchConsoleOverview(NOW)).lastRun!.status, 'missing-credentials');
    });

    await t.test('no data available: no rows stored, baseline incomplete, not zeros', async () => {
      await reset();
      const g = google({ inspect: inspectOk, pages: { rows: [] }, queries: {} });
      const run = await runSearchConsoleMonitor({ ...g, now: NOW });
      assert.equal(run.status, 'ok');
      assert.equal(await col('editorial_gsc_performance').countDocuments(), 0);
      const ov = await searchConsoleOverview(NOW);
      assert.deepEqual(ov.baseline, { days: 0, complete: false });
      assert.deepEqual(ov.guides.map((x) => x.performance), [null, null]);
    });

    await t.test('indexed vs not indexed, partial performance data and the 24 h rule', async () => {
      await reset();
      const g = google({
        inspect: inspectOk,
        pages: {
          rows: [
            { keys: ['2026-10-25', A], clicks: 2, impressions: 10, ctr: 0.2, position: 4 },
            { keys: ['2026-10-26', A], clicks: 0, impressions: 30, ctr: 0, position: 8 },
            { keys: ['2026-10-27', A], clicks: 1, impressions: 10, ctr: 0.1, position: 2 },
          ],
          metadata: { firstIncompleteDate: '2026-10-26' },
        },
        queries: { rows: [{ keys: ['2026-10-25', A, 'guia a'], clicks: 2, impressions: 9, ctr: 0.22, position: 3.9 }] },
      });
      const run = await runSearchConsoleMonitor({ ...g, now: NOW });
      assert.deepEqual([run.status, run.inspected, run.skipped, run.pageRows, run.queryRows], ['ok', 2, 0, 3, 1]);
      const window = g.calls.find((c) => c.url.includes('searchAnalytics'))!.body;
      assert.deepEqual([window.startDate, window.endDate, window.dataState], ['2026-10-01', '2026-10-28', 'all']);
      assert.ok(g.calls.every((c) => !c.url.includes('indexing.googleapis.com')));
      assert.equal(inspectCalls(g.calls), 2, 'the draft is not inspected');

      const rows = await col('editorial_gsc_performance').find({ query: null }).sort({ date: 1 }).toArray();
      assert.deepEqual(rows.map((r) => [r.date, r.preliminary]), [['2026-10-25', false], ['2026-10-26', true], ['2026-10-27', true]]);

      const ov = await searchConsoleOverview(NOW);
      const [a, b] = ov.guides;
      assert.deepEqual([a.inspection!.indexed, a.inspection!.coverageState, a.inspection!.canonicalMatch], [true, 'Submitted and indexed', true]);
      assert.equal(b.url, B);
      assert.deepEqual([b.inspection!.indexed, b.inspection!.coverageState, b.inspection!.canonicalMatch], [false, 'Discovered - currently not indexed', null]);
      assert.deepEqual(a.performance, { clicks: 3, impressions: 50, ctr: 0.06, position: 6, days: 3, baselineComplete: false, preliminary: true });
      assert.equal(b.performance, null);
      assert.deepEqual(ov.baseline, { days: 3, complete: false });

      const again = google({ inspect: inspectOk });
      const second = await runSearchConsoleMonitor({ ...again, now: new Date(NOW.getTime() + 3600e3) });
      assert.deepEqual([second.inspected, second.skipped, inspectCalls(again.calls)], [0, 2, 0], 'inspected less than 24 h ago');
      assert.equal(await col('editorial_gsc_performance').countDocuments({ query: null }), 3, 'an empty later answer deletes nothing');
      // M11-G: the indexed guide waits a week; the one Google has not indexed is checked again the next day.
      const later = google({ inspect: inspectOk });
      const third = await runSearchConsoleMonitor({ ...later, now: new Date(NOW.getTime() + 25 * 3600e3) });
      assert.deepEqual([third.inspected, third.skipped], [1, 1]);
      assert.deepEqual(later.calls.filter((c) => c.url.endsWith('index:inspect')).map((c) => c.body.inspectionUrl), [B]);
      const week = google({ inspect: inspectOk });
      assert.equal((await runSearchConsoleMonitor({ ...week, now: new Date(NOW.getTime() + 8 * 864e5) })).inspected, 2);

      // Every inspection is kept as a snapshot, with its normalised class next to Google's own words.
      const snaps = await col('editorial_gsc_inspection_history').find({ url: B }).sort({ inspectedAt: 1 }).toArray();
      assert.deepEqual(snaps.map((s) => [s.classification, s.coverageState]), Array(3).fill(['discovered-not-indexed', 'Discovered - currently not indexed']));
      const ovAfter = await searchConsoleOverview(new Date(NOW.getTime() + 8 * 864e5));
      assert.deepEqual(ovAfter.summary.byClassification, { indexed: 1, 'discovered-not-indexed': 1 });
      assert.deepEqual(ovAfter.summary.byPublicationDay, { '2026-10-01': 1, '2026-09-01': 1 });
      assert.deepEqual(ovAfter.guides.map((g) => [g.ageDays, g.ageBand, g.strategy, g.firstPartyData]), [[35, 'más de 28 días', 'manual', false], [65, 'más de 28 días', 'manual', false]]);
      assert.equal(ovAfter.guides[0].daysSinceCrawl, 9);
    });

    await t.test('classification uses Google\'s structured fields, never a missing value as a negative', () => {
      const base = { inspectedAt: NOW, error: null };
      assert.equal(classifyInspection(null), 'insufficient-evidence');
      assert.equal(classifyInspection({ ...base, error: 'HTTP 500' }), 'insufficient-evidence');
      assert.equal(classifyInspection({ ...base, verdict: 'PASS' }), 'indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG' }), 'blocked');
      assert.equal(classifyInspection({ ...base, verdict: 'FAIL', robotsTxtState: 'DISALLOWED' }), 'blocked');
      assert.equal(classifyInspection({ ...base, verdict: 'FAIL', pageFetchState: 'SOFT_404' }), 'fetch-error');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', googleCanonical: B, userCanonical: A, lastCrawlTime: 'x' }), 'alternate-canonical');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', lastCrawlTime: '2026-10-20T10:53:41Z' }), 'crawled-not-indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', sitemaps: ['https://guiaprogramaciontv.com/sitemap.xml'] }), 'discovered-not-indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', referringUrls: ['https://guiaprogramaciontv.com/guias'] }), 'discovered-not-indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', coverageState: 'Descubierta: actualmente sin indexar' }), 'discovered-not-indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', coverageState: 'Rastreada: actualmente sin indexar' }), 'crawled-not-indexed');
      assert.equal(classifyInspection({ ...base, verdict: 'NEUTRAL', coverageState: 'Google no reconoce esta URL' }), 'not-discovered');
    });

    await t.test('quota exhaustion stops the run and is recorded', async () => {
      await reset();
      const g = google({ inspect: () => [429, { error: { code: 429, message: 'Quota exceeded for quota metric' } }] });
      const run = await runSearchConsoleMonitor({ ...g, now: NOW });
      assert.equal(run.status, 'quota-exceeded');
      assert.match(run.message!, /Quota exceeded for quota metric/);
      assert.doesNotMatch(run.message!, /test-token/);
      assert.equal(inspectCalls(g.calls), 1, 'no further inspections after the 429');
      assert.equal(await col('editorial_gsc_inspections').countDocuments(), 0);
      assert.equal(await col('editorial_gsc_runs').countDocuments({ status: 'quota-exceeded' }), 1);
    });

    await t.test('no permission on the property', async () => {
      await reset();
      const g = google({ inspect: inspectOk });
      g.fetch = (async () => new Response(JSON.stringify({ error: { message: 'User does not have sufficient permission for site' } }), { status: 403 })) as unknown as typeof fetch;
      const run = await runSearchConsoleMonitor({ ...g, now: NOW });
      assert.equal(run.status, 'forbidden');
      assert.match(run.message!, /no permission on sc-domain:guiaprogramaciontv\.com/);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
