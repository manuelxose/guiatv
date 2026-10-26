import { createHash } from 'node:crypto';
import type { EditorialFinding, EditorialFindingSeverity } from './EditorialReviewPolicy';

/**
 * M11-B evidence contract for AI-written editorial content. Agents propose sources, quotes and claims;
 * everything here is deterministic and decides what may be stated. A model can make a claim stricter
 * (conflicting, rejected) but never turns an unverified claim into a supported one.
 */

export type EditorialPipelineState =
  | 'draft' | 'researched' | 'verified' | 'approved-by-policy' | 'published' | 'requires-update' | 'blocked';

/** How fast the underlying facts change; drives staleness at publication and the review schedule. */
export type EditorialVolatility = 'tv-schedule' | 'pricing' | 'availability' | 'sports-rights' | 'catalog-ranking' | 'stable';
export const REVIEW_CADENCE_DAYS: Readonly<Record<EditorialVolatility, number>> = Object.freeze({
  'tv-schedule': 1,
  pricing: 30,
  availability: 30,
  'catalog-ranking': 30,
  'sports-rights': 120,
  stable: 365,
});

/** official = the operator/rights holder itself; internal = GuíaTV's own public API; press = third-party reporting. */
export type EvidenceSourceKind = 'official' | 'dataset' | 'internal' | 'press';

export interface EvidenceSource {
  id: string;
  url: string;
  publisher: string;
  kind: EvidenceSourceKind;
  /** Set by the fetcher, never by a model. */
  retrievedAt?: string;
  contentHash?: string;
  httpStatus?: number;
}

export interface EvidenceQuote {
  sourceId: string;
  /** Verbatim text the source must contain (short: a sentence or a table cell run, not a copied article). */
  quote: string;
  verified?: boolean;
}

export type ClaimStatus = 'supported' | 'conflicting' | 'unverified';

export interface EvidenceClaim {
  id: string;
  text: string;
  volatility: EditorialVolatility;
  quotes: EvidenceQuote[];
  status?: ClaimStatus;
  /** Why it is not supported (filled by the deterministic verifier or a conflict review). */
  note?: string;
}

export interface EvidenceBundle {
  topic: string;
  intent: string;
  researchQuestions: string[];
  sources: EvidenceSource[];
  claims: EvidenceClaim[];
  /** Claim ids a reviewer found to disagree with each other; all of them end up `conflicting`. */
  conflicts: Array<{ claimIds: string[]; note: string }>;
  createdAt: string;
}

export interface CriticReview {
  model: string;
  verdict: 'pass' | 'revise' | 'block';
  issues: Array<{ claimId?: string; severity: 'high' | 'medium' | 'low'; message: string }>;
  bundleHash: string;
  draftHash: string;
  reviewedAt: string;
}

/** What the CMS stores next to an AI-written post (BlogPost.editorial). */
export interface EditorialProvenance {
  pipelineVersion: string;
  state: EditorialPipelineState;
  bundle: EvidenceBundle;
  bundleHash: string;
  /** The writer's markdown with [[claim]] markers; the published HTML is its rendering without them. */
  draftMarkdown: string;
  draftHash: string;
  critic?: CriticReview;
  cost?: CostSummary;
  lastVerifiedAt?: string;
  nextReviewAt?: string;
  changedEvidence?: string[];
  version?: number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v));
export const hashBundle = (bundle: EvidenceBundle) => sha256(canonicalJson(bundle));
export const hashText = (text: string) => sha256(text);

/** Whitespace-, case- and markup-insensitive form used for quote matching. */
export function normalizeForMatch(text: string): string {
  return String(text || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&euro;/gi, '€')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, '');
}

const MIN_QUOTE_CHARS = 12;
const numbersIn = (text: string) => String(text).normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) ?? [];
const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
/** Last two labels: press.example.com and example.com are one publisher, not two corroborations. */
const registrableDomain = (url: string) => hostOf(url).split('.').slice(-2).join('.');

