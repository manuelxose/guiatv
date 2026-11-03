/**
 * M12-G2: the per-URL eligibility contract for programmatic pages (docs/roadmap/M12-G0-READINESS-20261103.md G-03, G-04).
 * Pure: the caller measures the page (HTTP status, rendered text, JSON-LD, links, peers) and this decides, with named
 * reasons and an `evidenceHash` that a signed allowlist entry (IndexBatchGate) can carry. Word count is only a floor:
 * a page also needs a distinct intent, low template share, dated sources, a clean canonical and real inbound links.
 */
import { createHash } from 'node:crypto';

export const ELIGIBILITY_POLICY_VERSION = 'url-eligibility-v1';
export const THRESHOLDS = {
  minUniqueWords: 300,
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
  metrics: { uniqueWords: number; templateShare: number };
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

export function evaluateUrlEligibility(i: EligibilityInput): EligibilityVerdict {
  const reasons: EligibilityReason[] = [];
  const unique = new Set(words(i.mainText)).size;
  const share = templateShare(i.mainText, i.peers.filter((p) => p.path !== i.path));
  const [tMin, tMax] = THRESHOLDS.titleChars;
  const [dMin, dMax] = THRESHOLDS.descriptionChars;
  if (i.httpStatus !== 200) reasons.push('http-not-200');
  if (i.canonicalPath !== i.path) reasons.push('canonical-not-self');
  if (/noindex/i.test(i.robots ?? '')) reasons.push('robots-noindex');
  if (i.title.trim().length < tMin || i.title.trim().length > tMax) reasons.push('title-length');
  if (i.description.trim().length < dMin || i.description.trim().length > dMax) reasons.push('description-length');
  if (unique < THRESHOLDS.minUniqueWords) reasons.push('thin-content');
  if (!i.intentKey.trim() || i.peers.some((p) => p.path !== i.path && p.intentKey === i.intentKey)) reasons.push('duplicate-intent');
  if (share >= THRESHOLDS.maxTemplateShare) reasons.push('template-share');
  if (i.claims.length === 0 || i.claims.some((c) => !c.source?.trim() || Number.isNaN(Date.parse(c.sourceDate ?? '')))) reasons.push('claim-unsourced');
  if (!validJsonLd(i.jsonLd)) reasons.push('jsonld-invalid');
  if (i.inboundLinks < THRESHOLDS.minInboundLinks) reasons.push('low-internal-links');
  if (!i.entityVerified) reasons.push('entity-unverified');
  const evidenceHash = createHash('sha256').update(JSON.stringify({
    v: ELIGIBILITY_POLICY_VERSION, path: i.path, status: i.httpStatus, canonical: i.canonicalPath, robots: i.robots,
    text: createHash('sha256').update(i.mainText).digest('hex'), intent: i.intentKey, claims: i.claims, inbound: i.inboundLinks, reasons,
  })).digest('hex');
  return { eligible: reasons.length === 0, reasons, policyVersion: ELIGIBILITY_POLICY_VERSION, evidenceHash, metrics: { uniqueWords: unique, templateShare: Number(share.toFixed(3)) } };
}
