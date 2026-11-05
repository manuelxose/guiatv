// Tests del centro de control SEO (M14-F): núcleo determinista (cuadrícula, detección,
// corrección segura) y contrato HTTP. Sin Mongo: funciones puras y un smoke del router.
import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type ErrorRequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import {
  buildSeoGrid, detectIssues, parseSeoIndexationQuery, safeSeoFix, seoStateOf,
  type SeoInspectionSeed, type SeoPostSeed, type SeoUrlView,
} from './SeoIndexationService';
import { createAdminSeoRoutes } from '../../presentation/routes/admin-seo.routes';

const A = 'https://guiaprogramaciontv.com/guias/guia-a';

const post = (over: Partial<SeoPostSeed> = {}): SeoPostSeed => ({
  slug: 'guia-a', title: 'Guía A', content: '', excerpt: '', contentType: 'guide', publishedAt: null,
  metaTitle: 'Título A', metaDescription: 'Descripción A', canonicalUrl: null, faqItems: [], claims: [],
  ...over,
});

const words = (n: number): string => Array(n).fill('palabra').join(' ');

test('buildSeoGrid expone la URL pública semántica y nunca un identificador de base de datos', () => {
  const rows = buildSeoGrid([post({ slug: 'guia-a', contentType: 'ranking' })], new Map(), new Set(['guia-a']));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.url, A);
  assert.equal(row.contentType, 'ranking');
  assert.equal(row.inSitemap, true);
  assert.equal(row.declaredCanonical, A, 'canonical declarado por defecto es el self-canonical');
  assert.equal(row.state, 'unobserved');
  assert.equal(row.robotsDirective, 'index, follow');
  assert.ok(!('_id' in row), 'ningún id técnico de base de datos sale como URL');
  assert.deepEqual(row.issueCodes, []);
});

test('seoStateOf nunca convierte una respuesta vacía en un estado negativo', () => {
  assert.equal(seoStateOf(undefined), 'unobserved');
  assert.equal(seoStateOf(null), 'unobserved');
  assert.equal(seoStateOf({ url: A }), 'unobserved', 'sin inspectedAt no hay estado');
  assert.equal(seoStateOf({ url: A, inspectedAt: new Date(), verdict: 'PASS' }), 'indexed');
});

