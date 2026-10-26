// M09 measurement: cost of the programmes-sitemap resolvability guard on a production-sized synthetic day pair.
// Needs a THROWAWAY MongoDB (the database is dropped) and a built backend:
//   docker run -d --name m09mongo -p 27119:27017 mongo:8
//   npm run build -w apps/backend && node scripts/sitemap-programs-perf.cjs mongodb://127.0.0.1:27119
const path = require('node:path');
const dist = path.join(__dirname, '..', 'apps', 'backend', 'dist');
require(path.join(dist, '..', 'test-setup.cjs'));
const mongoose = require('mongoose');
const { TVReadAiringModel } = require(path.join(dist, 'infrastructure/database/models/TVReadAiring.model'));
const { TvReadQueryService } = require(path.join(dist, 'application/services/TvReadQueryService'));
const { CatalogService } = require(path.join(dist, 'application/services/CatalogService'));
const { SitemapController } = require(path.join(dist, 'presentation/controllers/SitemapController'));
const { buildSearchTokens } = require(path.join(dist, 'shared/utils/tvMetadata'));
const { DateUtils } = require(path.join(dist, 'shared/utils/dateUtils'));

const uri = process.argv[2];
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri || '')) throw new Error('pass a local throwaway mongodb:// URI');
const WORDS = 'la el del de los las casa amor noche dia mar sol luna fuego tierra cielo rey reina guerra paz viaje secreto misterio ley orden crimen doctor ciudad vida muerte historia mundo hombre mujer cine deportes noticias'.split(' ');
const CHANNELS = Array.from({ length: 120 }, (_, i) => `canal_${i}`);
const CATEGORIES = ['Series', 'Cine', 'Deportes', 'Informativos', 'Entretenimiento', 'Documentales'];
let seed = 7;
const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const title = (i) => `${WORDS[rnd(WORDS.length)]} ${WORDS[rnd(WORDS.length)]} ${i}`;

(async () => {
  await mongoose.connect(uri, { dbName: `guiatv_m09_perf_${process.pid}` });
  const queries = { n: 0, byOp: {} };
  mongoose.set('debug', (_c, op) => { queries.n++; queries.byOp[op] = (queries.byOp[op] || 0) + 1; });
  try {
    await TVReadAiringModel.init();
    const dates = [DateUtils.getTodayYYYYMMDD(), DateUtils.getTomorrowYYYYMMDD()];
    // ~11k airings per day (production: 32k over 3 days); 380 distinct tmdb-matched titles per day, the rest generic EPG.
    const docs = [];
    for (const date of dates) {
      for (let i = 0; i < 11000; i++) {
        const matched = i < 1900; // 380 titles x ~5 airings
        const t = matched ? `Programa ${date.slice(-2)}x${i % 380}` : title(i);
        const channel = CHANNELS[i % CHANNELS.length];
        docs.push({
          id: `${date}_${channel}_${i}`, date,
          program: { title: t, tmdbId: matched ? 1000 + (i % 380) : undefined, titleResolutionState: 'resolved' },
          channel: { id: channel, name: channel, group: 'tdt', sortOrder: i % 120 },
          airing: { start: new Date(Date.UTC(2026, 9, 26, i % 24, i % 60)).toISOString(), end: new Date(Date.UTC(2026, 9, 26, (i % 24) + 1)).toISOString(), date },
          searchTokens: buildSearchTokens([t, CATEGORIES[i % 6], channel]),
          updatedAt: new Date(),
        });
      }
    }
    await TVReadAiringModel.collection.insertMany(docs);
    const tv = new TvReadQueryService({ get: async () => null, set: async () => undefined, clear: async () => undefined });
    const catalog = new CatalogService({}, {}, {}, {}, {}, tv);
    const run = async (label, resolver) => {
      queries.n = 0; queries.byOp = {};
      const controller = new SitemapController({}, {}, undefined, undefined, tv, resolver);
      let xml = '';
      const res = { set() {}, status() { return this; }, send(x) { xml = x; } };
      const rss0 = process.memoryUsage().rss;
      const t0 = process.hrtime.bigint();
      await controller.getProgramsSitemap({}, res, (e) => { throw e; });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(JSON.stringify({ label, urls: (xml.match(/<url>/g) || []).length, ms: Math.round(ms), mongoQueries: queries.n, byOp: queries.byOp, rssDeltaMB: Math.round((process.memoryUsage().rss - rss0) / 1e6) }));
      require(path.join(dist, 'presentation/controllers/SitemapController')).invalidateSitemapCache();
    };
    await run('without guard', undefined);
    await run('with guard', (slug) => catalog.programSlugResolves(slug));
    const [explain] = await TVReadAiringModel.find({ searchTokens: 'programa', date: dates[0] }).explain('executionStats').then((e) => [e.executionStats]);
    console.log(JSON.stringify({ tokenDateFindExplain: { stage: explain.executionStages.stage, keysExamined: explain.totalKeysExamined, docsExamined: explain.totalDocsExamined } }));
  } finally {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
