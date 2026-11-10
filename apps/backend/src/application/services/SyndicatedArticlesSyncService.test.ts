import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mapSyndicatedArticle, syncDecisionFor } from './SyndicatedArticlesSyncService';
import { RETIRED_EDITORIAL_SLUGS, isRetiredEditorialSlug } from './RetiredEditorialSlugs';
import { configuredArticleFeeds } from '../../jobs/syncArticleFeeds';

const NOW = new Date('2026-11-10T10:00:00.000Z');

const article = {
  id: '42',
  slug: 'mejores-series-2026',
  title: 'Las mejores series de 2026',
  content_html: '<p>Netflix estrena <a href="https://guiaprogramaciontv.com/editorial/otra">otra guía</a>.</p>',
  content_markdown: '# Las mejores series',
  meta_description: 'Un repaso a las series de 2026.',
  hero_image_url: 'https://cdn.babylovegrowth.ai/cover.webp',
  languageCode: 'es',
  publishedAt: '2026-11-09T08:30:00.000Z',
  published_url: 'https://guiaprogramaciontv.com/guias/mejores-series-2026',
  jsonLd: { '@context': 'https://schema.org', '@type': 'Article', author: { '@type': 'Person', name: 'Marta Ruiz' } },
  faqJsonLd: {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [{ '@type': 'Question', name: '¿Dónde verla?', acceptedAnswer: { '@type': 'Answer', text: 'En Netflix.' } }],
  },
};

const mapped = (provider: 'babylovegrowth' | 'auctorio' = 'babylovegrowth') => {
  const result = mapSyndicatedArticle(article, NOW, provider);
  assert.ok(result.ok);
  return result;
};

test('maps a feed article into a public post, keyed by slug', () => {
  const result = mapped();

  assert.equal(result.slug, 'mejores-series-2026');
  assert.equal(result.fields.title, 'Las mejores series de 2026');
  assert.equal(result.fields.status, 'publish');
  assert.equal(result.fields.reviewState, 'approved');
  assert.equal(result.fields.reviewedBy, 'policy:babylovegrowth');
  assert.equal(result.fields.origin, 'automated-import');
  // The body is stored with this site's current internal path, not the one the feed shipped.
  assert.match(String(result.fields.content), /href="\/guias\/otra"/);
  assert.deepEqual(result.fields.seo, {
    metaDescription: 'Un repaso a las series de 2026.',
    ogImage: 'https://cdn.babylovegrowth.ai/cover.webp',
  });
  assert.deepEqual(result.fields.featuredImage, {
    sourceUrl: 'https://cdn.babylovegrowth.ai/cover.webp',
    alt: 'Las mejores series de 2026',
  });
  assert.equal(result.fields.language, 'es');
  assert.deepEqual(result.fields.publishedAt, new Date('2026-11-09T08:30:00.000Z'));
  // The byline comes from the feed's own JSON-LD when it names one.
  assert.deepEqual(result.fields.author, { name: 'Marta Ruiz', id: 'babylovegrowth' });
  // FAQ answers show in the renderable FAQ block and stay available as source JSON-LD for the head.
  assert.deepEqual(result.fields.faqItems, [{ question: '¿Dónde verla?', answer: 'En Netflix.' }]);
  assert.deepEqual(result.fields.structuredData, { jsonLd: article.jsonLd, faqJsonLd: article.faqJsonLd });
  assert.equal((result.fields.external as Record<string, unknown>).articleId, '42');
  assert.equal((result.fields.external as Record<string, unknown>).provider, 'babylovegrowth');
  assert.equal((result.fields.external as Record<string, unknown>).contentMarkdown, '# Las mejores series');
});

test('the same producer owns its provider tag, so Auctorio posts never collide with BabyLoveGrowth ones', () => {
  const auctorioArticle = { ...article, jsonLd: { '@context': 'https://schema.org', '@type': 'Article' } };
  const result = mapSyndicatedArticle(auctorioArticle, NOW, 'auctorio');
  assert.ok(result.ok);

  assert.equal(result.fields.reviewedBy, 'policy:auctorio');
  assert.equal((result.fields.external as Record<string, unknown>).provider, 'auctorio');
  // No JSON-LD author: the byline names the producer instead of inventing a person.
  assert.deepEqual(result.fields.author, { name: 'Auctorio', id: 'auctorio' });
  // Same article, different producer: different hash, so one feed cannot mask the other's update.
  assert.notEqual(result.sourceHash, mapped('babylovegrowth').sourceHash);
});

test('the same article maps to the same hash, so a re-sync does not rewrite it', () => {
  const first = mapped();
  const second = mapSyndicatedArticle({ ...article }, new Date('2026-11-10T11:00:00.000Z'), 'babylovegrowth');
  assert.ok(second.ok);
  assert.equal(first.sourceHash, second.sourceHash);

  const edited = mapSyndicatedArticle({ ...article, title: 'Las mejores series de 2027' }, NOW, 'babylovegrowth');
  assert.ok(edited.ok);
  assert.notEqual(edited.sourceHash, first.sourceHash);
});

