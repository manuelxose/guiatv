/**
 * Fuzzy keyword → platform brand mark, shared by PlatformBadgeComponent and
 * AffiliateCTAComponent so both fall back to the same icon when a
 * merchant/platform record has no logo URL of its own.
 *
 * The marks are self-hosted in `assets/images/platforms` instead of the
 * hardcoded TMDB CDN hashes used before: those paths rot (8 of the 17
 * returned 404) and left the badge pointing at a third party.
 */
const PLATFORM_LOGO_BASE = '/assets/images/platforms';

const KNOWN_PLATFORM_LOGOS: ReadonlyArray<readonly [string, string]> = [
  ['netflix', 'netflix'],
  ['prime video', 'prime-video'],
  ['amazon', 'prime-video'],
  ['disney', 'disney-plus'],
  ['hbo', 'hbo-max'],
  ['max', 'hbo-max'],
  ['movistar', 'movistar-plus'],
  ['skyshowtime', 'skyshowtime'],
  ['apple tv', 'apple-tv-plus'],
  ['filmin', 'filmin'],
  ['rtve', 'rtve-play'],
  ['atresplayer', 'atresplayer'],
  ['mitele', 'mitele'],
  ['pluto', 'pluto-tv'],
  ['rakuten', 'rakuten-tv'],
  ['mubi', 'mubi'],
  ['starz', 'starz'],
];

/**
 * Resolves a small provider logo URL for `label` (a merchant/platform name).
 * `providedUrl`, when non-empty, is normalized to the w92 TMDB size and always
 * wins — the keyword list is a fallback for records without a logo of their
 * own, not an override.
 */
export function resolvePlatformLogoUrl(label: string, providedUrl?: string | null): string {
  const provided = String(providedUrl || '').trim();
  if (provided) return provided.replace('/t/p/original/', '/t/p/w92/');

  const normalized = String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const [keyword, file] of KNOWN_PLATFORM_LOGOS) {
    if (normalized.includes(keyword)) return `${PLATFORM_LOGO_BASE}/${file}.png`;
  }

  return '';
}
