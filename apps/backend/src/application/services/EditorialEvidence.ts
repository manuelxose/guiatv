import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
  /** Legal references in the text that verifyBundle located around a verified quote (never set by a model). */
  legalRefs?: string[];
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
  /** M11-E2b: the verdict the rubric gives the issues (criticVerdict); this is what is signed and gated. */
  verdict: 'pass' | 'revise' | 'block';
  /** What the model itself answered, kept for the audit. */
  modelVerdict?: 'pass' | 'revise' | 'block';
  issues: Array<{ claimId?: string; severity: 'high' | 'medium' | 'low'; message: string }>;
  bundleHash: string;
  draftHash: string;
  reviewedAt: string;
}

/** What the CMS stores next to an AI-written post (BlogPost.editorial). */
export interface DistinctValue { readerBenefit: string; claimIds: string[] }
/** Pipeline versions written before M11-G carry no distinct-value statement; every later one must. */
const BEFORE_DISTINCT_VALUE = /^m(?:0\d|10|11[a-f])/i;

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
  /** Who answered the roles: 'anthropic' (live models) or 'replay' (recorded answers). */
  backend?: string;
  /** Generated images (docs/adr/0001 Decision 2); their hashes are part of the signed attestation. */
  images?: ImageAsset[];
  /** M11-E2b: hash of the excerpt, metaTitle and metaDescription the critic reviewed (metadataHash()); signed. */
  metadataHash?: string;
  /** M11-E2b: earlier candidates of this job a critic blocked for missing evidence; signed, so the block stays visible. */
  blockedCandidates?: Array<{ draftHash: string; bundleHash: string; verdict: string }>;
  /** M11-G: what the reader gets here and nowhere else, with the stated claims that prove it; signed, checked by the critic. */
  distinctValue?: DistinctValue;
  /** signProvenance() by the pipeline runner. */
  signature?: string;
}

/** The reviewed reader-facing fields outside the markdown, as the CMS stores them (trimmed). */
export const metadataHash = (m: { excerpt?: string; metaTitle?: string; metaDescription?: string }) =>
  hashText(JSON.stringify([m.excerpt, m.metaTitle, m.metaDescription].map((v) => String(v ?? '').trim())));

/** An AI-generated picture: provenance only, the bytes live in media storage under `url`. */
export interface ImageAsset {
  assetId: string;
  purpose: 'cover';
  /** Content-addressed public path (/storage/editorial/<sha256>-<width>.webp). */
  url: string;
  width: number;
  height: number;
  contentType: string;
  sha256: string;
  provider: string;
  model: string;
  prompt: string;
  /** Written from the article, never taken from the image model. */
  altText: string;
  rights: string;
  costUsd: number;
  createdAt: string;
}
export const AI_IMAGE_RIGHTS = 'ai-generated; owned by GuíaTV; no third-party marks, posters, stills or real people';

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

/**
 * The quote occurs in the text as a whole: a quote ending in "1" does not match "13,99", and one
 * starting with "3,99" does not match the tail of "13,99".
 */
function containsQuote(text: string, needle: string): boolean {
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? '';
    const after = text.slice(at + needle.length, at + needle.length + 2);
    if (/^\d/.test(needle) && /[\d.,]/.test(before)) continue;
    if (/\d$/.test(needle) && /^(?:\d|[.,]\d)/.test(after)) continue;
    return true;
  }
  return false;
}

// Rights holders and operators whose own pages state their prices, catalogue and broadcast rights.
export const OFFICIAL_DOMAINS = [
  'netflix.com', 'hbomax.com', 'max.com', 'disneyplus.com', 'primevideo.com', 'movistarplus.es', 'movistar.es',
  'dazn.com', 'apple.com', 'filmin.es', 'skyshowtime.com', 'atresplayer.com', 'rtve.es', 'mitele.es', 'laliga.com', 'uefa.com',
  'rfef.es', 'boe.es', 'cnmc.es', 'fifa.com',
];
const DATASET_DOMAINS = ['themoviedb.org', 'justwatch.com', 'wikidata.org'];
// User-generated areas of official domains are not the operator speaking.
const USER_CONTENT_HOST = /^(?:discussions|community|comunidad|foros?|forums?|answers|support-community)\./;
const onDomain = (url: string, domains: string[]) => { const h = hostOf(url); return domains.some((d) => h === d || h.endsWith(`.${d}`)); };

/** Source trust is derived from the URL, never from what an agent labels it. */
export function sourceKindFor(url: string): EvidenceSourceKind {
  if (onDomain(url, ['guiaprogramaciontv.com'])) return 'internal';
  if (USER_CONTENT_HOST.test(hostOf(url))) return 'press';
  if (onDomain(url, OFFICIAL_DOMAINS)) return 'official';
  // Amazon is official only for its own Prime Video / Prime pages, not marketplace listings.
  if (onDomain(url, ['amazon.es']) && /^\/(?:gp\/video|prime|amazonprime)/.test(new URL(url).pathname)) return 'official';
  if (onDomain(url, DATASET_DOMAINS)) return 'dataset';
  return 'press';
}

