/**
 * M12-G2: the per-URL eligibility contract for programmatic pages (docs/roadmap/M12-G0-READINESS-20261103.md G-03, G-04).
 * Pure: the caller measures the page (HTTP status, rendered text, JSON-LD, links, peers) and this decides, with named
 * reasons and an `evidenceHash` that a signed allowlist entry (IndexBatchGate) can carry. Content words are a floor (total words, plus a vocabulary-variety ratio so padding cannot pass):
 * a page also needs a distinct intent, low template share, dated sources, a clean canonical and real inbound links.
 */
import { createHash } from 'node:crypto';

export const ELIGIBILITY_POLICY_VERSION = 'url-eligibility-v3';
export const THRESHOLDS = {
  minTotalWords: 300,
  minUniqueRatio: 0.3,
  maxTemplateShare: 0.3,
  titleChars: [20, 70],
  descriptionChars: [70, 160],
  minInboundLinks: 3,
} as const;

export interface EligibilityInput {
  path: string;
  httpStatus: number;
  canonicalPath: string | null;
  robots: string | null;
  title: string;
  description: string;
  /** Main content text, template chrome (nav, footer, boilerplate) already removed. */
  mainText: string;
  /** The search need this page answers; one page per key in the family. */
  intentKey: string;
  claims: Array<{ text: string; source: string | null; sourceDate: string | null }>;
  jsonLd: unknown[];
  /** Internal links to this URL from pages that persist (not the sitemap). */
  inboundLinks: number;
  entityVerified: boolean;
  /** The other pages of the same family, for duplicate-intent and template-similarity checks. */
  peers: Array<{ path: string; intentKey: string; mainText: string }>;
}

export type EligibilityReason =
  | 'http-not-200' | 'canonical-not-self' | 'robots-noindex' | 'title-length' | 'description-length'
  | 'thin-content' | 'duplicate-intent' | 'template-share' | 'claim-unsourced' | 'jsonld-invalid'
  | 'low-internal-links' | 'entity-unverified';

export interface EligibilityVerdict {
  eligible: boolean;
  reasons: EligibilityReason[];
  policyVersion: string;
  evidenceHash: string;
  metrics: { totalWords: number; uniqueWords: number; templateShare: number };
}

const words = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? [];
const shingles = (t: string, n = 4) => {
  const w = words(t);
  const s = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
};

/** Share of this page's 4-gram shingles that also occur in its most similar peer (0..1). */
export function templateShare(text: string, peers: Array<{ mainText: string }>): number {
  const mine = shingles(text);
  if (!mine.size || !peers.length) return 0;
  let max = 0;
  for (const p of peers) {
    const theirs = shingles(p.mainText);
    let shared = 0;
    for (const s of mine) if (theirs.has(s)) shared++;
    max = Math.max(max, shared / mine.size);
  }
  return max;
}

const validJsonLd = (blocks: unknown[]) => blocks.length > 0 && blocks.every((b) => {
  const o = b as Record<string, unknown> | null;
  return !!o && typeof o === 'object' && o['@context'] !== undefined && typeof o['@type'] === 'string' && !!o['@type'];
});

/** JSON with object keys sorted at every level, so re-serialised JSON-LD or claims hash the same. */
const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : x));

export function evaluateUrlEligibility(i: EligibilityInput): EligibilityVerdict {
  const reasons: EligibilityReason[] = [];
  const all = words(i.mainText);
  const unique = new Set(all).size;
  const share = templateShare(i.mainText, i.peers.filter((p) => p.path !== i.path));
  const [tMin, tMax] = THRESHOLDS.titleChars;
  const [dMin, dMax] = THRESHOLDS.descriptionChars;
  if (i.httpStatus !== 200) reasons.push('http-not-200');
  if (i.canonicalPath !== i.path) reasons.push('canonical-not-self');
  if (/noindex/i.test(i.robots ?? '')) reasons.push('robots-noindex');
  if (i.title.trim().length < tMin || i.title.trim().length > tMax) reasons.push('title-length');
  if (i.description.trim().length < dMin || i.description.trim().length > dMax) reasons.push('description-length');
  if (all.length < THRESHOLDS.minTotalWords || unique / Math.max(all.length, 1) < THRESHOLDS.minUniqueRatio) reasons.push('thin-content');
  if (!i.intentKey.trim() || i.peers.some((p) => p.path !== i.path && p.intentKey === i.intentKey)) reasons.push('duplicate-intent');
  if (share >= THRESHOLDS.maxTemplateShare) reasons.push('template-share');
  if (i.claims.length === 0 || i.claims.some((c) => !c.source?.trim() || Number.isNaN(Date.parse(c.sourceDate ?? '')))) reasons.push('claim-unsourced');
  if (!validJsonLd(i.jsonLd)) reasons.push('jsonld-invalid');
  if (i.inboundLinks < THRESHOLDS.minInboundLinks) reasons.push('low-internal-links');
  if (!i.entityVerified) reasons.push('entity-unverified');
  const h = (v: string) => createHash('sha256').update(v).digest('hex');
  // Every evaluated input is covered, so a signed approval is void if any of them changes. Peers are order-independent.
  const peers = i.peers.map((p) => JSON.stringify([p.path, p.intentKey, h(p.mainText)])).sort();
  const evidenceHash = h(canonicalJson({
    v: ELIGIBILITY_POLICY_VERSION, path: i.path, status: i.httpStatus, canonical: i.canonicalPath, robots: i.robots,
    title: i.title, description: i.description, text: h(i.mainText), intent: i.intentKey, claims: i.claims, jsonLd: i.jsonLd,
    inbound: i.inboundLinks, entityVerified: i.entityVerified, peers, reasons,
  }));
  return { eligible: reasons.length === 0, reasons, policyVersion: ELIGIBILITY_POLICY_VERSION, evidenceHash, metrics: { totalWords: all.length, uniqueWords: unique, templateShare: Number(share.toFixed(3)) } };
}
