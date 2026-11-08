export type ProviderErrorKind =
  | 'rate_limit'
  | 'auth'
  | 'forbidden'
  | 'server'
  | 'client'
  | 'network'
  | 'unknown';

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  status?: number;
  retryable: boolean;
}

/** Extracts an HTTP status from an axios-style error, a plain object, or a message string. */
export function extractStatus(error: unknown): number | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (e.response && typeof (e.response as Record<string, unknown>).status === 'number') {
      return (e.response as Record<string, unknown>).status as number;
    }
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  const match = /(?:status[=: ])(\d{3})/i.exec(String(error));
  return match ? Number(match[1]) : undefined;
}

/** 429 -> retry (rate limit), 401/403 -> never retry, 5xx -> retry, other 4xx -> never retry. */
export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const status = extractStatus(error);
  if (status === 429) return { kind: 'rate_limit', status, retryable: true };
  if (status === 401) return { kind: 'auth', status, retryable: false };
  if (status === 403) return { kind: 'forbidden', status, retryable: false };
  if (status !== undefined && status >= 500) return { kind: 'server', status, retryable: true };
  if (status !== undefined && status >= 400) return { kind: 'client', status, retryable: false };
  return { kind: error ? 'network' : 'unknown', retryable: Boolean(error) };
}

/** Pulls a Retry-After value from an error object (axios headers or a plain field). */
export function extractRetryAfter(error: unknown): string | number | undefined {
  if (error === undefined || error === null || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  if (e.retryAfter !== undefined && e.retryAfter !== null) return e.retryAfter as string | number;
  const response = e.response as Record<string, unknown> | undefined;
  if (response && response.headers) {
    const headers = response.headers as Record<string, unknown>;
    if (headers['retry-after'] !== undefined && headers['retry-after'] !== null) {
      return headers['retry-after'] as string | number;
    }
    const anyCase = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after');
    if (anyCase) return headers[anyCase] as string | number;
  }
  return undefined;
}

/**
 * Parses a Retry-After header: integer seconds or an HTTP-date. Returns the
 * delay in ms, or null when the value is absent/unparseable.
 */
export function parseRetryAfter(value: string | number | null | undefined, now = Date.now()): number | null {
  if (value === undefined || value === null || value === '') return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber) * 1000;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) {
    return Math.max(0, parsed - now);
  }
  return null;
}

export interface BackoffInput {
  /** 0-based attempt number. */
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfter?: string | number | null;
  now?: () => number;
  /** Injected for deterministic tests (default Math.random). */
  random?: () => number;
}

export interface BackoffResult {
  delayMs: number;
  cappedExponentialMs: number;
  usedRetryAfter: boolean;
}

/**
 * Exponential backoff with full jitter, capped. When a Retry-After value is
 * present it wins over the computed backoff delay.
 */
export function computeBackoff(input: BackoffInput): BackoffResult {
  const base = input.baseDelayMs ?? 500;
  const max = input.maxDelayMs ?? 30_000;
  const cappedExponentialMs = Math.min(max, base * Math.pow(2, Math.max(0, input.attempt)));

  const retryAfter = parseRetryAfter(input.retryAfter, (input.now ?? Date.now)());
  if (retryAfter !== null) {
    return { delayMs: retryAfter, cappedExponentialMs, usedRetryAfter: true };
  }

  const random = input.random ?? Math.random;
  const jittered = Math.floor(random() * cappedExponentialMs);
  return { delayMs: jittered, cappedExponentialMs, usedRetryAfter: false };
}