/**
 * M11-E2: a legal reference ("art. 98.1", "artículo 99", "Ley 13/2022") names a provision, it is not a figure.
 * Its numbers may be absent from the quote, but only when the verifier places the quote inside that provision.
 */
const LEGAL_REF = /\b(?:art(?:[íi]culo|s?\.)\s*(\d+)(?:\.(\d+))?\b|(?:Ley(?:\s+Org[áa]nica)?|Real\s+Decreto(?:-ley)?|Decreto(?:-ley)?|Directiva(?:\s+\(UE\))?|Reglamento(?:\s+\(UE\))?)\s+(\d+\/\d{4})\b)/gi;
interface LegalRef { key: string; numbers: string[]; article?: string; apartado?: string; id?: string }
export function legalRefsIn(text: string): LegalRef[] {
  return [...String(text).matchAll(LEGAL_REF)].map((m) => ({
    key: m[3] ? `${m[0].replace(/\s+\d.*$/, '').replace(/\s+/g, ' ').toLowerCase()} ${m[3]}` : `art. ${m[1]}${m[2] ? `.${m[2]}` : ''}`,
    numbers: numbersIn(m[0]), article: m[1], apartado: m[2], id: m[3],
  }));
}
// Spanish number words, as laws write figures ("ciento cuarenta y cuatro minutos"), by grammatical slot.
const UNIT_WORDS: Readonly<Record<string, number>> = Object.freeze({ dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 });
const SMALL_WORDS: Readonly<Record<string, number>> = Object.freeze({
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiún: 21, veintiuna: 21, veintidós: 22, veintidos: 22, veintitrés: 23, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiséis: 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
});
const TENS_WORDS: Readonly<Record<string, number>> = Object.freeze({ treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 });
const HUNDRED_WORDS: Readonly<Record<string, number>> = Object.freeze({
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800,
  ochocientas: 800, novecientos: 900, novecientas: 900,
});
// "un/uno/una" is 1 only inside a number ("treinta y un", "ciento un", "mil y una"); alone it is an article.
const ONE_WORDS = new Set(['un', 'uno', 'una']);
/**
 * M11-E2b: the numbers a text spells out ("setenta y dos" → "72", "dos mil veintidós" → "2022"). Used only on verified
 * quotes, so a claim may state in digits what its quote states in words. Strict grammar (independent review H-A): "y"
 * joins only tens + unit, punctuation ends a number, and two numbers side by side ("dos y tres", "tres, cuatro") stay two.
 */
export function spelledNumbers(text: string): string[] {
  const out: string[] = [];
  let total = 0;
  let current = 0;
  // S = no number open; H/T/U = last word was hundreds/tens/units; TY = tens + "y" (or "mil y"); M = after "mil".
  let state: 'S' | 'H' | 'T' | 'TY' | 'U' | 'M' = 'S';
  const close = () => { if (state !== 'S') out.push(String(total + current)); total = 0; current = 0; state = 'S'; };
  const tokens = String(text).toLowerCase().normalize('NFC').match(/[a-záéíóúüñ]+|\S/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const [word, next, previous] = [tokens[i], tokens[i + 1] ?? '', tokens[i - 1] ?? ''];
    const fresh = state === 'S' || state === 'M';
    const nextIsUnit = UNIT_WORDS[next] !== undefined || ONE_WORDS.has(next);
    if (word === 'ciento' && previous === 'por') { close(); continue; } // "por ciento" is a unit, not 100
    if (HUNDRED_WORDS[word] !== undefined && fresh) { current += HUNDRED_WORDS[word]; state = 'H'; continue; }
    if (TENS_WORDS[word] !== undefined && (fresh || state === 'H')) { current += TENS_WORDS[word]; state = 'T'; continue; }
    if (SMALL_WORDS[word] !== undefined && (fresh || state === 'H')) { current += SMALL_WORDS[word]; state = 'U'; continue; }
    if (UNIT_WORDS[word] !== undefined && (fresh || state === 'H' || state === 'TY')) { current += UNIT_WORDS[word]; state = 'U'; continue; }
    if (ONE_WORDS.has(word) && (state === 'H' || state === 'TY')) { current += 1; state = 'U'; continue; }
    if (word === 'y' && (state === 'T' || state === 'M') && nextIsUnit) { state = 'TY'; continue; }
    if (word === 'mil' && total === 0 && state !== 'TY') { total = (state === 'S' ? 1 : current) * 1000; current = 0; state = 'M'; continue; }
    const wasOpen = state !== 'S';
    close();
    // A number word that could not continue the previous number starts the next one.
    if (wasOpen && (HUNDRED_WORDS[word] ?? TENS_WORDS[word] ?? SMALL_WORDS[word] ?? UNIT_WORDS[word]) !== undefined || (wasOpen && word === 'mil')) i--;
  }
  close();
  return out;
}

