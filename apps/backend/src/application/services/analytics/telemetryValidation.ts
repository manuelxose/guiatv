/**
 * Server-side validation and normalisation of analytics payloads. The browser collector already sanitises, but the
 * endpoint is public, so every field is re-checked here: bounded sizes, allow-listed shapes, no query strings, no
 * e-mail-like or long-number strings, timestamps clamped to a plausible window.
 */

export const TELEMETRY_LIMITS = {
  maxEvents: 50,
  maxBodyBytes: 64 * 1024,
  maxDataBytes: 2048,
  maxPath: 300,
  maxTitle: 150,
  pastWindowMs: 24 * 60 * 60_000,
  futureSkewMs: 5 * 60_000,
} as const;

const ID = /^[A-Za-z0-9-]{8,64}$/;
const TYPE = /^[a-z][a-z0-9_]{0,39}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
import { randomUUID } from 'node:crypto';

// Linear-time checks only: every input is length-capped *before* a regex runs (a 60 kB title used to cost seconds of
// blocked event loop with the previous backtracking e-mail pattern).
const EMAIL = /[^\s@]@[^\s@]+\.[^\s@]/;
const LONG_DIGITS = /\d{7,}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_LIKE = /^[A-Za-z0-9_]{24,}$/;
const MAX_SCAN = 512;

/** Opaque identifier/token segments (UUIDs, hex/base64-like ids with digits); readable slugs with hyphens are kept. */
export function isOpaqueSegment(segment: string): boolean {
  return UUID.test(segment) || (TOKEN_LIKE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment));
}

function looksPersonal(value: string): boolean {
  const scan = value.slice(0, MAX_SCAN);
  return (scan.includes('@') && EMAIL.test(scan)) || LONG_DIGITS.test(scan);
}
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const TIMEZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;
const HOST = /^[a-z0-9.-]{1,100}(?::\d{1,5})?$/i;
/** Event types produced by the server itself; a client must not forge them. */
const SERVER_ONLY_TYPES = new Set(['session_start', 'session_end']);

export interface NormalizedEvent {
  eventId?: string;
  type: string;
  name?: string;
  path?: string;
  title?: string;
  referrer?: string;
  occurredAt: Date;
  data?: Record<string, unknown>;
}

export interface NormalizedSession {
  startedAt: Date;
  initialPath?: string;
  referrer?: string;
  utm?: Record<string, string>;
  screen?: { width?: number; height?: number };
  viewport?: { width?: number; height?: number };
  language?: string;
  timezone?: string;
  device?: { type?: string; orientation?: string; touch?: boolean; uaMobile?: boolean };
  colorScheme?: 'dark' | 'light';
}

export interface NormalizedBatch {
  sessionId: string;
  anonId: string;
  session?: NormalizedSession;
  resume?: boolean;
  heartbeat?: { idleSec: number; visible: boolean };
  end?: { reason: string };
  events: NormalizedEvent[];
  /** Events rejected individually (bad type/shape); counted, never stored. */
  rejected: number;
}

export type ValidationResult = { ok: true; batch: NormalizedBatch } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function sanitizeAnalyticsPath(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input) return undefined;
  let pathname: string;
  try {
    pathname = new URL(input.slice(0, 2048), 'https://local.invalid').pathname;
  } catch {
    return undefined;
  }
  const segments = pathname.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i - 1] === 'perfil') segments[i] = ':usuario';
    else {
      let decoded = segments[i];
      try {
        decoded = decodeURIComponent(segments[i]);
      } catch {
        // keep raw
      }
      if (isOpaqueSegment(segments[i]) || (decoded.includes('@') && EMAIL.test(decoded.slice(0, MAX_SCAN)))) segments[i] = ':redacted';
    }
  }
  const clean = `/${segments.join('/')}`;
  if (clean === '/admin' || clean.startsWith('/admin/') || clean === '/embed' || clean.startsWith('/embed/')) return undefined;
  return clean.slice(0, TELEMETRY_LIMITS.maxPath);
}

/** A full referrer URL (legacy clients) or a bare host (current collector) reduced to an external host. */
export function sanitizeReferrerHost(input: unknown, ownHosts: string[] = ['guiaprogramaciontv.com', 'www.guiaprogramaciontv.com']): string | undefined {
  if (typeof input !== 'string' || !input) return undefined;
  let host: string;
  if (/^https?:\/\//i.test(input)) {
    try {
      host = new URL(input).host.toLowerCase();
    } catch {
      return undefined;
    }
  } else if (HOST.test(input)) {
    host = input.toLowerCase();
  } else {
    return undefined;
  }
  return ownHosts.includes(host) ? undefined : host.slice(0, 100);
}

export function sanitizeText(input: unknown, max: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.slice(0, Math.max(max * 2, 64)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!value) return undefined;
  if (looksPersonal(value)) return '[redacted]';
  return value.slice(0, max);
}

export function sanitizeEventData(input: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!isObject(input)) return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= 12) break;
    if (!KEY.test(key)) continue;
    let clean: unknown;
    if (typeof value === 'boolean') clean = value;
    else if (typeof value === 'number') clean = Number.isFinite(value) ? value : undefined;
    else if (typeof value === 'string') clean = sanitizeText(value, 120);
    else if (Array.isArray(value)) {
      const items = value.slice(0, 10).filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).map((item) => (typeof item === 'string' ? sanitizeText(item, 60) : item)).filter((item) => item !== undefined);
      clean = items.length ? items : undefined;
    } else if (isObject(value) && depth === 0) clean = sanitizeEventData(value, 1);
    if (clean === undefined) continue;
    out[key] = clean;
    count++;
  }
  if (!count) return undefined;
  return JSON.stringify(out).length <= TELEMETRY_LIMITS.maxDataBytes ? out : undefined;
}

