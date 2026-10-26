import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEditorialPostCanBeApproved,
  assertReviewerIsAccountable,
  buildEditorialApproval,
  PUBLIC_EDITORIAL_FILTER,
  canonicalInternalPath,
  canonicalizeInternalLinks,
  EditorialFinding,
  editorialGateFailures,
  evaluateEditorialQuality,
} from './EditorialReviewPolicy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const validPost = {
  title: 'Guía de series de streaming que merece la pena ver',
  excerpt: 'Una introducción concreta que explica qué serie de streaming encontrará el lector en la guía.',
  content: `<p>${'contenido editorial verificado sobre esta serie de streaming '.repeat(90)}</p>`,
  author: { name: 'Equipo editorial Guía TV', id: 'guiatv-editorial' },
  seo: {
    metaTitle: 'Guía útil y revisada | Guía TV',
    metaDescription: 'Información verificada y útil para elegir qué ver en televisión y streaming.',
  },
  categories: [{ name: 'Series', slug: 'series' }],
};

test('approval rejects content with no cine/series/TV/streaming signal', () => {
  assert.throws(
    () =>
      assertEditorialPostCanBeApproved({
        ...validPost,
        categories: [{ name: 'Economía', slug: 'economia' }],
        title: 'Informe trimestral de resultados económicos',
        excerpt: 'Un resumen de indicadores macroeconómicos del último trimestre publicado hoy.',
        content: `<p>${'datos macroeconómicos y resultados financieros trimestrales '.repeat(90)}</p>`,
      }),
    /relevancia editorial/i
  );
});

test('public editorial filter requires both publish status and explicit approval', () => {
  assert.deepEqual(PUBLIC_EDITORIAL_FILTER, {
    status: 'publish',
    reviewState: 'approved',
  });
});

test('approval rejects missing authorship and low-value content', () => {
  assert.throws(
    () => assertEditorialPostCanBeApproved({ ...validPost, author: undefined, content: '<p>Breve.</p>' }),
    /author|contenido/i
  );
});

test('approval records reviewer and publishes in one auditable transition', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');
  assert.deepEqual(buildEditorialApproval(validPost, 'editora@guia.test', now), {
    status: 'publish',
    reviewState: 'approved',
    reviewedBy: 'editora@guia.test',
    reviewedAt: now,
    publishedAt: now,
  });
});

test('approval requires a named reviewer distinct from content generation', () => {
  assert.throws(() => buildEditorialApproval(validPost, '', new Date()), /reviewer/i);
});

test('approval rejects leftover markdown and unsourced non-human content', () => {
  assert.throws(
    () => assertEditorialPostCanBeApproved({ ...validPost, content: `${validPost.content}<p>### Título</p>` }),
    /markdown/i
  );
  assert.throws(
    () => assertEditorialPostCanBeApproved({ ...validPost, origin: 'ai-assisted' }),
    /fuentes/i
  );
  assert.doesNotThrow(() =>
    assertEditorialPostCanBeApproved({
      ...validPost,
      origin: 'ai-assisted',
      content: `${validPost.content}<p><a href="https://help.netflix.com/es-es">Netflix</a></p>`,
    })
  );
  assert.doesNotThrow(() => assertEditorialPostCanBeApproved({ ...validPost, origin: 'human' }));
});

test('reviewer must be a person: machine identities and non-allowlisted names are refused', () => {
  assert.throws(() => assertReviewerIsAccountable('auctorio-quality-gate', ''), /accountable person/);
  assert.throws(() => assertReviewerIsAccountable('auctorio-quality-gate', 'auctorio-quality-gate'), /accountable person/);
  assert.doesNotThrow(() => assertReviewerIsAccountable('Ana Gates', ''));
  assert.throws(() => assertReviewerIsAccountable('Ana Gates', 'maria@guia.test'), /accountable person/);
  assert.doesNotThrow(() => assertReviewerIsAccountable('Maria@guia.test', 'maria@guia.test'));
  assert.throws(() => buildEditorialApproval(validPost, 'auctorio-quality-gate', new Date(), ''), /accountable person/);
});