/** `text` without the spans of the references in `located`: their numbers are references, any other copy is a figure. */
export function withoutLocatedRefs(text: string, located: Iterable<string>): string {
  const keys = new Set(located);
  return String(text).replace(LEGAL_REF, (span) => (keys.has(legalRefsIn(span)[0]?.key ?? '') ? ' ' : span));
}
/** The law a source page is: its first legal identifier (a BOE page opens with its own title). */
const ownLaw = (raw: string) => legalRefsIn(raw).find((r) => r.id)?.key;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Raw source text of a provision: from an "Artículo N." heading (capitalised: cross-references are lowercase) to the next
 * heading, and within it from apartado "K. " to "K+1. ". Every occurrence counts, because a BOE page lists its index first.
 */
function provisionTexts(raw: string, article: string, apartado?: string): string[] {
  const heading = /(?:^|\s)Art[íi]culo \d+\.\s/g;
  const out: string[] = [];
  for (const m of raw.matchAll(new RegExp(`(?:^|\\s)Art[íi]culo ${escapeRe(article)}\\.\\s`, 'g'))) {
    heading.lastIndex = m.index! + m[0].length;
    const end = heading.exec(raw)?.index ?? raw.length;
    const body = raw.slice(m.index!, end);
    if (!apartado) { out.push(body); continue; }
    const start = new RegExp(`\\s${apartado}\\.\\s+\\p{Lu}`, 'u').exec(body);
    if (!start) continue;
    const rest = body.slice(start.index + 1);
    const next = new RegExp(`\\s${Number(apartado) + 1}\\.\\s+\\p{Lu}`, 'u').exec(rest);
    out.push(rest.slice(0, next?.index ?? rest.length));
  }
  return out;
}

/**
 * Deterministic verification against fetched source text (snapshots keyed by source id). A claim is
 * supported when a verified quote comes from an official/dataset/internal source, or from two press
 * sources on different domains; and every number the claim states appears in one of its verified quotes.
 * Agents reading the same original material are not independent: corroboration counts domains, not agents.
 */
export function verifyBundle(bundle: EvidenceBundle, snapshots: ReadonlyMap<string, string>): EvidenceBundle {
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));
  const normalized = new Map([...snapshots].map(([id, text]) => [id, normalizeForMatch(text)]));
  return assessBundle({
    ...bundle,
    claims: bundle.claims.map((claim) => {
      const quotes = claim.quotes.map((q) => {
        const source = sources.get(q.sourceId);
        const text = normalized.get(q.sourceId);
        const needle = normalizeForMatch(q.quote);
        return { ...q, verified: Boolean(source?.retrievedAt && source.contentHash && text && needle.length >= MIN_QUOTE_CHARS && containsQuote(text, needle)) };
      });
      // A reference counts when one verified quote comes from that law's own page and, for an article, lies inside it.
      // An article in a claim that also names a law must be found in that law, not in any page that has an article N.
      const refs = legalRefsIn(claim.text);
      const law = refs.find((r) => r.id)?.key;
      const legalRefs = refs.filter((ref) => quotes.some((q) => {
        const raw = q.verified ? snapshots.get(q.sourceId) : undefined;
        if (!raw) return false;
        if (ref.id) return ownLaw(raw) === ref.key;
        // The verified quote itself names this article ("salvo lo previsto en el artículo 137"), and of the same law: the
        // one the quote names, else the page's own; the claim's law, else the page's own (independent review H-B).
        const inQuote = legalRefsIn(q.quote);
        if (inQuote.some((r) => r.key === ref.key) && (inQuote.find((r) => r.id)?.key ?? ownLaw(raw)) === (law ?? ownLaw(raw))) return true;
        if (law && ownLaw(raw) !== law) return false;
        return provisionTexts(raw, ref.article!, ref.apartado).some((p) => containsQuote(normalizeForMatch(p), normalizeForMatch(q.quote)));
      })).map((ref) => ref.key);
      return { ...claim, quotes, legalRefs };
    }),
  });
}

/**
 * Claim status from the quotes' verification flags alone: source kinds come from the URLs, and the
 * corroboration, figure and conflict rules are re-applied. Used again at approval, so a stored bundle
 * cannot simply declare its claims supported.
 */
