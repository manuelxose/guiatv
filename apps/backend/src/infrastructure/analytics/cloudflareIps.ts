import { IpRule, ipMatchesRule, parseIpRule } from './ipPrivacy';

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips-v4 and /ips-v6, unchanged for years).
 * The site is served through Cloudflare: nginx sees an edge address and appends it to X-Forwarded-For after the
 * visitor address Cloudflare wrote. Treating these ranges as trusted proxies lets the analytics walk past the edge
 * to the visitor (a request sent straight to the origin with a forged header never starts from a Cloudflare hop).
 * `ANALYTICS_TRUST_CLOUDFLARE=false` turns it off; `ANALYTICS_CLOUDFLARE_RANGES` replaces the list.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

let cached: { key: string; rules: IpRule[] } | null = null;

export function cloudflareRanges(env: NodeJS.ProcessEnv = process.env): IpRule[] {
  if ((env.ANALYTICS_TRUST_CLOUDFLARE || '').toLowerCase() === 'false') return [];
  const key = env.ANALYTICS_CLOUDFLARE_RANGES || '';
  if (cached?.key === key) return cached.rules;
  const source = key ? key.split(',') : CLOUDFLARE_RANGES;
  const rules = source.map((range) => parseIpRule(range)).filter((rule): rule is IpRule => Boolean(rule));
  cached = { key, rules };
  return rules;
}

export function isCloudflareIp(ip: string, rules: IpRule[] = cloudflareRanges()): boolean {
  return rules.some((rule) => ipMatchesRule(ip, rule));
}
