#!/usr/bin/env node
// M06 shared read-only probe. Exactly one public GET per run, 20s timeout, fixed
// User-Agent, refuses non-http(s) URLs, redacts credential-shaped text, writes the
// result as JSON under artifacts/m06/probes/ and prints a one-line summary.
//
// Usage: node scripts/m06-probe.mjs <http(s) url>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT = 'guiatv-m06-probe/1.0';
const TIMEOUT_MS = 20_000;
const MAX_BODY = 200_000;
const OUT_DIR = join('artifacts', 'm06', 'probes');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: node scripts/m06-probe.mjs <http(s) url>');
  process.exit(2);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error(`m06-probe: refusing non-URL argument: ${raw}`);
  process.exit(2);
}
if (url.protocol !== 'http:' && url.protocol !== 'https:') {
  console.error(`m06-probe: refusing non-http(s) protocol: ${url.protocol}`);
  process.exit(2);
}

// Remove URL userinfo (https://user:pass@host) before it can reach the output.
const safeUrl = url.toString().replace(/(https?:\/\/)[^@/]+@/, '$1');

// Best-effort redaction of credential-shaped text: URL userinfo, Authorization
// schemes, key=value/secret pairs, AWS access keys and PEM private keys.
const redact = (text) => String(text)
  .replace(/https?:\/\/[^/\s@]+@/gi, (m) => m.replace(/\/\/[^@]+@/, '//[REDACTED]@'))
  .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]')
  .replace(/\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|authorization)\b(\s*[:=]\s*)(["']?)[A-Za-z0-9._~+/=-]{8,}\3/gi, '$1$2$3[REDACTED]')
  .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]')
  .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED-PRIVATE-KEY]');

let result;
try {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const headers = {};
  for (const [key, value] of res.headers.entries()) headers[key] = value;
  result = {
    probe: 'm06',
    method: 'GET',
    url: safeUrl,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type') ?? null,
    bodyBytes: Buffer.byteLength(text),
    bodyTruncated: Buffer.byteLength(text) > MAX_BODY,
    body: text.slice(0, MAX_BODY),
    headers,
    measuredAt: new Date().toISOString(),
  };
} catch (error) {
  result = {
    probe: 'm06',
    method: 'GET',
    url: safeUrl,
    ok: false,
    error: error?.name ?? 'Error',
    message: String(error?.message ?? error),
    measuredAt: new Date().toISOString(),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const host = url.host.replace(/[^a-z0-9.-]/gi, '_');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = join(OUT_DIR, `${stamp}-${host}.json`);
writeFileSync(outFile, `${redact(JSON.stringify(result, null, 2))}\n`, 'utf8');

const summary = result.error === undefined
  ? `GET ${safeUrl} -> ${result.status} ${result.contentType ?? ''} (${result.bodyBytes} bytes)`
  : `GET ${safeUrl} -> error ${result.error}`;
console.log(`m06-probe: ${summary} -> ${outFile}`);

process.exit(result.error === undefined && result.ok ? 0 : 1);