// Rights holders and operators whose own pages state their prices, catalogue and broadcast rights.
const OFFICIAL_DOMAINS = [
  'netflix.com', 'hbomax.com', 'max.com', 'disneyplus.com', 'primevideo.com', 'amazon.es', 'movistarplus.es', 'movistar.es',
  'dazn.com', 'apple.com', 'filmin.es', 'skyshowtime.com', 'atresplayer.com', 'rtve.es', 'mitele.es', 'laliga.com', 'uefa.com',
  'rfef.es', 'boe.es', 'cnmc.es', 'fifa.com',
];
const DATASET_DOMAINS = ['themoviedb.org', 'justwatch.com', 'wikidata.org'];
const onDomain = (url: string, domains: string[]) => { const h = hostOf(url); return domains.some((d) => h === d || h.endsWith(`.${d}`)); };

/** Source trust is derived from the URL, never from what an agent labels it. */
export function sourceKindFor(url: string): EvidenceSourceKind {
  if (onDomain(url, ['guiaprogramaciontv.com'])) return 'internal';
  if (onDomain(url, OFFICIAL_DOMAINS)) return 'official';
  if (onDomain(url, DATASET_DOMAINS)) return 'dataset';
  return 'press';
}

/**
 * Deterministic verification against fetched source text (snapshots keyed by source id). A claim is
 * supported when a verified quote comes from an official/dataset/internal source, or from two press
 * sources on different domains; and every number the claim states appears in one of its verified quotes.
 * Agents reading the same original material are not independent: corroboration counts domains, not agents.
 */
export function verifyBundle(bundle: EvidenceBundle, snapshots: ReadonlyMap<string, string>): EvidenceBundle {
  const sources = new Map(bundle.sources.map((s) => [s.id, { ...s, kind: sourceKindFor(s.url) }]));
  const normalized = new Map([...snapshots].map(([id, text]) => [id, normalizeForMatch(text)]));
  const conflicting = new Set(bundle.conflicts.flatMap((c) => c.claimIds));

  const claims = bundle.claims.map((claim) => {
    const quotes = claim.quotes.map((q) => {
      const source = sources.get(q.sourceId);
      const text = normalized.get(q.sourceId);
      const needle = normalizeForMatch(q.quote);
      const verified = Boolean(source?.retrievedAt && source.contentHash && text && needle.length >= MIN_QUOTE_CHARS && text.includes(needle));
      return { ...q, verified };
    });
    const good = quotes.filter((q) => q.verified).map((q) => sources.get(q.sourceId)!);
    const primary = good.some((s) => s.kind !== 'press');
    const pressDomains = new Set(good.filter((s) => s.kind === 'press').map((s) => registrableDomain(s.url)));
    const quotedNumbers = new Set(quotes.filter((q) => q.verified).flatMap((q) => numbersIn(q.quote)));
    const missingNumbers = numbersIn(claim.text).filter((n) => !quotedNumbers.has(n));

    let status: ClaimStatus = 'supported';
    let note: string | undefined;
    if (conflicting.has(claim.id)) {
      status = 'conflicting';
      note = bundle.conflicts.find((c) => c.claimIds.includes(claim.id))?.note;
    } else if (!good.length) {
      status = 'unverified';
      note = 'ninguna cita aparece en su fuente recuperada';
    } else if (!primary && pressDomains.size < 2) {
      status = 'unverified';
      note = 'solo una fuente de prensa: hace falta la fuente oficial o un segundo medio independiente';
    } else if (missingNumbers.length) {
      status = 'unverified';
      note = `cifras sin respaldo en las citas: ${missingNumbers.join(', ')}`;
    }
    return { ...claim, quotes, status, note };
  });
  return { ...bundle, sources: [...sources.values()], claims };
}

const MARKER = /\[\[([a-z0-9_,\s-]+)\]\]/gi;
const markerIds = (text: string) => [...text.matchAll(MARKER)].flatMap((m) => m[1].split(',').map((id) => id.trim()).filter(Boolean));
export const stripClaimMarkers = (markdown: string) => markdown.replace(/[ \t]*\[\[[a-z0-9_,\s-]+\]\]/gi, '');

// A sentence that states a figure, date or time is a factual claim and must cite one.
const FACTUAL = /\d|€|\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i;
const FABRICATED_EXPERIENCE =
  /\b(?:(?:he|hemos)\s+(?:probado|testado|usado|comprobado\s+personalmente)|en\s+(?:mi|nuestra)\s+experiencia|nuestras?\s+pruebas?|personalmente|(?:entrevistamos|hemos\s+entrevistado|hablamos\s+con)\b|nos\s+(?:dijo|contó|confirmó))/i;
