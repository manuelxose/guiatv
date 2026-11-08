/**
 * Ingestion utilities: credential/keyed-URL redaction and duplicate-key
 * detection. Redaction is the last line of defence for the diagnostics surface;
 * it must never leak credential values, full URLs with keys, or bearer tokens.
 */

import { FootballDiagnosticsReport } from './types';

export function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  const innerCode = (error as { err?: { code?: number } })?.err?.code;
  const message = String((error as { message?: string })?.message ?? '');
  return (
    code === 11000 ||
    innerCode === 11000 ||
    message.includes('E11000') ||
    message.toLowerCase().includes('duplicate key')
  );
}

// Query/header pairs that carry a secret: `?api_key=…`, `?token=…`, `?key=…`, etc.
const KEYED_URL_PATTERN = /([?&](?:api[_-]?key|token|auth|access[_-]?token|key|secret|signature|sig)=)([^&\s"'<>]+)/gi;
const AUTHORIZATION_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

/** Replaces credential values and bearer tokens in free text with REDACTED. */
export function redact(text: unknown): string {
  const value = String(text ?? '');
  return value
    .replace(KEYED_URL_PATTERN, '$1REDACTED')
    .replace(AUTHORIZATION_PATTERN, '$1REDACTED');
}

/**
 * Deep redact over a diagnostics report: serializes to JSON, applies the
 * text-level redactor, and parses back. Simple, deterministic, and it catches
 * any string field a future caller might add without remembering to sanitize.
 */
export function redactDiagnostics(report: FootballDiagnosticsReport): FootballDiagnosticsReport {
  return JSON.parse(redact(JSON.stringify(report))) as FootballDiagnosticsReport;
}