export function assessBundle(bundle: EvidenceBundle): EvidenceBundle {
  const sources = new Map(bundle.sources.map((s) => [s.id, { ...s, kind: sourceKindFor(s.url) }]));
  const conflicting = new Set(bundle.conflicts.flatMap((c) => c.claimIds));

  const claims = bundle.claims.map((claim) => {
    const quotes = claim.quotes.map((q) => ({
      ...q,
      verified: Boolean(q.verified && sources.get(q.sourceId)?.retrievedAt && sources.get(q.sourceId)?.contentHash && normalizeForMatch(q.quote).length >= MIN_QUOTE_CHARS),
    }));
    const good = quotes.filter((q) => q.verified).map((q) => sources.get(q.sourceId)!);
    const primary = good.some((s) => s.kind !== 'press');
    const pressDomains = new Set(good.filter((s) => s.kind === 'press').map((s) => registrableDomain(s.url)));
    const quotedNumbers = new Set(quotes.filter((q) => q.verified).flatMap((q) => [...numbersIn(q.quote), ...spelledNumbers(q.quote)]));
    // A located reference's span is not a figure; the rest of the text is checked as before. Any unlocated reference fails,
    // even when the quote happens to contain its numbers: the attribution itself is the claim.
    const located = new Set(claim.legalRefs ?? []);
    const unlocated = legalRefsIn(claim.text).filter((r) => !located.has(r.key));
    const missingNumbers = numbersIn(withoutLocatedRefs(claim.text, located)).filter((n) => !quotedNumbers.has(n));

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
    } else if (unlocated.length) {
      status = 'unverified';
      note = `referencia legal no localizada junto a la cita: ${unlocated.map((r) => r.key).join(', ')}`;
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

// Figures written in words count as figures when they quantify something.
const NUMBER_WORDS = /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|cien|ciento|mil|mill[oó]n(?:es)?)\s+(?:de\s+)?(?:euros?|€|por\s+ciento|horas?|minutos?|d[ií]as|semanas|meses|años|temporadas|episodios|cap[ií]tulos|partidos|pantallas|dispositivos|suscriptores)\b/i;
// A sentence that states a figure, date or time is a factual claim and must cite one.
const FACTUAL = new RegExp(`\\d|€|\\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\\b|${NUMBER_WORDS.source}`, 'i');

/**
 * Figures a sentence citing these claims may state: the claims' own numbers, plus the Europe/Madrid
 * date and time of any UTC timestamp in their verified quotes (the only derivation allowed).
 */
function allowedNumbers(claims: EvidenceClaim[]): Set<string> {
  const out = new Set<string>();
  const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const claim of claims) {
    // A provision's numbers are not figures: they are allowed only as that reference (refNumbers).
    numbersIn(withoutLocatedRefs(claim.text, claim.legalRefs ?? [])).forEach((n) => out.add(n));
    for (const q of claim.quotes.filter((x) => x.verified)) {
      [...numbersIn(q.quote), ...spelledNumbers(q.quote)].forEach((n) => out.add(n));
      for (const [iso] of q.quote.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g)) {
        const parts = Object.fromEntries(madrid.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
        for (const v of [parts.year, parts.month, parts.day, parts.hour, parts.minute]) {
          if (v) { out.add(v); out.add(String(Number(v))); }
        }
      }
    }
  }
  return out;
}
/** Numbers of `text` once the spans of references located by `claims` are removed: a reference is not a figure, a copy of its number is. */
const figuresIn = (text: string, claims: EvidenceClaim[]) => numbersIn(withoutLocatedRefs(text, claims.flatMap((c) => c.legalRefs ?? [])));
const stripListNumber = (unit: string) => unit.replace(/^\s*\d{1,2}[.)]\s+/, '');
const FABRICATED_EXPERIENCE =
  /\b(?:(?:he|hemos)\s+(?:probado|testado|usado|comprobado\s+personalmente)|en\s+(?:mi|nuestra)\s+experiencia|nuestras?\s+pruebas?|personalmente|(?:entrevistamos|hemos\s+entrevistado|hablamos\s+con)\b|nos\s+(?:dijo|contó|confirmó))/i;
