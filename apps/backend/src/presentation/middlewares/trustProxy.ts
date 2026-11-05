// src/presentation/middlewares/trustProxy.ts

import { canonicalIp, ipMatchesRule } from '../../infrastructure/analytics/ipPrivacy';
import { cloudflareRanges } from '../../infrastructure/analytics/cloudflareIps';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * Express `trust proxy` function: `req.ip` becomes the visitor's address behind Cloudflare → nginx → API.
 *
 * Express walks from the TCP peer (hop 0) leftwards through X-Forwarded-For and stops at the first hop this returns
 * false for; that hop is `req.ip`. On the server:
 * - hop 0 is nginx on loopback (ports 3000/4000 are closed to the outside);
 * - hop 1 is what nginx appended (`$proxy_add_x_forwarded_for`): its `$remote_addr`, a Cloudflare edge for public
 *   traffic (nginx has no real_ip config);
 * - hop 2 is the visitor address Cloudflare wrote; anything further left was sent by the client and is never reached.
 *
 * Same rule as the analytics walk (`resolveAnalyticsClient`): Cloudflare's ranges are trusted only behind the
 * loopback nginx, never as the TCP peer. A request sent straight to nginx with a forged header stops at the sender's
 * own address (hop 1 is not Cloudflare); one sent straight to the API from outside stops at the TCP peer. Neither
 * chooses its own key. `ANALYTICS_TRUST_CLOUDFLARE=false` / `ANALYTICS_CLOUDFLARE_RANGES` apply here too, so with
 * Cloudflare trust off this is the previous `trust proxy` 1 (the address nginx saw).
 *
 * Still correct if nginx later rewrites `$remote_addr` with `real_ip_header CF-Connecting-IP`: hop 1 is then the
 * visitor, which is not a Cloudflare address, so the walk stops there.
 */
export function createTrustProxy(env: NodeJS.ProcessEnv = process.env): (address: string, hop: number) => boolean {
  return (address, hop) => {
    const ip = canonicalIp(address);
    if (hop === 0) return LOOPBACK.has(ip);
    return Boolean(ip) && cloudflareRanges(env).some((rule) => ipMatchesRule(ip, rule));
  };
}

export const trustProxy = createTrustProxy();