const PLACEHOLDER = /\b(?:TODO|TBD|XXX|lorem ipsum)\b|\[(?:cita|fuente|enlace|link|insertar|pendiente)[^\]]*\]|\{\{/i;
// The disclosure the publisher renders for AI-written posts (scripts/editorial-agents.mjs).
// AI-written posts are signed by the publication, which the Article schema renders as an Organization.
export const AI_AUTHOR = Object.freeze({ name: 'Redacción IA de Guía TV', id: 'guiatv-ai' });
const AI_BYLINE = /gu[ií]a\s*tv/i;
const AI_DISCLOSURE = /data-ai-disclosure|(?:inteligencia artificial|agentes? de IA|asistencia de IA)/i;

/** Lines of prose (and table rows) the reader will see, without headings. */
function factualUnits(markdown: string): string[] {
  return stripFences(markdown)
    .split('\n')
    .filter((line) => line.trim() && !/^\s*#/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line))
    .flatMap((line) => (/^\s*\|/.test(line) ? [line] : line.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/)));
}
const stripFences = (md: string) => md.replace(/^---[\s\S]*?---\s*/, '').replace(/```[\s\S]*?```/g, '');
/** What a reader sees of a markdown line: link and image targets are attributes, not text. */
const visibleMarkdown = (md: string) => stripClaimMarkers(md).replace(/\]\([^)]*\)/g, ']').replace(/<https?:[^>]+>/g, '');
const words = (text: string) => normalizeForMatch(text.replace(/[^\p{L}\p{N}]+/gu, ' ')).length;
const fingerprint = (text: string) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ')
  .toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

export interface ValueSignals {
  /** Claims backed by GuíaTV's own data (schedule, channel, catalogue): what a generic article cannot copy. */
  internalClaims: number;
  /** Distinct publishers whose verified claims are synthesized. */
  publishers: number;
  tables: number;
  claimsUsed: number;
}

export function measureValue(markdown: string, bundle: EvidenceBundle): ValueSignals {
  const used = new Set(markerIds(markdown));
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));
  const usedClaims = bundle.claims.filter((c) => used.has(c.id) && c.status === 'supported');
  const verifiedSources = usedClaims.flatMap((c) => c.quotes.filter((q) => q.verified).map((q) => sources.get(q.sourceId))).filter(Boolean) as EvidenceSource[];
  return {
    internalClaims: usedClaims.filter((c) => c.quotes.some((q) => q.verified && sources.get(q.sourceId)?.kind === 'internal')).length,
    publishers: new Set(verifiedSources.map((s) => s.publisher.toLowerCase())).size,
    tables: (stripFences(markdown).match(/^\s*\|\s*:?-{3,}/gm) ?? []).length,
    claimsUsed: usedClaims.length,
  };
}

/** Earliest date any stated claim must be re-checked: oldest verified retrieval + its volatility cadence. */
export function nextReviewAt(bundle: EvidenceBundle, markdown?: string): Date | undefined {
  const used = markdown ? new Set(markerIds(markdown)) : undefined;
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));
  let next: number | undefined;
  for (const claim of bundle.claims) {
    if (used && !used.has(claim.id)) continue;
    for (const q of claim.quotes.filter((x) => x.verified)) {
      const at = Date.parse(sources.get(q.sourceId)?.retrievedAt || '');
      if (Number.isNaN(at)) continue;
      const due = at + REVIEW_CADENCE_DAYS[claim.volatility] * 864e5;
      next = next === undefined ? due : Math.min(next, due);
    }
  }
  return next === undefined ? undefined : new Date(next);
}

/**
 * Maintenance: stated claims that were supported and no longer are after re-verification. Only these need a
 * targeted rewrite; an empty list means the article stands and only its verification date moves.
 */
