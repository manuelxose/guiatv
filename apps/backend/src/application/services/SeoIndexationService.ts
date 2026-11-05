// Centro de control SEO (M14-F): núcleo determinista (cuadrícula, detección, corrección)
// e inspección por lotes. Verdad editorial: una página está «indexada» solo cuando el
// veredicto de inspección de Google lo dice; enviar un sitemap nunca es indexación y la
// Indexing API restringida no se usa para contenido editorial.
import { existsSync } from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { classifyInspection, guideUrl, gscSiteUrl, type GscIndexClass } from './SearchConsoleMonitor';
import { ValidationError } from '../../shared/errors';

export type SeoContentType = 'guide' | 'ranking' | 'analysis' | 'trend' | 'news' | 'preview' | 'match-report';
export type SeoSeverity = 'high' | 'medium' | 'low';
export type SeoIssueState = 'open' | 'applied' | 'dismissed';
export type SeoAutomationKind = 'clear-unexpected-noindex' | 'set-self-canonical' | 'add-to-sitemap';
export type SeoIndexationState = GscIndexClass | 'unobserved';

export interface SeoUrlView {
  url: string; slug: string | null; contentType: SeoContentType; publishedAt: string | null;
  intendedIndexable: boolean; state: SeoIndexationState; lastInspectedAt: string | null;
  inSitemap: boolean; declaredCanonical: string | null; googleCanonical: string | null;
  robotsDirective: string | null; issueCodes: string[]; actions: string[]; nextInspectionAt: string | null;
}

export interface SeoIssueView {
  id: string; code: string; severity: SeoSeverity; evidence: string; urls: string[]; detectedAt: string;
  proposedAction: string; automationEligible: boolean; automationKind?: SeoAutomationKind;
  state: SeoIssueState; appliedAt: string | null; dismissedAt: string | null;
  recheck: { scheduledAt: string; result: 'pending' | 'resolved' | 'unresolved'; checkedAt: string | null } | null;
}

export interface SeoPostSeed {
  slug: string; title: string; content: string; excerpt: string; contentType: string;
  publishedAt: Date | null; metaTitle: string | null; metaDescription: string | null;
  canonicalUrl: string | null; faqItems: Array<{ question?: string; answer?: string }>;
  claims: Array<{ status?: string }>;
}

export interface SeoInspectionSeed {
  url: string; verdict?: string | null; coverageState?: string | null; indexingState?: string | null;
  robotsTxtState?: string | null; pageFetchState?: string | null; googleCanonical?: string | null;
  userCanonical?: string | null; sitemap?: string[] | null; inspectedAt?: Date | null;
}

export interface SeoIssueSeed {
  code: string; severity: SeoSeverity; evidence: string; urls: string[]; proposedAction: string;
  automationEligible: boolean; automationKind?: SeoAutomationKind;
}

export interface SeoFixResult { applicable: boolean; refusedReason?: string; updates: Array<{ url: string; field: string; value: unknown }>; }

export interface SeoIndexationQuery {
  q?: string; state?: SeoIndexationState; indexable?: boolean; hasIssues?: boolean;
  sort: 'url' | 'publishedAt' | 'state' | 'lastInspectedAt'; dir: 1 | -1; page: number; pageSize: number;
}

const db = () => BlogPostModel.db;
const seoUrls = () => db().collection('seo_urls');

const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GSC_API = 'https://searchconsole.googleapis.com';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOW_VALUE_WORDS = 250;
const DUPLICATE_JACCARD = 0.8;
const URL_RE = /^https:\/\/guiaprogramaciontv\.com\/guias\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ISSUE_DEFS: Record<string, { severity: SeoSeverity; proposedAction: string; automationKind?: SeoAutomationKind }> = {
  'unexpected-noindex': { severity: 'high', proposedAction: 'Retirar el noindex solo si la página debe indexarse; jamás retirar un noindex justificado', automationKind: 'clear-unexpected-noindex' },
  'canonical-mismatch': { severity: 'medium', proposedAction: 'Alinear el canonical declarado con el self-canonical de la URL', automationKind: 'set-self-canonical' },
  'incorrect-redirect': { severity: 'high', proposedAction: 'Corregir la redirección que Google observa' },
  'missing-sitemap': { severity: 'medium', proposedAction: 'Incluir la URL en el sitemap', automationKind: 'add-to-sitemap' },
  'broken-link': { severity: 'medium', proposedAction: 'Corregir o retirar el enlace interno roto' },
  'orphan-page': { severity: 'low', proposedAction: 'Enlazar la página desde una página indexable' },
  'invalid-ssr-metadata': { severity: 'medium', proposedAction: 'Completar título y descripción válidos' },
  'invalid-semantic-url': { severity: 'medium', proposedAction: 'Normalizar el slug a minúsculas y guiones' },
  'invalid-structured-data': { severity: 'medium', proposedAction: 'Corregir el dato estructurado (FAQPage)' },
  'duplicate-content': { severity: 'medium', proposedAction: 'Consolidar el contenido casi idéntico' },
  'unverified-program-entities': { severity: 'low', proposedAction: 'Verificar las entidades de programa no verificadas' },
  'low-value-content': { severity: 'low', proposedAction: 'Ampliar el contenido por debajo del mínimo editorial' },
};

