import { isIP } from 'node:net';

/**
 * One IP-privacy policy for every analytics store (Mongo and Valkey previously differed: Mongo kept full addresses).
 *
 * * `ANALYTICS_PII=anonymized` (default): only a truncated prefix is persisted (IPv4 /24, IPv6 /48).
 * * `ANALYTICS_PII=none`: no address, no prefix, no User-Agent and no geography are persisted.
 * * `ANALYTICS_PII=full` is accepted for backwards compatibility but is downgraded to `anonymized`: the full address
 *   is never needed after ingestion (exclusion and GeoIP run on the transient in-memory value).
 */
export type AnalyticsPiiMode = 'anonymized' | 'none';

export function analyticsPiiMode(env: NodeJS.ProcessEnv = process.env): AnalyticsPiiMode {
  return (env.ANALYTICS_PII || '').toLowerCase() === 'none' ? 'none' : 'anonymized';
}

/** Canonical textual form; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) becomes plain IPv4. Empty string if not an IP. */
export function canonicalIp(raw: string | undefined | null): string {
  if (!raw) return '';
  let ip = String(raw).trim();
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const zone = ip.indexOf('%');
  if (zone > 0) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind === 6) {
    const hostname = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const embedded = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
    if (embedded) {
      const hi = parseInt(embedded[1], 16);
      const lo = parseInt(embedded[2], 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
    return hostname;
  }
  return '';
}

/** Truncated prefix for storage: `a.b.c.0` or the first three IPv6 hextets followed by `::`. Undefined if invalid. */
export function anonymizeIp(raw: string | undefined | null): string | undefined {
  const ip = canonicalIp(raw);
  if (!ip) return undefined;
  if (isIP(ip) === 4) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  const groups = expandIpv6(ip);
  return `${groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16)).join(':')}::`;
}

function expandIpv6(ip: string): string[] {
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array(missing).fill('0'), ...right].map((g) => g.padStart(4, '0'));
}

export function isPrivateOrLocalIp(raw: string | undefined | null): boolean {
  const ip = canonicalIp(raw);
  if (!ip) return true;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const first = parseInt(expandIpv6(ip)[0], 16);
  return ip === '::1' || ip === '::' || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** Exact-address exclusion list (`ANALYTICS_EXCLUDED_IPS`, plus loopback), compared on the canonical form. */
export function excludedIpSet(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(['127.0.0.1', '::1', ...(env.ANALYTICS_EXCLUDED_IPS || '').split(',')].map((ip) => canonicalIp(ip)).filter(Boolean));
}

/** An exact address or a CIDR range, canonicalised ("203.0.113.0/24", "2001:db8::/48", "198.51.100.7"). */
export interface IpRule {
  value: string;
  version: 4 | 6;
  base: bigint;
  prefix: number;
}

function toBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
  const canonical = canonicalIp(ip);
  const kind = isIP(canonical);
  if (kind === 4) return { version: 4, value: canonical.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n) };
  if (kind === 6) return { version: 6, value: expandIpv6(canonical).reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n) };
  return null;
}

/** Parses "a.b.c.d", "a.b.c.d/n", "v6" or "v6/n"; null when invalid (bad address, prefix out of range). */
export function parseIpRule(input: string): IpRule | null {
  const raw = String(input || '').trim();
  const [address, prefixText, extra] = raw.split('/');
  if (extra !== undefined || !address) return null;
  const parsed = toBigInt(address);
  if (!parsed) return null;
  const bits = parsed.version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  const base = parsed.value & mask;
  const text = parsed.version === 4
    ? [24n, 16n, 8n, 0n].map((shift) => String((base >> shift) & 255n)).join('.')
    : new URL(`http://[${Array.from({ length: 8 }, (_, i) => ((base >> BigInt(112 - i * 16)) & 0xffffn).toString(16)).join(':')}]/`).hostname.slice(1, -1);
  return { value: prefix === bits ? text : `${text}/${prefix}`, version: parsed.version, base, prefix };
}

export function ipMatchesRule(ip: string, rule: IpRule): boolean {
  const parsed = toBigInt(ip);
  if (!parsed || parsed.version !== rule.version) return false;
  const bits = rule.version === 4 ? 32 : 128;
  if (rule.prefix === 0) return true;
  const mask = ((1n << BigInt(rule.prefix)) - 1n) << BigInt(bits - rule.prefix);
  return (parsed.value & mask) === rule.base;
}