export function clampTimestamp(input: unknown, now: number): Date {
  const parsed = typeof input === 'string' ? Date.parse(input) : NaN;
  if (!Number.isFinite(parsed) || parsed < now - TELEMETRY_LIMITS.pastWindowMs || parsed > now + TELEMETRY_LIMITS.futureSkewMs) return new Date(now);
  return new Date(Math.min(parsed, now));
}

function dimension(input: unknown): { width?: number; height?: number } | undefined {
  if (!isObject(input)) return undefined;
  const clean = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20_000 ? value : undefined);
  const width = clean(input.width);
  const height = clean(input.height);
  return width === undefined && height === undefined ? undefined : { width, height };
}

export function normalizeSession(input: unknown, now: number): NormalizedSession | undefined {
  if (!isObject(input)) return undefined;
  const utm: Record<string, string> = {};
  if (isObject(input.utm)) {
    for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
      const value = input.utm[key];
      if (typeof value === 'string' && /^[A-Za-z0-9._ -]{1,64}$/.test(value)) utm[key] = value.trim();
    }
  }
  const device = isObject(input.device) ? input.device : {};
  const deviceType = ['mobile', 'tablet', 'desktop'].includes(device.type as string) ? (device.type as string) : undefined;
  const orientation = ['portrait', 'landscape'].includes(device.orientation as string) ? (device.orientation as string) : undefined;
  return {
    startedAt: clampTimestamp(input.startedAt, now),
    initialPath: sanitizeAnalyticsPath(input.initialPath),
    referrer: sanitizeReferrerHost(input.referrer),
    utm: Object.keys(utm).length ? utm : undefined,
    screen: dimension(input.screen),
    viewport: dimension(input.viewport),
    language: typeof input.language === 'string' && LANGUAGE.test(input.language) ? input.language : undefined,
    timezone: typeof input.timezone === 'string' && input.timezone.length <= 64 && TIMEZONE.test(input.timezone) ? input.timezone : undefined,
    device: deviceType || orientation ? { type: deviceType, orientation, touch: device.touch === true, uaMobile: typeof device.uaMobile === 'boolean' ? device.uaMobile : undefined } : undefined,
    colorScheme: input.colorScheme === 'dark' || input.colorScheme === 'light' ? input.colorScheme : undefined,
  };
}

export function normalizeEvent(input: unknown, now: number): NormalizedEvent | null {
  if (!isObject(input) || typeof input.type !== 'string' || !TYPE.test(input.type) || SERVER_ONLY_TYPES.has(input.type)) return null;
  const path = input.path === undefined ? undefined : sanitizeAnalyticsPath(input.path);
  if (input.path !== undefined && path === undefined) return null; // admin/embed or unparsable: not measured
  return {
    // Assigned once here (at acceptance), so retries of the same queued item reuse it (idempotent writes).
    eventId: typeof input.eventId === 'string' && ID.test(input.eventId) ? input.eventId : randomUUID(),
    type: input.type,
    name: sanitizeText(input.name, 60),
    path,
    title: sanitizeText(input.title, TELEMETRY_LIMITS.maxTitle),
    referrer: sanitizeReferrerHost(input.referrer),
    occurredAt: clampTimestamp(input.occurredAt, now),
    data: sanitizeEventData(input.data),
  };
}

export function validateCollectBatch(body: unknown, now = Date.now()): ValidationResult {
  if (!isObject(body)) return { ok: false, reason: 'body' };
  if (body.v !== 1) return { ok: false, reason: 'version' };
  if (typeof body.sessionId !== 'string' || !ID.test(body.sessionId)) return { ok: false, reason: 'sessionId' };
  if (typeof body.anonId !== 'string' || !ID.test(body.anonId)) return { ok: false, reason: 'anonId' };
  const rawEvents = body.events === undefined ? [] : body.events;
  if (!Array.isArray(rawEvents)) return { ok: false, reason: 'events' };
  if (rawEvents.length > TELEMETRY_LIMITS.maxEvents) return { ok: false, reason: 'too_many_events' };
  const events: NormalizedEvent[] = [];
  let rejected = 0;
  for (const raw of rawEvents) {
    const event = normalizeEvent(raw, now);
    if (event) events.push(event);
    else rejected++;
  }
  const heartbeat = isObject(body.heartbeat)
    ? { idleSec: typeof body.heartbeat.idleSec === 'number' && body.heartbeat.idleSec >= 0 ? Math.min(Math.floor(body.heartbeat.idleSec), 86_400) : 0, visible: body.heartbeat.visible !== false }
    : undefined;
  const end = isObject(body.end) && ['pagehide', 'bfcache', 'timeout', 'unload'].includes(body.end.reason as string) ? { reason: body.end.reason as string } : undefined;
  return {
    ok: true,
    batch: { sessionId: body.sessionId, anonId: body.anonId, session: normalizeSession(body.session, now), resume: body.resume === true || undefined, heartbeat, end, events, rejected },
  };
}