const SEO_STATES: ReadonlySet<string> = new Set(['indexed', 'blocked', 'fetch-error', 'alternate-canonical', 'crawled-not-indexed', 'discovered-not-indexed', 'not-discovered', 'insufficient-evidence', 'unobserved']);
const SEO_SORT_FIELDS: readonly string[] = ['url', 'publishedAt', 'state', 'lastInspectedAt'];

const toAbsolute = (u: string): string => (u.startsWith('http') ? u : `https://guiaprogramaciontv.com${u.startsWith('/') ? '' : '/'}${u}`);
const normalizeUrl = (u: string): string => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '') || '/'}`; } catch { return u.trim(); } };
const wordCount = (html: string | undefined): number => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').trim().split(/\s+/).filter(Boolean).length;
const shingles = (html: string | undefined, n = 4): Set<string> => {
  const words = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>): number => { let s = 0; for (const x of a) if (b.has(x)) s++; return s / (a.size + b.size - s || 1); };
const internalGuideLinks = (html: string | undefined): string[] => {
  const out = new Set<string>();
  const re = /href=["'](?:https?:\/\/(?:www\.)?guiaprogramaciontv\.com)?\/guias\/([a-z0-9-]+)/gi;
  for (const m of String(html || '').matchAll(re)) { const slug = m[1]; if (slug && slug !== 'categoria' && slug !== 'rankings') out.add(slug); }
  return [...out];
};

export function seoStateOf(i: SeoInspectionSeed | null | undefined): SeoIndexationState {
  if (!i || !i.inspectedAt) return 'unobserved';
  return classifyInspection(i as Record<string, any>);
}

export function buildSeoGrid(posts: readonly SeoPostSeed[], inspections: ReadonlyMap<string, SeoInspectionSeed>, sitemapSlugs: ReadonlySet<string>): SeoUrlView[] {
  const rows: SeoUrlView[] = [];
  for (const p of posts) {
    if (!p.slug) continue;
    const url = guideUrl(p.slug);
    const insp = inspections.get(url);
    rows.push({
      url, slug: p.slug, contentType: (p.contentType || 'guide') as SeoContentType,
      publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
      intendedIndexable: true, state: seoStateOf(insp),
      lastInspectedAt: insp?.inspectedAt ? new Date(insp.inspectedAt).toISOString() : null,
      inSitemap: sitemapSlugs.has(p.slug),
      declaredCanonical: p.canonicalUrl ? toAbsolute(p.canonicalUrl) : url,
      googleCanonical: insp?.googleCanonical ?? null,
      robotsDirective: 'index, follow', issueCodes: [], actions: [], nextInspectionAt: null,
    });
  }
  return rows;
}

export function detectIssues(rows: readonly SeoUrlView[], posts: readonly SeoPostSeed[], inspections: ReadonlyMap<string, SeoInspectionSeed>): SeoIssueSeed[] {
  const issues: SeoIssueSeed[] = [];
  const postBySlug = new Map<string, SeoPostSeed>();
  for (const p of posts) if (p.slug) postBySlug.set(p.slug, p);
  const publicSlugs = new Set(postBySlug.keys());
  const incoming = new Set<string>();
  for (const p of posts) for (const slug of internalGuideLinks(p.content)) incoming.add(slug);
  const add = (code: string, urls: string[], evidence: string): void => {
    const def = ISSUE_DEFS[code];
    issues.push({ code, severity: def.severity, evidence, urls, proposedAction: def.proposedAction, automationEligible: Boolean(def.automationKind), ...(def.automationKind ? { automationKind: def.automationKind } : {}) });
  };

  for (const row of rows) {
    const post = row.slug ? postBySlug.get(row.slug) : undefined;
    const insp = inspections.get(row.url);
    if (!post) continue;

    if (!SLUG_RE.test(row.slug ?? '')) add('invalid-semantic-url', [row.url], `Slug no semántico: «${row.slug}»`);

    const metaTitle = (post.metaTitle ?? '').trim();
    const metaDescription = (post.metaDescription ?? '').trim();
    if (!metaTitle || !metaDescription) add('invalid-ssr-metadata', [row.url], `Metadatos SSR incompletos${!metaTitle ? ' (sin metaTitle)' : ''}${!metaDescription ? ' (sin metaDescription)' : ''}`);
    else if (/…|\.\.\.$/.test(`${metaTitle}\n${metaDescription}`)) add('invalid-ssr-metadata', [row.url], 'Metadatos SSR truncados');
    else if (metaDescription === (post.title ?? '').trim()) add('invalid-ssr-metadata', [row.url], 'La meta descripción repite el título');

    if ((post.faqItems ?? []).some((f) => !String(f?.question ?? '').trim() || !String(f?.answer ?? '').trim())) add('invalid-structured-data', [row.url], 'FAQPage con pregunta o respuesta vacía');

    const words = wordCount(post.content);
    if (words < LOW_VALUE_WORDS) add('low-value-content', [row.url], `${words} palabras visibles (mínimo ${LOW_VALUE_WORDS})`);

    const unverified = (post.claims ?? []).filter((c) => c?.status === 'unverified' || c?.status === 'conflicting').length;
    if (unverified > 0) add('unverified-program-entities', [row.url], `${unverified} afirmaciones/entidades sin verificar`);

    if (row.intendedIndexable && row.state === 'blocked') add('unexpected-noindex', [row.url], `Google observa ${insp?.indexingState ?? insp?.robotsTxtState ?? 'un bloqueo'} en una página indexable`);

    if (insp?.googleCanonical && row.declaredCanonical && normalizeUrl(insp.googleCanonical) !== normalizeUrl(row.declaredCanonical)) add('canonical-mismatch', [row.url], `Canonical declarado «${row.declaredCanonical}» vs Google «${insp.googleCanonical}»`);

    if (String(insp?.pageFetchState ?? '').includes('REDIRECT')) add('incorrect-redirect', [row.url], `Google observa ${insp?.pageFetchState}`);

    if (row.intendedIndexable && !row.inSitemap) add('missing-sitemap', [row.url], 'Indexable pero fuera del sitemap');

    for (const slug of internalGuideLinks(post.content)) if (!publicSlugs.has(slug)) add('broken-link', [row.url, guideUrl(slug)], `Enlace interno a guía inexistente: /guias/${slug}`);

    if (!row.inSitemap && !incoming.has(row.slug ?? '')) add('orphan-page', [row.url], 'Sin enlaces internos y fuera del sitemap');
  }

  const withContent = [...postBySlug.values()].filter((p) => wordCount(p.content) >= LOW_VALUE_WORDS);
  for (let a = 0; a < withContent.length; a++) for (let b = a + 1; b < withContent.length; b++) {
    const pa = withContent[a]; const pb = withContent[b];
    if (!pa.slug || !pb.slug) continue;
    const sim = jaccard(shingles(pa.content), shingles(pb.content));
    if (sim >= DUPLICATE_JACCARD) add('duplicate-content', [guideUrl(pa.slug), guideUrl(pb.slug)], `Contenido casi idéntico (${sim.toFixed(2)}) entre /guias/${pa.slug} y /guias/${pb.slug}`);
  }

  return issues;
}

export function safeSeoFix(code: string, rows: readonly SeoUrlView[]): SeoFixResult {
  switch (code) {
    case 'clear-unexpected-noindex':
      for (const r of rows) if (!r.intendedIndexable) return { applicable: false, refusedReason: `El noindex de ${r.url} está justificado: no se elimina`, updates: [] };
      return { applicable: true, updates: rows.filter((r) => (r.robotsDirective ?? '').includes('noindex')).map((r) => ({ url: r.url, field: 'robotsDirective', value: 'index, follow' })) };
    case 'set-self-canonical':
      return { applicable: true, updates: rows.filter((r) => r.declaredCanonical && r.declaredCanonical !== r.url).map((r) => ({ url: r.url, field: 'declaredCanonical', value: r.url })) };
    case 'add-to-sitemap':
      return { applicable: true, updates: rows.filter((r) => r.intendedIndexable && !r.inSitemap).map((r) => ({ url: r.url, field: 'inSitemap', value: true })) };
    default:
      return { applicable: false, refusedReason: 'Sin corrección automática segura: requiere acción editorial', updates: [] };
  }
}

export function parseSeoIndexationQuery(raw: Record<string, unknown>): SeoIndexationQuery {
  const q = String(raw.q ?? '').trim().slice(0, 120) || undefined;
  const stateRaw = String(raw.state ?? '').trim();
  const state = SEO_STATES.has(stateRaw) ? stateRaw as SeoIndexationState : undefined;
  const sortRaw = String(raw.sort ?? 'publishedAt').trim();
  const sort = SEO_SORT_FIELDS.includes(sortRaw) ? sortRaw as SeoIndexationQuery['sort'] : 'publishedAt';
  const dir = String(raw.dir ?? '').toLowerCase() === 'asc' ? 1 : -1;
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(raw.pageSize) || 25));
  const indexable = raw.indexable === 'true' || raw.indexable === '1' ? true : raw.indexable === 'false' || raw.indexable === '0' ? false : undefined;
  const hasIssues = raw.hasIssues === 'true' || raw.hasIssues === '1' ? true : raw.hasIssues === 'false' || raw.hasIssues === '0' ? false : undefined;
  return { q, state, indexable, hasIssues, sort, dir, page, pageSize };
}

// ---- inspección por lotes (URL Inspection API, solo lectura) ----
async function gscToken(): Promise<string> {
  const path = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!path) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');
  if (!existsSync(path)) throw new Error(`Credentials file not found: ${path}`);
  const client = await new GoogleAuth({ scopes: [READONLY_SCOPE] }).getClient();
  const token = await client.getAccessToken();
  const value = typeof token === 'string' ? token : token?.token;
  if (!value) throw new Error('No access token returned');
  return value;
}
const gscMessage = (text: string): string => { try { return String((JSON.parse(text)?.error?.message) ?? text).slice(0, 300); } catch { return text.slice(0, 300); } };

export interface BatchInspectOptions { siteUrl?: string; getToken?: () => Promise<string>; fetch?: typeof fetch; now?: Date; }
export interface BatchInspectResult { inspected: number; errors: number; results: Array<{ url: string; state: SeoIndexationState; error: string | null }>; }

export async function batchInspectUrls(urls: string[], options: BatchInspectOptions = {}): Promise<BatchInspectResult> {
  const now = options.now ?? new Date();
  const siteUrl = options.siteUrl ?? gscSiteUrl();
  const fetchImpl = options.fetch ?? fetch;
  const valid = [...new Set(urls)].filter((u) => URL_RE.test(u));
  if (!valid.length) throw new ValidationError('Ninguna URL válida para inspeccionar', []);
  const token = await (options.getToken ?? gscToken)();
  const results: BatchInspectResult['results'] = [];
  let inspected = 0; let errors = 0;
  for (const url of valid) {
    try {
      const res = await fetchImpl(`${GSC_API}/v1/urlInspection/index:inspect`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode: 'es' }) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${gscMessage(text)}`);
      const r = ((JSON.parse(text || '{}').inspectionResult ?? {}).indexStatusResult ?? {}) as Record<string, any>;
      const observed = { url, inspectedAt: now, verdict: r.verdict ?? null, coverageState: r.coverageState ?? null, indexingState: r.indexingState ?? null, robotsTxtState: r.robotsTxtState ?? null, pageFetchState: r.pageFetchState ?? null, lastCrawlTime: r.lastCrawlTime ?? null, googleCanonical: r.googleCanonical ?? null, userCanonical: r.userCanonical ?? null, sitemaps: r.sitemap ?? [], referringUrls: r.referringUrls ?? [], crawledAs: r.crawledAs ?? null, error: null };
      const state = classifyInspection(observed);
      await db().collection('editorial_gsc_inspections').updateOne({ url }, { $set: observed }, { upsert: true });
      await db().collection('editorial_gsc_inspection_history').insertOne({ ...observed, classification: state }).catch(() => undefined);
      await seoUrls().updateOne({ url }, { $set: { state, lastInspectedAt: now, googleCanonical: r.googleCanonical ?? null, updatedAt: now } });
      results.push({ url, state, error: null }); inspected++;
    } catch (error) {
      errors++; results.push({ url, state: 'unobserved', error: error instanceof Error ? error.message.slice(0, 200) : 'error' });
    }
  }
  return { inspected, errors, results };
}

export async function scheduleReinspections(urls: string[], at: Date): Promise<{ scheduled: number }> {
  const valid = [...new Set(urls)].filter((u) => URL_RE.test(u));
  if (!valid.length) throw new ValidationError('Ninguna URL válida para programar', []);
  await seoUrls().updateMany({ url: { $in: valid } }, { $set: { nextInspectionAt: at } });
  return { scheduled: valid.length };
}