// Markers are uppercase on purpose: Spanish "todo" is an ordinary word.
const PLACEHOLDER = /\b(?:TODO|TBD|XXX|[Ll]orem ipsum)\b|\[(?:[Cc]ita|[Ff]uente|[Ee]nlace|[Ll]ink|[Ii]nsertar|[Pp]endiente)[^\]]*\]|\{\{/;
// AI-written posts are signed by the publication, which the Article schema renders as an Organization.
export const AI_AUTHOR = Object.freeze({ name: 'Redacción IA de Guía TV', id: 'guiatv-ai' });
const AI_BYLINE = /gu[ií]a\s*tv/i;

/** The only disclosure text an AI-written post carries; the gate recognises exactly this paragraph. */
export const aiDisclosure = (verifiedOn: Date) =>
  `<p data-ai-disclosure><em>Artículo investigado, redactado y revisado por agentes de inteligencia artificial de GuíaTV a partir de las fuentes enlazadas, comprobadas el ${verifiedOn.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })}. No contiene pruebas ni experiencias propias. Consulta nuestra <a href="/politica-editorial">política editorial</a>.</em></p>`;
const AI_DISCLOSURE = /<p data-ai-disclosure><em>Artículo investigado, redactado y revisado por agentes de inteligencia artificial de GuíaTV a partir de las fuentes enlazadas, comprobadas el \d{1,2} de [a-z]+ de \d{4}\. No contiene pruebas ni experiencias propias\. Consulta nuestra <a href="\/politica-editorial">política editorial<\/a>\.<\/em><\/p>/;

/** Lines of prose, headings below the title, list items and table rows the reader will see. */
function factualUnits(markdown: string): string[] {
  return stripFences(markdown)
    .split('\n')
    .filter((line) => line.trim() && !/^#\s/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line))
    .flatMap((line) => (/^\s*\|/.test(line) ? [line] : line.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/)))
    .map(stripListNumber);
}
const stripFences = (md: string) => md.replace(/^---[\s\S]*?---\s*/, '').replace(/```[\s\S]*?```/g, '');
/** What a reader sees of a markdown line: link and image targets are attributes, not text. */
const visibleMarkdown = (md: string) => stripClaimMarkers(md).replace(/\]\([^)]*\)/g, ']').replace(/<https?:[^>]+>/g, '');
const words = (text: string) => normalizeForMatch(text.replace(/[^\p{L}\p{N}]+/gu, ' ')).length;
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€' };
/** Visible words and numbers in order; "6,99" stays one token, so changing a figure changes the sequence. */
const visibleTokens = (text: string) => (String(text || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#?\w+);/g, (_m, e: string) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : ' '))
  .normalize('NFKC').toLowerCase()
  .match(/[\p{L}\p{N}]+(?:[.,:'’][\p{L}\p{N}]+)*/gu) ?? []).join(' ');

export interface ValueSignals {
  /** Claims backed by GuíaTV's own data (schedule, channel, catalogue): what a generic article cannot copy. */
  internalClaims: number;
  /** Distinct publishers whose verified claims are synthesized. */
  publishers: number;
  tables: number;
  claimsUsed: number;
}

/** M11-G: GuíaTV's channel line-up says which channels it covers: context and navigation, not value of its own. */
const LINEUP_FACTS = /\/v2\/editorial\/facts\?(?:[^#]*&)?kind=channels(?:&|#|$)/;
/** M11-G: a broadcast slot from GuíaTV's guide; it expires, so it can only be stated as tv-schedule evidence. */
const SCHEDULE_FACTS = /\/v2\/editorial\/facts\?(?:[^#]*&)?kind=schedule(?:&|#|$)/;
const valueBearingInternal = (s: EvidenceSource | undefined) => s?.kind === 'internal' && !LINEUP_FACTS.test(s.url);

export function measureValue(markdown: string, bundle: EvidenceBundle): ValueSignals {
  const used = new Set(markerIds(markdown));
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));
  const usedClaims = bundle.claims.filter((c) => used.has(c.id) && c.status === 'supported');
  const verifiedSources = usedClaims.flatMap((c) => c.quotes.filter((q) => q.verified).map((q) => sources.get(q.sourceId))).filter(Boolean) as EvidenceSource[];
  return {
    internalClaims: usedClaims.filter((c) => c.quotes.some((q) => q.verified && valueBearingInternal(sources.get(q.sourceId)))).length,
    // GuíaTV aggregates third-party guides: it is never a second publisher confirming another (M11-G).
    publishers: new Set(verifiedSources.filter((s) => s.kind !== 'internal').map((s) => s.publisher.toLowerCase())).size,
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
const SITE = 'https://guiaprogramaciontv.com/';
const isSiteHost = (host: string) => /^(?:www\.)?guiaprogramaciontv\.com$/i.test(host);
/** Every href/src value, quoted or not. */
const linkTargets = (html: string) =>
  [...html.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim());

/**
 * Pipeline attestation: HMAC over what the deterministic checks and the critic decided. Only the
 * pipeline runner holds the key; the API refuses policy approval of provenance it did not sign.
 */
const attestation = (p: EditorialProvenance) =>
  [p.pipelineVersion, p.backend ?? '', p.bundleHash, p.draftHash, p.critic?.verdict ?? '', p.critic?.bundleHash ?? '', p.critic?.draftHash ?? '',
    // Appended only when present, so provenance signed before images existed still verifies.
    ...(p.images?.length ? [p.images.map((i) => `${i.provider}:${i.sha256}:${i.url}`).join(',')] : []),
    ...(p.metadataHash ? [`meta:${p.metadataHash}`] : []),
    ...(p.blockedCandidates?.length ? [`blocked:${p.blockedCandidates.map((b) => `${b.draftHash}/${b.bundleHash}/${b.verdict}`).join(',')}`] : []),
    ...(p.distinctValue ? [`value:${hashText(JSON.stringify([p.distinctValue.readerBenefit, p.distinctValue.claimIds]))}`] : [])].join('|');
export const signProvenance = (p: EditorialProvenance, key: string) => createHmac('sha256', key).update(attestation(p)).digest('hex');
export function provenanceSignatureValid(p: EditorialProvenance, key: string | undefined): boolean {
  if (!key || !p.signature || !/^[0-9a-f]{64}$/.test(p.signature)) return false;
  return timingSafeEqual(Buffer.from(signProvenance(p, key), 'hex'), Buffer.from(p.signature, 'hex'));
}
/**
 * The critic verdict is only as trustworthy as its signature. Where the server holds the key, an unsigned or broken
 * signature blocks (otherwise a hand-written provenance could turn a critic 'block' into one acknowledgement);
 * without a key (development) nothing can be verified, so a person must say so.
 */
export function provenanceSignatureFindings(p: EditorialProvenance, key: string | undefined): EditorialFinding[] {
  if (!key) return [{ severity: 'human', code: 'provenance-unsigned', message: 'Sin clave de firma en el servidor: el veredicto del crítico no está atestiguado' }];
  if (!provenanceSignatureValid(p, key)) {
    return [{ severity: 'block', code: 'provenance-signature-invalid', message: 'Procedencia sin firma válida del pipeline: el veredicto o las evidencias no están atestiguados' }];
  }
  return [];
}

interface EvidencePost {
  content?: string;
  title?: string;
  excerpt?: string;
  author?: { name?: string };
  seo?: { metaTitle?: string; metaDescription?: string; ogImage?: string };
  faqItems?: Array<{ question?: string; answer?: string }>;
  featuredImage?: { sourceUrl?: string; alt?: string };
}

/**
 * Publication findings for a post that carries M11-B provenance, in the same severities as
 * evaluateEditorialQuality. Every check is deterministic; the critic can only add a block.
 */
export function evaluateEvidence(post: EvidencePost, provenance: EditorialProvenance, now = new Date()): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  const add = (severity: EditorialFindingSeverity, code: string, message: string) => findings.push({ severity, code, message });
  const { draftMarkdown } = provenance;
  // Statuses are re-derived, never taken from what the stored bundle declares.
  const bundle = assessBundle(provenance.bundle);
  const html = String(post.content || '');
  const claims = new Map(bundle.claims.map((c) => [c.id, c]));
  const sources = new Map(bundle.sources.map((s) => [s.id, s]));
  const used = new Set(markerIds(draftMarkdown));
  const usedSupported = bundle.claims.filter((c) => used.has(c.id) && c.status === 'supported');

  if (hashBundle(provenance.bundle) !== provenance.bundleHash) add('block', 'evidence-tampered', 'El paquete de evidencias no coincide con su hash');
  if (hashText(draftMarkdown) !== provenance.draftHash) add('block', 'draft-tampered', 'El borrador no coincide con su hash');
  // M11-E2b: the excerpt and metadata must be the ones the critic reviewed (signed), not a later rewrite.
  if (provenance.metadataHash && metadataHash({ excerpt: post.excerpt, metaTitle: post.seo?.metaTitle, metaDescription: post.seo?.metaDescription }) !== provenance.metadataHash) {
    add('block', 'metadata-not-reviewed', 'El resumen o los metadatos no son los que revisó el crítico');
  }
  // The published HTML is exactly the reviewed draft plus the standard disclosure: nothing added, no figure changed.
  const body = html.replace(AI_DISCLOSURE, ' ');
  if (visibleTokens(body) !== visibleTokens(visibleMarkdown(stripFences(draftMarkdown).replace(/^#\s.*$/m, '')))) {
    add('block', 'content-not-reviewed-draft', 'El HTML publicado no es la versión del borrador que se verificó');
  }
  if (/\[\[[a-z0-9_,\s-]+\]\]/i.test(html)) add('block', 'claim-marker-leak', 'Quedan marcadores [[claim]] en el HTML');

  for (const source of bundle.sources) {
    if (!source.retrievedAt || !source.contentHash) add('block', 'source-not-retrieved', `Fuente sin recuperación registrada: ${source.url}`);
  }
  const unknown = [...used].filter((id) => !claims.has(id));
  if (unknown.length) add('block', 'unknown-claim', `Marcadores sin afirmación en el paquete: ${unknown.join(', ')}`);

  for (const unit of factualUnits(draftMarkdown)) {
    const ids = markerIds(unit);
    const visible = visibleMarkdown(unit).trim();
    if (!ids.length) {
      if (FACTUAL.test(visible)) add('block', 'uncited-factual-statement', `Dato sin afirmación verificada: «${visible.slice(0, 120)}»`);
      continue;
    }
    const cited = ids.map((id) => claims.get(id)).filter(Boolean) as EvidenceClaim[];
    for (const claim of cited.filter((c) => c.status !== 'supported')) {
      add('block', 'unsupported-claim', `${claim.id} (${claim.status ?? 'sin verificar'}): ${claim.note ?? claim.text}`);
    }
    const supportedCited = cited.filter((c) => c.status === 'supported');
    const allowed = allowedNumbers(supportedCited);
    const stray = figuresIn(visible, supportedCited).filter((n) => !allowed.has(n));
    if (stray.length) add('block', 'figure-not-in-claim', `Cifras que no están en ${ids.join(', ')}: ${stray.join(', ')} («${visible.slice(0, 100)}»)`);
    if (NUMBER_WORDS.test(visible)) add('block', 'figure-in-words', `Cifra escrita con letras: «${visible.slice(0, 100)}»`);
  }

  // Title, excerpt and metadata cannot carry markers: their figures must come from the claims the draft states.
  const allowedAll = allowedNumbers(usedSupported);
  for (const [field, text] of [['title', post.title], ['excerpt', post.excerpt], ['metaTitle', post.seo?.metaTitle], ['metaDescription', post.seo?.metaDescription]] as const) {
    const visible = String(text || '').replace(/<[^>]+>/g, ' ');
    const stray = figuresIn(visible, usedSupported).filter((n) => !allowedAll.has(n));
    if (stray.length || NUMBER_WORDS.test(visible)) add('block', 'metadata-figure-not-in-claims', `${field}: cifras sin afirmación verificada en el texto (${stray.join(', ') || 'cifra con letras'})`);
  }
  if ((post.faqItems || []).length) add('block', 'faq-not-evidenced', 'Las preguntas frecuentes no pasan por el paquete de evidencias');

  const images = provenance.images ?? [];
  for (const image of images) {
    if (image.provider === 'mock') add('block', 'mock-image', `Imagen de prueba (${image.model}), no publicable`);
    if (image.rights !== AI_IMAGE_RIGHTS || image.altText.trim().length < 15) add('block', 'image-metadata', `Imagen ${image.assetId} sin derechos o texto alternativo válidos`);
  }
  // A cover outside the provenance (a poster, a still) needs a person who checked its licence.
  for (const [field, url] of [['featuredImage', post.featuredImage?.sourceUrl], ['ogImage', post.seo?.ogImage]] as const) {
    if (url && !images.some((i) => i.url === url)) add('human', 'image-not-in-provenance', `${field}: imagen sin procedencia registrada (${url})`);
  }
  const cover = images.find((i) => i.url === post.featuredImage?.sourceUrl);
  if (cover && post.featuredImage?.alt !== cover.altText) add('block', 'image-alt-mismatch', 'El texto alternativo de la portada no es el registrado');

  const sourceUrls = new Set(bundle.sources.map((s) => normalizeUrl(s.url)));
  for (const target of linkTargets(html)) {
    let url: URL;
    try { url = new URL(target, SITE); } catch { add('block', 'invalid-link', `Enlace no válido: ${target}`); continue; }
    if (!/^https?:$/.test(url.protocol)) add('block', 'invalid-link', `Enlace con protocolo no permitido: ${target}`);
    else if (!isSiteHost(url.hostname) && !sourceUrls.has(normalizeUrl(url.href))) {
      add('block', 'unsourced-link', `Enlace externo que no está en el paquete de evidencias: ${target}`);
    }
  }

  for (const claim of usedSupported) {
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
  // M11-G: the value is stated, not inferred from counts: a concrete reader benefit proven by claims the text states.
  const dv = provenance.distinctValue;
  if (!dv) {
    if (!BEFORE_DISTINCT_VALUE.test(provenance.pipelineVersion)) add('block', 'distinct-value-missing', 'Falta explicar qué aporta este artículo al lector y con qué afirmaciones se prueba');
  } else {
    const ids = Array.isArray(dv.claimIds) ? dv.claimIds : [];
    const unproven = ids.filter((id) => !usedSupported.some((c) => c.id === id));
    // The proof itself must carry value: GuíaTV data other than the line-up, or verified claims of two publishers.
    const proof = usedSupported.filter((c) => ids.includes(c.id)).flatMap((c) => c.quotes.filter((q) => q.verified).map((q) => sources.get(q.sourceId)));
    const carriesValue = proof.some(valueBearingInternal) || new Set(proof.filter((s) => s && s.kind !== 'internal').map((s) => s!.publisher.toLowerCase())).size >= 2;
    if (String(dv.readerBenefit ?? '').trim().length < 40 || !ids.length || unproven.length || !carriesValue) {
      add('block', 'distinct-value-unsupported', `El valor declarado no es concreto o no lo prueban afirmaciones citadas en el texto (datos propios de GuíaTV o dos editores)${unproven.length ? `: ${unproven.join(', ')}` : ''}`);
    }
  }
  for (const claim of usedSupported) {
    if (claim.volatility !== 'tv-schedule' && claim.quotes.some((q) => q.verified && SCHEDULE_FACTS.test(sources.get(q.sourceId)?.url ?? ''))) {
      add('block', 'schedule-fact-not-dated', `${claim.id}: un horario de la parrilla caduca y no puede darse como dato ${claim.volatility}`);
    }
  }
  if (words(prose) < 1) add('block', 'empty-draft', 'Borrador vacío');

  const critic = provenance.critic;
  if (!critic) add('block', 'critic-missing', 'Falta la revisión independiente');
  else if (critic.bundleHash !== provenance.bundleHash || critic.draftHash !== provenance.draftHash) {
    add('block', 'critic-stale', 'La revisión independiente es de otra versión del borrador o de las evidencias');
  } else if (critic.verdict !== 'pass') {
    // M11-D: a 'revise' is a judgement a named reviewer may take on (acknowledged at approval); a 'block' is final.
    // Either way policy publication refuses it.
    add(critic.verdict === 'revise' ? 'human' : 'block', 'critic-rejected', `La revisión independiente pide ${critic.verdict}: ${critic.issues.map((i) => i.message).join(' | ').slice(0, 300)}`);
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
/**
 * USD per generated image. Only the local mock is priced: a real image model is added here after its
 * price and commercial terms are checked (docs/adr/0001), and until then the ledger refuses it.
 */
export const IMAGE_PRICES: Readonly<Record<string, number>> = Object.freeze({
  'mock-cover-1': 0,
});

export interface EditorialLimits {
  maxArticleUsd: number;
  /** Spend ceiling for all jobs started in one UTC day (text and images). */
  maxDailyUsd: number;
  maxResearchCalls: number;
  maxSourceFetches: number;
  maxRetries: number;
  /** Revisions after the first draft (M11-E2: each one is re-validated and re-criticised from scratch). */
  maxReviewLoops: number;
  /** M11-E2: articles per day that may reach a publishable state (the Admin limit minus today's publications). */
  maxDailyArticles: number;
  /** M11-E2: jobs started per day, publishable or not; bounds retries when money is not the brake. */
  maxDailyAttempts?: number;
  maxConcurrentJobs: number;
}
/** M11-E2 testing profile: EDITORIAL_BUDGET=unlimited sets both USD caps to Infinity; spend is still recorded. */
export const DEFAULT_EDITORIAL_LIMITS: Readonly<EditorialLimits> = Object.freeze({
  maxArticleUsd: 3,
  maxDailyUsd: 10,
  maxResearchCalls: 3,
  maxSourceFetches: 16,
  maxRetries: 1,
  maxReviewLoops: 5,
  maxDailyArticles: 3,
  maxDailyAttempts: 30,
  maxConcurrentJobs: 1,
});

export interface CostEntry { role: string; model: string; inputTokens: number; outputTokens: number; searches: number; usd: number }
export interface CostSummary {
  entries: CostEntry[]; usd: number; inputTokens: number; outputTokens: number; sourceFetches: number; draftAttempts: number; reviewFailures: number;
  /** A call failed without reporting its usage: the real spend is unknown, so it counts as the whole allowance. */
  unresolved?: boolean;
}

export class EditorialBudgetExceeded extends Error {}

/** Per-article ledger. `charge` records first, then throws once the article is over budget. */
export class CostLedger {
  readonly summary: CostSummary = { entries: [], usd: 0, inputTokens: 0, outputTokens: 0, sourceFetches: 0, draftAttempts: 0, reviewFailures: 0 };
  constructor(readonly limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS) {}

  charge(role: string, model: string, usage: { input_tokens: number; output_tokens: number }, searches = 0): CostEntry {
    const price = MODEL_PRICES[model];
    if (!price) throw new EditorialBudgetExceeded(`modelo sin precio conocido: ${model}`);
    const usd = (usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1e6 + searches * WEB_SEARCH_USD;
    return this.record({ role, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, searches, usd: +usd.toFixed(6) });
  }

  /**
   * Refuses a call the article could not pay for if it used its whole output cap.
   * shortcut: output only (input tokens and search fees are not bounded); bound them if a call ever overshoots.
   */
  assertHeadroom(model: string, maxOutputTokens: number): void {
    const price = MODEL_PRICES[model];
    if (!price) throw new EditorialBudgetExceeded(`modelo sin precio conocido: ${model}`);
    const worst = (maxOutputTokens * price[1]) / 1e6;
    if (this.summary.usd + worst > this.limits.maxArticleUsd) {
      throw new EditorialBudgetExceeded(`sin margen para otra llamada a ${model} (${worst.toFixed(2)} USD) dentro del límite ${this.limits.maxArticleUsd}`);
    }
  }

  /** An image costs a flat price per picture; an unpriced image model is refused before it is called. */
  imagePrice(model: string): number {
    const price = IMAGE_PRICES[model];
    if (price === undefined) throw new EditorialBudgetExceeded(`modelo de imagen sin precio conocido: ${model}`);
    if (this.summary.usd + price > this.limits.maxArticleUsd) throw new EditorialBudgetExceeded(`la imagen (${price} USD) supera el límite ${this.limits.maxArticleUsd}`);
    return price;
  }

  chargeImage(model: string): CostEntry {
    return this.record({ role: 'image', model, inputTokens: 0, outputTokens: 0, searches: 0, usd: this.imagePrice(model) });
  }

  private record(entry: CostEntry): CostEntry {
    const s = this.summary;
    s.entries.push(entry);
    s.usd = +(s.usd + entry.usd).toFixed(6);
    s.inputTokens += entry.inputTokens;
    s.outputTokens += entry.outputTokens;
    if (s.usd > this.limits.maxArticleUsd) throw new EditorialBudgetExceeded(`coste ${s.usd.toFixed(2)} USD > límite ${this.limits.maxArticleUsd}`);
    return entry;
  }

  count(kind: 'sourceFetches' | 'draftAttempts' | 'reviewFailures', limit?: number): void {
    this.summary[kind]++;
    if (limit !== undefined && this.summary[kind] > limit) throw new EditorialBudgetExceeded(`${kind} > ${limit}`);
  }
}