export function changedClaims(before: EvidenceBundle, after: EvidenceBundle, draftMarkdown: string): string[] {
  const used = new Set(markerIds(draftMarkdown));
  const was = new Map(before.claims.map((c) => [c.id, c.status]));
  return after.claims.filter((c) => used.has(c.id) && was.get(c.id) === 'supported' && c.status !== 'supported').map((c) => c.id);
}

const normalizeUrl = (url: string) => {
  try { const u = new URL(url); u.hash = ''; return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`; } catch { return url; }
};

/**
 * Publication findings for a post that carries M11-B provenance, in the same severities as
 * evaluateEditorialQuality. Every check is deterministic; the critic can only add a block.
 */
export function evaluateEvidence(
  post: { content?: string; author?: { name?: string } },
  provenance: EditorialProvenance,
  now = new Date()
): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  const add = (severity: EditorialFindingSeverity, code: string, message: string) => findings.push({ severity, code, message });
  const { bundle, draftMarkdown } = provenance;
  const html = String(post.content || '');
  const claims = new Map(bundle.claims.map((c) => [c.id, c]));
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));

  if (hashBundle(bundle) !== provenance.bundleHash) add('block', 'evidence-tampered', 'El paquete de evidencias no coincide con su hash');
  if (hashText(draftMarkdown) !== provenance.draftHash) add('block', 'draft-tampered', 'El borrador no coincide con su hash');
  // The published HTML must be the reviewed draft: same visible words, in order (the disclosure is appended).
  if (!fingerprint(html).includes(fingerprint(visibleMarkdown(stripFences(draftMarkdown).replace(/^#\s.*$/m, ''))))) {
    add('block', 'content-not-reviewed-draft', 'El HTML publicado no es la versión del borrador que se verificó');
  }
  if (/\[\[[a-z0-9_,\s-]+\]\]/i.test(html)) add('block', 'claim-marker-leak', 'Quedan marcadores [[claim]] en el HTML');

  for (const source of bundle.sources) {
    if (!source.retrievedAt || !source.contentHash) add('block', 'source-not-retrieved', `Fuente sin recuperación registrada: ${source.url}`);
  }
  const unknown = [...new Set(markerIds(draftMarkdown))].filter((id) => !claims.has(id));
  if (unknown.length) add('block', 'unknown-claim', `Marcadores sin afirmación en el paquete: ${unknown.join(', ')}`);

  for (const unit of factualUnits(draftMarkdown)) {
    const ids = markerIds(unit);
    const visible = visibleMarkdown(unit).trim();
    if (!ids.length) {
      if (FACTUAL.test(visible)) add('block', 'uncited-factual-statement', `Dato sin afirmación verificada: «${visible.slice(0, 120)}»`);
      continue;
    }
    for (const id of ids) {
      const claim = claims.get(id);
      if (claim && claim.status !== 'supported') {
        add('block', 'unsupported-claim', `${id} (${claim.status ?? 'sin verificar'}): ${claim.note ?? claim.text}`);
      }
    }
  }

  const sourceUrls = new Set(bundle.sources.map((s) => normalizeUrl(s.url)));
  for (const [, href] of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    if (/guiaprogramaciontv\.com/i.test(href)) continue;
    if (!sourceUrls.has(normalizeUrl(href))) add('block', 'unsourced-link', `Enlace externo que no está en el paquete de evidencias: ${href}`);
  }

  const used = new Set(markerIds(draftMarkdown));
  for (const claim of bundle.claims) {
    if (!used.has(claim.id) || claim.status !== 'supported') continue;
    const retrieved = claim.quotes.filter((q) => q.verified).map((q) => Date.parse(sources.get(q.sourceId)?.retrievedAt || '')).filter((t) => !Number.isNaN(t));
    if (retrieved.length && now.getTime() - Math.max(...retrieved) > REVIEW_CADENCE_DAYS[claim.volatility] * 864e5) {
      add('block', 'stale-evidence', `${claim.id} (${claim.volatility}) se comprobó hace más de ${REVIEW_CADENCE_DAYS[claim.volatility]} días`);
    }
  }

  const prose = visibleMarkdown(draftMarkdown);
  const experience = FABRICATED_EXPERIENCE.exec(prose);
  if (experience) add('block', 'fabricated-experience', `Experiencia o fuente de primera mano no verificable: «${experience[0]}»`);
  const placeholder = PLACEHOLDER.exec(prose) ?? PLACEHOLDER.exec(html);
  if (placeholder) add('block', 'placeholder-text', `Texto de relleno: «${placeholder[0]}»`);
  if (!AI_DISCLOSURE.test(html)) add('block', 'missing-ai-disclosure', 'Falta la declaración de autoría por IA');
  if (!AI_BYLINE.test(String(post.author?.name || ''))) add('block', 'human-byline', `Firma que parece una persona en contenido de IA: «${post.author?.name ?? ''}»`);

  const value = measureValue(draftMarkdown, bundle);
  if (value.internalClaims === 0 && !(value.tables > 0 && value.publishers >= 2)) {
    add('block', 'no-distinct-value', 'Sin datos propios de GuíaTV ni una comparación de varias fuentes verificadas');
  }
  if (words(prose) < 1) add('block', 'empty-draft', 'Borrador vacío');

  const critic = provenance.critic;
  if (!critic) add('block', 'critic-missing', 'Falta la revisión independiente');
  else if (critic.bundleHash !== provenance.bundleHash || critic.draftHash !== provenance.draftHash) {
    add('block', 'critic-stale', 'La revisión independiente es de otra versión del borrador o de las evidencias');
  } else if (critic.verdict !== 'pass') {
    add('block', 'critic-rejected', `La revisión independiente pide ${critic.verdict}: ${critic.issues.map((i) => i.message).join(' | ').slice(0, 300)}`);
  }
  return findings;
}

// ---- cost control ---------------------------------------------------------------------------------

/** USD per million tokens (input, output). Anthropic first-party list prices, 2026-10. */
export const MODEL_PRICES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
});
/** Web search is billed per search on top of tokens. */
export const WEB_SEARCH_USD = 0.01;

export interface EditorialLimits {
  maxArticleUsd: number;
  maxResearchCalls: number;
  maxSourceFetches: number;
  maxRetries: number;
  maxReviewLoops: number;
  maxDailyArticles: number;
  maxConcurrentJobs: number;
}
export const DEFAULT_EDITORIAL_LIMITS: Readonly<EditorialLimits> = Object.freeze({
  maxArticleUsd: 3,
  maxResearchCalls: 2,
  maxSourceFetches: 12,
  maxRetries: 1,
  maxReviewLoops: 2,
  maxDailyArticles: 3,
  maxConcurrentJobs: 1,
});

export interface CostEntry { role: string; model: string; inputTokens: number; outputTokens: number; searches: number; usd: number }
export interface CostSummary { entries: CostEntry[]; usd: number; inputTokens: number; outputTokens: number; sourceFetches: number; draftAttempts: number; reviewFailures: number }

export class EditorialBudgetExceeded extends Error {}

/** Per-article ledger. `charge` records first, then throws once the article is over budget. */
export class CostLedger {
  readonly summary: CostSummary = { entries: [], usd: 0, inputTokens: 0, outputTokens: 0, sourceFetches: 0, draftAttempts: 0, reviewFailures: 0 };
  constructor(readonly limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS) {}

  charge(role: string, model: string, usage: { input_tokens: number; output_tokens: number }, searches = 0): CostEntry {
    const price = MODEL_PRICES[model];
    if (!price) throw new EditorialBudgetExceeded(`modelo sin precio conocido: ${model}`);
    const usd = (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1e6 + searches * WEB_SEARCH_USD;
    const entry = { role, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, searches, usd: +usd.toFixed(6) };
    const s = this.summary;
    s.entries.push(entry);
    s.usd = +(s.usd + usd).toFixed(6);
    s.inputTokens += usage.input_tokens;
    s.outputTokens += usage.output_tokens;
    if (s.usd > this.limits.maxArticleUsd) throw new EditorialBudgetExceeded(`coste ${s.usd.toFixed(2)} USD > límite ${this.limits.maxArticleUsd}`);
    return entry;
  }

  count(kind: 'sourceFetches' | 'draftAttempts' | 'reviewFailures', limit?: number): void {
    this.summary[kind]++;
    if (limit !== undefined && this.summary[kind] > limit) throw new EditorialBudgetExceeded(`${kind} > ${limit}`);
  }
}