test('detectIssues detecta las clases exigidas con evidencia, severidad y elegibilidad', () => {
  const insp = new Map<string, SeoInspectionSeed>();
  insp.set(A, { url: A, verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG', inspectedAt: new Date() });
  const rows = buildSeoGrid([post({ slug: 'guia-a' })], insp, new Set(['guia-a']));
  const issues = detectIssues(rows, [post({ slug: 'guia-a' })], insp);
  const byCode = new Map(issues.map((i) => [i.code, i]));

  const noindex = byCode.get('unexpected-noindex');
  assert.ok(noindex, 'unexpected-noindex detectado');
  assert.equal(noindex!.severity, 'high');
  assert.equal(noindex!.automationEligible, true);
  assert.equal(noindex!.automationKind, 'clear-unexpected-noindex');
  assert.deepEqual(noindex!.urls, [A]);
  assert.match(noindex!.evidence, /BLOCKED_BY_META_TAG/);
});

test('detectIssues cubre canonical discordante, sitemap, redirección y metadatos', () => {
  const insp = new Map<string, SeoInspectionSeed>();
  insp.set(A, {
    url: A, verdict: 'NEUTRAL', inspectedAt: new Date(),
    googleCanonical: 'https://guiaprogramaciontv.com/guias/otra',
    pageFetchState: 'REDIRECT_ERROR',
  });
  const seed = post({ slug: 'guia-a', metaTitle: null, metaDescription: null });
  const rows = buildSeoGrid([seed], insp, new Set());
  const issues = detectIssues(rows, [seed], insp);
  const codes = new Set(issues.map((i) => i.code));
  assert.ok(codes.has('canonical-mismatch'));
  assert.ok(codes.has('incorrect-redirect'));
  assert.ok(codes.has('missing-sitemap'));
  assert.ok(codes.has('invalid-ssr-metadata'));
  const sitemap = issues.find((i) => i.code === 'missing-sitemap')!;
  assert.equal(sitemap.automationEligible, true);
  assert.equal(sitemap.automationKind, 'add-to-sitemap');
});

test('detectIssues cubre contenido: enlaces rotos, duplicados, huérfanas, bajo valor y entidades', () => {
  const content = (href: string, text: string) => `<p>${text}</p><a href="${href}">x</a>`;
  const shared = content('/guias/guia-a', words(300));
  const posts: SeoPostSeed[] = [
    post({ slug: 'guia-a', content: content('/guias/inexistente', words(300)), claims: [{ status: 'unverified' }] }),
    post({ slug: 'guia-b', content: shared, title: 'Guía B', metaDescription: 'Descripción B' }),
    post({ slug: 'guia-c', content: 'corto', metaTitle: 'Título C', metaDescription: 'Descripción C' }),
    post({ slug: 'guia-d', content: shared, title: 'Guía D', metaDescription: 'Descripción D', faqItems: [{ question: '', answer: 'r' }] }),
  ];
  const rows = buildSeoGrid(posts, new Map(), new Set(['guia-a', 'guia-b', 'guia-d']));
  const issues = detectIssues(rows, posts, new Map());
  const codes = new Set(issues.map((i) => i.code));
  assert.ok(codes.has('broken-link'), 'enlace roto');
  assert.ok(codes.has('duplicate-content'), 'contenido duplicado');
  assert.ok(codes.has('orphan-page'), 'página huérfana (fuera de sitemap y sin enlaces)');
  assert.ok(codes.has('low-value-content'), 'contenido de bajo valor');
  assert.ok(codes.has('unverified-program-entities'), 'entidades sin verificar');
  assert.ok(codes.has('invalid-structured-data'), 'FAQPage inválido');
  const dup = issues.find((i) => i.code === 'duplicate-content')!;
  assert.equal(dup.urls.length, 2);
});

test('detectIssues marca URL semántica inválida por slug', () => {
  const rows = buildSeoGrid([post({ slug: 'Guía-A' })], new Map(), new Set(['Guía-A']));
  const issues = detectIssues(rows, [post({ slug: 'Guía-A' })], new Map());
  assert.ok(issues.some((i) => i.code === 'invalid-semantic-url'));
});

test('safeSeoFix es determinista y jamás elimina un noindex justificado', () => {
  const indexable: SeoUrlView = { url: A, slug: 'guia-a', contentType: 'guide', publishedAt: null, intendedIndexable: true, state: 'blocked', lastInspectedAt: null, inSitemap: true, declaredCanonical: A, googleCanonical: null, robotsDirective: 'noindex, follow', issueCodes: [], actions: [], nextInspectionAt: null };
  const justified: SeoUrlView = { ...indexable, intendedIndexable: false, robotsDirective: 'noindex, follow' };

  const clear = safeSeoFix('clear-unexpected-noindex', [indexable]);
  assert.equal(clear.applicable, true);
  assert.deepEqual(clear.updates, [{ url: A, field: 'robotsDirective', value: 'index, follow' }]);

  const refused = safeSeoFix('clear-unexpected-noindex', [justified]);
  assert.equal(refused.applicable, false, 'un noindex justificado no se elimina');
  assert.match(refused.refusedReason!, /justificado/);

  const canonical = safeSeoFix('set-self-canonical', [{ ...indexable, declaredCanonical: 'https://otro.example/x' }]);
  assert.equal(canonical.applicable, true);
  assert.deepEqual(canonical.updates[0].value, A);

  const sitemap = safeSeoFix('add-to-sitemap', [{ ...indexable, inSitemap: false }]);
  assert.deepEqual(sitemap.updates, [{ url: A, field: 'inSitemap', value: true }]);

  const manual = safeSeoFix('broken-link', [indexable]);
  assert.equal(manual.applicable, false, 'sin corrección automática segura');
});

test('parseSeoIndexationQuery aplica filtros, orden y paginación en servidor', () => {
  assert.deepEqual(parseSeoIndexationQuery({}), { q: undefined, state: undefined, indexable: undefined, hasIssues: undefined, sort: 'publishedAt', dir: -1, page: 1, pageSize: 25 });
  assert.equal(parseSeoIndexationQuery({ page: '0', pageSize: '1000' }).pageSize, 100);
  assert.equal(parseSeoIndexationQuery({ indexable: 'true' }).indexable, true);
  assert.equal(parseSeoIndexationQuery({ hasIssues: '1' }).hasIssues, true);
  assert.equal(parseSeoIndexationQuery({ state: 'blocked', dir: 'asc', sort: 'url' }).dir, 1);
  assert.equal(parseSeoIndexationQuery({ state: 'desconocido' }).state, undefined);
});

test('admin-seo: el router exige rol de administrador y responde el sobre de error', async () => {
  const authService = { getSession: async () => ({ role: 'admin', id: 'u1', email: 'a@b.c' }) };
  const app = express();
  app.use(express.json());
  app.use('/v2/admin/seo', createAdminSeoRoutes(authService as never));
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(Number(err?.statusCode) || 400).json({ success: false, error: { code: err?.code ?? 'ERROR', message: err?.message ?? 'error' } });
  };
  app.use(onError);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const anon = await fetch(`${base}/v2/admin/seo/indexation/summary`);
    assert.equal(anon.status, 401, 'sin token se rechaza antes de llegar al handler');
    const bad = await fetch(`${base}/v2/admin/seo/indexation/inspect`, {
      method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    const body = await bad.json() as { success: boolean; error: { code: string } };
    assert.equal(bad.status, 400);
    assert.equal(body.success, false, 'sobre { success, ... } en el error');
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  } finally {
    server.close();
  }
});
