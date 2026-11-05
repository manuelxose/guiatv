import { isIP } from 'node:net';
import { IpRule, ipMatchesRule } from '../../infrastructure/analytics/ipPrivacy';

function normalizeIp(ip: string): string {
  const kind = isIP(ip);
  return kind ? new URL(`http://[${kind === 4 ? `::ffff:${ip}` : ip}]/`).hostname : '';
}

export function isTrustedAnalyticsProxy(remoteAddress: string | undefined, trustedProxies: string): boolean {
  const remote = remoteAddress ? normalizeIp(remoteAddress) : '';
  return Boolean(remote && trustedProxies.split(',').some((ip) => normalizeIp(ip.trim()) === remote));
}

/**
 * Client address from the socket peer and X-Forwarded-For, trusting the header only as far as it was written by
 * trusted proxies: walk from the right (the socket peer, then what each trusted proxy appended) and stop at the first
 * address that is not a trusted proxy. Entries further left were written by the client and are never reached, so
 * neither a forged address nor garbage in the header can change the result (garbage used to discard the whole
 * chain and fall back to the proxy's own, always-excluded loopback address).
 */
export function analyticsClientIp(remoteAddress: string | undefined, forwarded: string | undefined, trustedProxies: string, trustedRanges: IpRule[] = []): string {
  return resolveAnalyticsClient(remoteAddress, forwarded, trustedProxies, trustedRanges).ip;
}

/**
 * Same walk, also telling whether it went through a trusted range (Cloudflare's edge): only then are the headers
 * that edge adds (CF-IPCountry) known to come from it. Ranges are trusted only behind an exact trusted proxy (nginx),
 * never as the socket peer: a direct connection from a Cloudflare address is not a reason to believe its header.
 */
export function resolveAnalyticsClient(remoteAddress: string | undefined, forwarded: string | undefined, trustedProxies: string, trustedRanges: IpRule[] = []): { ip: string; viaRange: boolean } {
  const remote = remoteAddress || 'unknown';
  const trusted = new Set(trustedProxies.split(',').map((ip) => normalizeIp(ip.trim())).filter(Boolean));
  if (!trusted.has(normalizeIp(remote)) || !forwarded) return { ip: remote, viaRange: false };
  const isTrusted = (hop: string) => trusted.has(normalizeIp(hop)) || trustedRanges.some((rule) => ipMatchesRule(hop, rule));
  const chain = forwarded.split(',').map((ip) => ip.trim());
  let candidate = remote;
  let viaRange = false;
  for (let index = chain.length - 1; index >= 0; index--) {
    const hop = chain[index];
    if (!isIP(hop)) return { ip: candidate, viaRange }; // written by an untrusted party: keep the last trustworthy hop
    candidate = hop;
    if (!isTrusted(hop)) return { ip: hop, viaRange };
    if (!trusted.has(normalizeIp(hop))) viaRange = true;
  }
  return { ip: candidate, viaRange };
}