// M11-A: these five redirecting targets were live in the 10 published guides on 2026-10-26.
test('internal links are rewritten to the destination the site redirects to', () => {
  const html =
    '<a href="/editorial/precios-plataformas-streaming-espana">a</a>' +
    '<a href="https://guiaprogramaciontv.com/editorial/donde-ver-laliga-2026-27-espana#x">b</a>' +
    "<a href='/deportes/futbol/en-directo'>c</a>" +
    '<a href="/programacion-tv/guia-canales">d</a>' +
    '<a href="/blog/top10">e</a><a href="/editorial/categoria/series">f</a>' +
    '<a href="/programacion-tv/guia-canales-extra">g</a><a href="https://otra.web/editorial/x">h</a>';
  assert.equal(
    canonicalizeInternalLinks(html),
    '<a href="/guias/precios-plataformas-streaming-espana">a</a>' +
      '<a href="/guias/donde-ver-laliga-2026-27-espana#x">b</a>' +
      "<a href='/deportes/futbol/partidos-hoy?filter=live'>c</a>" +
      '<a href="/programacion-tv/en-directo">d</a>' +
      '<a href="/guias/rankings">e</a><a href="/guias/categoria/series">f</a>' +
      '<a href="/programacion-tv/guia-canales-extra">g</a><a href="https://otra.web/editorial/x">h</a>'
  );
  assert.equal(canonicalInternalPath('/guias/x'), '/guias/x');
  // Second-hop redirects of the SSR server resolve in one step.
  assert.equal(canonicalInternalPath('/editorial/categoria/rankings'), '/guias/rankings');
  assert.equal(canonicalInternalPath('/guias/categoria/rankings?p=2'), '/guias/rankings?p=2');
  assert.equal(canonicalInternalPath('/deportes/futbol/noticias/derbi'), '/guias/derbi');
  assert.equal(canonicalInternalPath('/deportes/futbol/en-directo?x=1#top'), '/deportes/futbol/partidos-hoy?filter=live#top');
  // Paths the routes do not match in full are left alone.
  assert.equal(canonicalInternalPath('/editorial/a/b'), '/editorial/a/b');
  const untouched = '<a data-href="/blog/x" href="//cdn.example/editorial/x">x</a>';
  assert.equal(canonicalizeInternalLinks(untouched), untouched);
});

test('the rewrite table matches the redirects the frontend actually serves', () => {
  // dist/application/services -> apps/frontend
  const frontend = resolve(__dirname, '../../../../frontend');
  const routes = ['src/app/app.routes.ts', 'src/app/blog/blog.routes.ts', 'src/app/features/football/football.routes.ts', 'scripts/ssr-server.mjs']
    .map((file) => readFileSync(resolve(frontend, file), 'utf8'))
    .join('\n');
  for (const rule of [
    "path: 'programacion-tv/guia-canales', redirectTo: 'programacion-tv/en-directo'",
    "path: 'editorial/:slug', redirectTo: 'guias/:slug'",
    "path: 'blog/:slug', redirectTo: 'guias/:slug'",
    "path: 'blog/top10', redirectTo: 'guias/rankings'",
    "path: 'categoria/rankings', redirectTo: '/guias/rankings'",
    "path: 'en-directo', redirectTo: () => '/deportes/futbol/partidos-hoy?filter=live'",
    "app.get('/deportes/futbol/noticias/:slug', (req, res) => movedTo(req, res, guidePath(req.params.slug)))",
    "app.get(['/editorial/rankings', '/blog/top10'], (req, res) => movedTo(req, res, '/guias/rankings'))",
  ]) assert.ok(routes.includes(rule), rule);
});

const others = [{ slug: 'precios', content: '<p>texto distinto sobre precios de plataformas en españa hoy</p>' }];
const codes = (findings: EditorialFinding[], severity: string) =>
  findings.filter((f) => f.severity === severity).map((f) => f.code).sort();

test('quality findings: definite defects block', () => {
  const bad = {
    ...validPost,
    slug: 'nueva',
    title: 'Sin título',
    faqItems: [{ question: '¿Precio?', answer: '' }],
    content: `${validPost.content}<a href="/editorial/no-existe">x</a><a href="/guias/precios">ok</a><a href="/guias/nueva">self</a>`,
  };
  assert.deepEqual(codes(evaluateEditorialQuality(bad, { others }), 'block'), ['broken-internal-link', 'invalid-faq', 'placeholder-title']);
  // Two new guides that link each other: a judgement (publish both), not a dead end.
  const linked = evaluateEditorialQuality(bad, { others, unpublishedSlugs: ['no-existe'] });
  assert.deepEqual(codes(linked, 'block'), ['invalid-faq', 'placeholder-title']);
  assert.ok(codes(linked, 'human').includes('links-unpublished-guide'));
  const copy = evaluateEditorialQuality({ ...validPost, slug: 'b' }, { others: [{ slug: 'a', content: validPost.content }] });
  assert.deepEqual(codes(copy, 'block'), ['near-identical']);
});

test('quality findings: judgement calls need an explicit acknowledgement, warnings never block', () => {
  const tokens = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
  const half = tokens('compartida', 200); // similarity ≈ 0.57: near-duplicate, not near-identical
  const post = {
    ...validPost,
    slug: 'b',
    origin: 'ai-assisted',
    title: 'Mejores series (octubre 2026)',
    content: `<p>${half} ${tokens('propia', 150)}</p>`,
    seo: { metaTitle: 'Mejores series', metaDescription: 'Las mejores series de la plataforma…' },
  };
  const findings = evaluateEditorialQuality(post, { others: [{ slug: 'a', content: `<p>${half}</p>` }] });
  assert.deepEqual(codes(findings, 'block'), []);
  assert.deepEqual(codes(findings, 'human'), ['near-duplicate', 'unverified-claims']);
  assert.deepEqual(codes(findings, 'warn'), ['no-internal-links', 'time-bound-title', 'truncated-metadata']);
  assert.deepEqual(editorialGateFailures(findings, ['unverified-claims']).map((f) => f.code), ['near-duplicate']);
  assert.deepEqual(editorialGateFailures(findings, ['unverified-claims', 'near-duplicate']), []);
});