test('excerpt falls back to the visible text when the feed ships no meta description', () => {
  const result = mapSyndicatedArticle(
    { ...article, meta_description: '', content_html: `<p>${'palabra '.repeat(80)}</p>`, faqJsonLd: undefined, jsonLd: undefined },
    NOW,
    'babylovegrowth'
  );
  assert.ok(result.ok);
  const excerpt = String(result.fields.excerpt);
  assert.ok(excerpt.length > 0 && excerpt.length <= 201, excerpt);
  assert.ok(!excerpt.includes('<'), 'the excerpt is plain text');
  assert.deepEqual(result.fields.author, { name: 'BabyLoveGrowth', id: 'babylovegrowth' });
});

test('an article without slug, title or html body is skipped instead of stored half-written', () => {
  for (const [patch, reason] of [
    [{ slug: '' }, 'sin slug'],
    [{ title: '  ' }, 'sin título'],
    [{ content_html: '' }, 'sin content_html'],
  ] as const) {
    const result = mapSyndicatedArticle({ ...article, ...patch }, NOW, 'babylovegrowth');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, reason);
  }
});

test('a re-sync overwrites only what it wrote itself and nobody has withdrawn', () => {
  const own = { provider: 'babylovegrowth', sourceHash: mapped().sourceHash };

  assert.equal(syncDecisionFor(null, mapped(), 'babylovegrowth'), 'create');
  assert.equal(syncDecisionFor({ reviewState: 'approved', external: own }, mapped(), 'babylovegrowth'), 'unchanged');
  assert.equal(
    syncDecisionFor({ reviewState: 'approved', external: { ...own, sourceHash: 'viejo' } }, mapped(), 'babylovegrowth'),
    'update'
  );
  // A guide written on the site owns its slug: the import never replaces it.
  assert.equal(syncDecisionFor({ reviewState: 'approved' }, mapped(), 'babylovegrowth'), 'keep-native');
  // The same slug written by the other producer is not ours to rewrite either.
  assert.equal(
    syncDecisionFor({ reviewState: 'approved', external: { ...own, provider: 'auctorio' } }, mapped(), 'babylovegrowth'),
    'keep-native'
  );
  // Rejected by a person: the schedule does not publish it again.
  assert.equal(syncDecisionFor({ reviewState: 'rejected', external: own }, mapped(), 'babylovegrowth'), 'keep-rejected');
});

test('each configured producer feeds the same job, and a missing key only disables its own feed', () => {  const both = configuredArticleFeeds({
    BABYLOVEGROWTH_API_KEY: 'blg-key',
    AUCTORIO_FEED_API_KEY: 'auctorio-key',
    AUCTORIO_FEED_SITE: 'guiatv-editorial',
    AUCTORIO_FEED_BASE_URL: 'https://auctorio.example/api/integrations',
  } as NodeJS.ProcessEnv);

  assert.deepEqual(both.map((feed) => feed.provider), ['babylovegrowth', 'auctorio']);
  assert.deepEqual(both[1].defaults, { site: 'guiatv-editorial' });
  assert.equal(both[1].baseUrl, 'https://auctorio.example/api/integrations');
  assert.equal(both[0].baseUrl, 'https://api.babylovegrowth.ai/api/integrations');

  const auctorioOnly = configuredArticleFeeds({ AUCTORIO_FEED_API_KEY: 'auctorio-key' } as NodeJS.ProcessEnv);
  assert.deepEqual(auctorioOnly.map((feed) => feed.provider), ['auctorio']);
  assert.equal(auctorioOnly[0].baseUrl, 'https://auctorio.com/api/integrations');
  assert.equal(auctorioOnly[0].defaults, undefined);

  assert.deepEqual(configuredArticleFeeds({} as NodeJS.ProcessEnv), []);
});

test('a retired slug never becomes a public article', () => {
  assert.equal(isRetiredEditorialSlug('donde-ver-la-champions-league-2026-27-en-tv-y-streaming-en-espana'), true);
  assert.equal(isRetiredEditorialSlug('Mejores-Series-Netflix'), true);
  assert.equal(isRetiredEditorialSlug(' mejores-series-2026 '), false);
});

test('the retired list mirrors the redirects the site actually serves', () => {
  const ssr = join(__dirname, '../../../..', 'frontend/scripts/ssr-server.mjs');
  if (!existsSync(ssr)) return;
  const source = readFileSync(ssr, 'utf8');
  for (const slug of RETIRED_EDITORIAL_SLUGS) {
    assert.ok(source.includes(`'${slug}':`), `${slug} is no longer in EDITORIAL_REDIRECTS (ssr-server.mjs)`);
  }
});
