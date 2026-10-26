export type EditorialOrigin = 'human' | 'ai-assisted' | 'automated-import' | 'legacy';
export type EditorialReviewState = 'unreviewed' | 'in-review' | 'approved' | 'rejected';

export const PUBLIC_EDITORIAL_FILTER = Object.freeze({
  status: 'publish' as const,
  reviewState: 'approved' as const,
});

interface ApprovableEditorialPost {
  title?: string;
  excerpt?: string;
  content?: string;
  origin?: string;
  author?: { name?: string; id?: string };
  seo?: { metaTitle?: string; metaDescription?: string };
  categories?: Array<{ name?: string; slug?: string }>;
  publishedAt?: Date;
}

function visibleWordCount(html: string | undefined): number {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function visibleText(html: string | undefined): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Phase 5 content-quality gate: Editorial exists for cine/series/TV/streaming,
// not general news. This is a defense-in-depth allowlist check at the
// publish boundary — the actual topic selection happens upstream in the
// content-ai-platform ingestion pipeline (see docs/content-source.md) which
// is out of this repo's scope, but nothing should reach the public Editorial
// feed without at least one entertainment-domain signal, regardless of what
// produced or approved it upstream.
const ENTERTAINMENT_SIGNAL_KEYWORDS = [
  'cine', 'pelicula', 'película', 'film', 'largometraje', 'documental',
  'serie', 'series', 'temporada', 'episodio', 'capitulo', 'capítulo',
  'estreno', 'preestreno', 'taquilla', 'rodaje', 'guion', 'guión',
  'streaming', 'plataforma', 'netflix', 'hbo', 'max', 'disney', 'prime video',
  'movistar plus', 'skyshowtime', 'filmin', 'apple tv', 'atresplayer', 'rtve play',
  'television', 'televisión', 'parrilla', 'audiencia', 'programacion', 'programación',
  'canal', 'cadena', 'actor', 'actriz', 'director', 'directora', 'reparto',
  'trailer', 'tráiler', 'oscar', 'goya', 'emmy', 'festival de cine', 'critica', 'crítica',
];

function hasEntertainmentSignal(post: ApprovableEditorialPost): boolean {
  const categoryHaystack = (post.categories || [])
    .map((category) => `${category?.name || ''} ${category?.slug || ''}`)
    .join(' ')
    .toLowerCase();
  if (ENTERTAINMENT_SIGNAL_KEYWORDS.some((keyword) => categoryHaystack.includes(keyword))) {
    return true;
  }

  const contentHaystack = `${post.title || ''} ${post.excerpt || ''} ${visibleText(post.content).slice(0, 4000)}`.toLowerCase();
  return ENTERTAINMENT_SIGNAL_KEYWORDS.some((keyword) => contentHaystack.includes(keyword));
}

const hasExternalSource = (html: string | undefined): boolean =>
  /href=["']https?:\/\/(?!(?:www\.)?guiaprogramaciontv\.com)/i.test(String(html || ''));

// Markdown that reached the HTML body renders as literal `**` / `###` characters.
const hasRawMarkdown = (html: string | undefined): boolean =>
  /\*\*[^*<>\n]+\*\*|<p>\s*#{1,6}\s/.test(String(html || ''));

export function assertEditorialPostCanBeApproved(post: ApprovableEditorialPost): void {
  const failures: string[] = [];
  if (!String(post.title || '').trim()) failures.push('title');
  if (!String(post.excerpt || '').trim()) failures.push('excerpt');
  if (visibleWordCount(post.content) < 250) failures.push('contenido (mínimo 250 palabras útiles)');
  if (!String(post.author?.name || '').trim() || !String(post.author?.id || '').trim()) {
    failures.push('author');
  }
  if (!String(post.seo?.metaTitle || '').trim()) failures.push('seo.metaTitle');
  if (!String(post.seo?.metaDescription || '').trim()) failures.push('seo.metaDescription');
  if (hasRawMarkdown(post.content)) failures.push('markdown sin convertir en el contenido');
  // Human-written pieces may rely on first-hand knowledge; machine-assisted ones must show where facts come from.
  if (post.origin && post.origin !== 'human' && !hasExternalSource(post.content)) {
    failures.push('fuentes (al menos un enlace externo para contenido no humano)');
  }
  if (!hasEntertainmentSignal(post)) {
    failures.push('relevancia editorial (sin señales de cine, series, TV o streaming)');
  }

  if (failures.length) {
    throw new Error(`Editorial approval rejected: ${failures.join(', ')}`);
  }
}

// Paths the site answers with a 301 (apps/frontend app.routes.ts, blog.routes.ts, football.routes.ts and
// scripts/ssr-server.mjs). Order matters: specific rules first. Retired slugs in ssr-server's EDITORIAL_REDIRECTS
// are not mirrored: a link to one is not a public guide, so the approval gate refuses it.
const LEGACY_INTERNAL_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/(?:(?:editorial|blog|guias)\/categoria\/rankings|editorial\/rankings|blog\/top10)(?=$|[?#])/, '/guias/rankings'],
  [/^\/(?:editorial|blog)\/categoria\/([^/?#]+)(?=$|[?#])/, '/guias/categoria/$1'],
  [/^\/(?:editorial|blog|deportes\/futbol\/noticias)\/([^/?#]+)(?=$|[?#])/, '/guias/$1'],
  [/^\/(?:editorial|blog)(?=$|[?#])/, '/guias'],
  [/^\/programacion-tv\/guia-canales(?=$|[?#])/, '/programacion-tv/en-directo'],
  // The target carries its own query, so the legacy one is dropped rather than appended.
  [/^\/deportes\/futbol\/en-directo(?:\?[^#]*)?(?=$|#)/, '/deportes/futbol/partidos-hoy?filter=live'],
];

export function canonicalInternalPath(path: string): string {
  for (const [pattern, target] of LEGACY_INTERNAL_PATHS) {
    if (pattern.test(path)) return path.replace(pattern, target);
  }
  return path;
}

const INTERNAL_HREF = /(?<![\w-])href=(["'])(?:https?:\/\/(?:www\.)?guiaprogramaciontv\.com)?(\/(?!\/)[^"']*)\1/gi;

// Same destination, one hop fewer: links stored before a route moved keep working without a crawl-visible redirect.
export function canonicalizeInternalLinks(html: string): string {
  return html.replace(INTERNAL_HREF, (match, quote: string, path: string) => {
    const canonical = canonicalInternalPath(path);
    return canonical === path ? match : `href=${quote}${canonical}${quote}`;
  });
}

const internalPaths = (html: string): string[] =>
  [...String(html || '').matchAll(INTERNAL_HREF)].map((m) => m[2]);

export type EditorialFindingSeverity = 'block' | 'warn' | 'human';
export interface EditorialFinding {
  code: string;
  severity: EditorialFindingSeverity;
  message: string;
}

interface EditorialQualityPost extends ApprovableEditorialPost {
  slug?: string;
  faqItems?: Array<{ question?: string; answer?: string }>;
}

export interface EditorialQualityContext {
  /** Other publicly approved posts: link targets and duplicate comparison. */
  others: Array<{ slug: string; content?: string }>;
  /** Slugs that exist but are not public (drafts, in review): linkable once both are published. */
  unpublishedSlugs?: string[];
}

const PLACEHOLDER_TITLE =
  /^(?:sin t[ií]tulo|untitled|t[ií]tulo|title|nuevo (?:post|art[ií]culo)|new post|borrador|draft|test|prueba|todo|tbd)$|lorem ipsum|\{\{|\[(?:t[ií]tulo|title|todo)\]/i;
const MONTH_AND_YEAR = /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b.*\b20\d\d\b/i;
const NEAR_DUPLICATE = 0.35; // same 4-gram Jaccard flag as scripts/editorial-audit.mjs
const NEAR_IDENTICAL = 0.8;

function shingles(html: string | undefined, n = 4): Set<string> {
  const words = visibleText(html).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared || 1);
}

/**
 * Deterministic pre-publication findings. `block` = a definite defect; `warn` = an editorial-quality signal;
 * `human` = a judgement the named reviewer must acknowledge explicitly. None of this verifies facts.
 */
export function evaluateEditorialQuality(
  post: EditorialQualityPost,
  context: EditorialQualityContext
): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  const add = (severity: EditorialFindingSeverity, code: string, message: string) =>
    findings.push({ severity, code, message });
  const title = String(post.title || '').trim();
  const content = String(post.content || '');

  if (PLACEHOLDER_TITLE.test(title)) add('block', 'placeholder-title', `Título de relleno: «${title}»`);
  if ((post.faqItems || []).some((item) => !String(item?.question || '').trim() || !String(item?.answer || '').trim())) {
    add('block', 'invalid-faq', 'Pregunta frecuente sin pregunta o sin respuesta (FAQPage inválido)');
  }

  const publicSlugs = new Set(context.others.map((other) => other.slug));
  const unpublishedSlugs = new Set(context.unpublishedSlugs || []);
  for (const path of new Set(internalPaths(content))) {
    const guide = /^\/guias\/(?!categoria\/|rankings(?:$|[?#]))([^/?#]+)/.exec(canonicalInternalPath(path));
    if (!guide || guide[1] === post.slug || publicSlugs.has(guide[1])) continue;
    if (unpublishedSlugs.has(guide[1])) {
      add('human', 'links-unpublished-guide', `Enlaza a ${path}, que aún no es pública: publicarla también o el enlace dará 404`);
    } else {
      add('block', 'broken-internal-link', `Enlace a una guía inexistente o retirada: ${path}`);
    }
  }

  const own = shingles(content);
  for (const other of context.others) {
    if (other.slug === post.slug) continue;
    const similarity = jaccard(own, shingles(other.content));
    if (similarity >= NEAR_IDENTICAL) {
      add('block', 'near-identical', `Contenido casi idéntico a /guias/${other.slug} (${similarity.toFixed(2)})`);
    } else if (similarity >= NEAR_DUPLICATE) {
      add('human', 'near-duplicate', `Estructura muy parecida a /guias/${other.slug} (${similarity.toFixed(2)}): consolidar o justificar`);
    }
  }

  if (post.origin && post.origin !== 'human') {
    add('human', 'unverified-claims', 'Contenido asistido: cada precio, fecha, canal y disponibilidad debe comprobarse contra la fuente citada');
  }

  const meta = `${post.seo?.metaTitle || ''}\n${post.seo?.metaDescription || ''}`;
  if (/(?:…|\.\.\.)$/m.test(meta)) add('warn', 'truncated-metadata', 'Metadatos SEO truncados automáticamente');
  if (post.seo?.metaDescription && post.seo.metaDescription.trim() === title) {
    add('warn', 'metadata-repeats-title', 'La meta descripción repite el título');
  }
  if (MONTH_AND_YEAR.test(title)) add('warn', 'time-bound-title', 'El título lleva mes y año: programar revisión');
  if (internalPaths(content).length === 0) add('warn', 'no-internal-links', 'Sin enlaces internos');

  return findings;
}

/** What still prevents approval: every `block`, and every `human` finding the reviewer has not acknowledged. */
export function editorialGateFailures(findings: EditorialFinding[], acknowledged: Iterable<string>): EditorialFinding[] {
  const ack = new Set(acknowledged);
  return findings.filter((f) => f.severity === 'block' || (f.severity === 'human' && !ack.has(f.code)));
}

// A bot identity in `reviewedBy` is not editorial review. EDITORIAL_HUMAN_REVIEWERS (comma-separated)
// pins approvals to named people; without it only the known machine identities are refused.
const MACHINE_REVIEWER = /auctorio|quality-gate/i;

export function assertReviewerIsAccountable(
  reviewer: string,
  humanReviewers: string | undefined = process.env.EDITORIAL_HUMAN_REVIEWERS
): void {
  const allowed = String(humanReviewers || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const name = reviewer.trim().toLowerCase();
  if (MACHINE_REVIEWER.test(name) || (allowed.length > 0 && !allowed.includes(name))) {
    throw new Error('Editorial reviewer must be an accountable person, not an automation identity');
  }
}

export function buildEditorialApproval(
  post: ApprovableEditorialPost,
  reviewer: string,
  now = new Date(),
  humanReviewers?: string
): {
  status: 'publish';
  reviewState: 'approved';
  reviewedBy: string;
  reviewedAt: Date;
  publishedAt: Date;
} {
  const normalizedReviewer = String(reviewer || '').trim();
  if (!normalizedReviewer) throw new Error('Editorial reviewer is required');
  assertReviewerIsAccountable(normalizedReviewer, humanReviewers);
  assertEditorialPostCanBeApproved(post);
  return {
    status: 'publish',
    reviewState: 'approved',
    reviewedBy: normalizedReviewer,
    reviewedAt: now,
    publishedAt: post.publishedAt || now,
  };
}
