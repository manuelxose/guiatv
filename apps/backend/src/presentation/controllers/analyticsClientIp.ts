import { isIP } from 'node:net';

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
export function analyticsClientIp(remoteAddress: string | undefined, forwarded: string | undefined, trustedProxies: string): string {
  const remote = remoteAddress || 'unknown';
  const trusted = new Set(trustedProxies.split(',').map((ip) => normalizeIp(ip.trim())).filter(Boolean));
  if (!trusted.has(normalizeIp(remote)) || !forwarded) return remote;
  const chain = forwarded.split(',').map((ip) => ip.trim());
  let candidate = remote;
  for (let index = chain.length - 1; index >= 0; index--) {
    const hop = chain[index];
    if (!isIP(hop)) return candidate; // written by an untrusted party: keep the last trustworthy hop
    candidate = hop;
    if (!trusted.has(normalizeIp(hop))) return hop;
  }
  return candidate;
}
