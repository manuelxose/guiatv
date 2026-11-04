/**
 * Pure helpers that strip personal or unnecessary data from analytics payloads before they leave the browser.
 * No Angular, no DOM: unit-testable and safe to call on any platform.
 */

const MAX_PATH_LENGTH = 300;
const MAX_STRING_LENGTH = 120;
const MAX_DATA_KEYS = 12;
const MAX_ARRAY_ITEMS = 10;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
// Linear-time patterns, applied to length-capped input only (same rules as the server's telemetryValidation.ts).
const EMAIL_PATTERN = /[^\s@]@[^\s@]+\.[^\s@]/;
const LONG_DIGITS_PATTERN = /\d{7,}/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_LIKE = /^[A-Za-z0-9_]{24,}$/;

/** Opaque identifier/token segments (UUIDs, id-like runs with digits); readable hyphenated slugs are kept. */
export function isOpaqueSegment(segment: string): boolean {
  return UUID_PATTERN.test(segment) || (TOKEN_LIKE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment));
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@') && EMAIL_PATTERN.test(value.slice(0, 512));
}

/** Path prefixes whose next segment is a personal identifier and is replaced by a placeholder. */
const PERSONAL_SEGMENT_PREFIXES: ReadonlyArray<[string, string]> = [['perfil', ':usuario']];

/** Areas that are never measured: operator activity is not audience; the embed widget runs inside third-party sites. */
const UNTRACKED_PREFIXES = ['/admin', '/embed'];

/**
 * Pathname only: query string and fragment are always removed (they can carry search terms, tokens or e-mail
 * addresses). Personal segments and opaque token-like segments are replaced; the result is length-capped.
 * Returns null for paths that must not be measured.
 */
export function sanitizePath(input: string | null | undefined): string | null {
  if (!input) return '/';
  let pathname: string;
  try {
    pathname = new URL(String(input).slice(0, 2048), 'https://local.invalid').pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const rule = PERSONAL_SEGMENT_PREFIXES.find(([prefix]) => segments[i - 1] === prefix);
    if (rule) segments[i] = rule[1];
    else if (isOpaqueSegment(segments[i]) || looksLikeEmail(safeDecode(segments[i]))) segments[i] = ':redacted';
  }
  const clean = `/${segments.join('/')}`;
  if (UNTRACKED_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))) return null;
  return clean.slice(0, MAX_PATH_LENGTH);
}

/** External referrer reduced to its host; same-site or unparsable referrers yield undefined. */
export function sanitizeReferrer(referrer: string | null | undefined, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.host === ownHost) return undefined;
    return url.host.slice(0, 100);
  } catch {
    return undefined;
  }
}

/** utm_* campaign parameters only, restricted to a safe character set. */
export function extractUtm(search: string | null | undefined): Record<string, string> | undefined {
  if (!search) return undefined;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const utm: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = params.get(key);
    if (value && /^[A-Za-z0-9._ -]{1,64}$/.test(value)) utm[key.slice(4)] = value.trim();
  }
  return Object.keys(utm).length ? utm : undefined;
}

export function isValidEventType(type: unknown): type is string {
  return typeof type === 'string' && EVENT_TYPE_PATTERN.test(type);
}

/**
 * Bounded, flat-ish event data: allow-listed key shape, primitive values, at most one nested level, strings capped
 * and redacted when they look like an e-mail or a phone/ID number.
 */
export function sanitizeData(data: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (count >= MAX_DATA_KEYS) break;
    if (!KEY_PATTERN.test(key)) continue;
    const clean = sanitizeValue(value, depth);
    if (clean === undefined) continue;
    out[key] = clean;
    count++;
  }
  return count ? out : undefined;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => (typeof item === 'object' ? undefined : sanitizeValue(item, depth + 1))).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object' && depth === 0) return sanitizeData(value, depth + 1);
  return undefined;
}

export function sanitizeString(value: string): string | undefined {
  const trimmed = value.slice(0, MAX_STRING_LENGTH * 2).trim();
  if (!trimmed) return undefined;
  if (looksLikeEmail(trimmed) || LONG_DIGITS_PATTERN.test(trimmed)) return '[redacted]';
  return trimmed.slice(0, MAX_STRING_LENGTH);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
