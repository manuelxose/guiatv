import { isIP } from 'node:net';

function normalizeIp(ip: string): string {
  const kind = isIP(ip);
  return kind ? new URL(`http://[${kind === 4 ? `::ffff:${ip}` : ip}]/`).hostname : '';
}

export function isTrustedAnalyticsProxy(remoteAddress: string | undefined, trustedProxies: string): boolean {
  const remote = remoteAddress ? normalizeIp(remoteAddress) : '';
  return Boolean(remote && trustedProxies.split(',').some((ip) => normalizeIp(ip.trim()) === remote));
}

export function analyticsClientIp(remoteAddress: string | undefined, forwarded: string | undefined, trustedProxies: string): string {
  const remote = remoteAddress || 'unknown';
  const trusted = new Set(trustedProxies.split(',').map((ip) => normalizeIp(ip.trim())).filter(Boolean));
  if (!trusted.has(normalizeIp(remote)) || !forwarded) return remote;
  const chain = forwarded.split(',').map((ip) => ip.trim());
  if (chain.some((ip) => !isIP(ip))) return remote;
  chain.push(remote);
  let index = chain.length - 1;
  while (index > 0 && trusted.has(normalizeIp(chain[index]))) index--;
  return chain[index];
}
