import { NextFunction, Request, Response } from 'express';

interface HttpCachePolicy {
  browserSeconds: number;
  sharedSeconds: number;
  staleSeconds: number;
}

/** Applies explicit edge/browser policies only to anonymous public GETs. */
export function publicCachePolicy(req: Request, res: Response, next: NextFunction): void {
  const isPrivate = Boolean(req.get('authorization') || req.get('cookie'));
  const policy = !isPrivate && req.method === 'GET' ? resolvePolicy(req.path, req.query) : null;

  if (policy) {
    res.set('Cache-Control', [
      'public',
      `max-age=${policy.browserSeconds}`,
      `s-maxage=${policy.sharedSeconds}`,
      `stale-while-revalidate=${policy.staleSeconds}`,
      `stale-if-error=${policy.staleSeconds}`,
    ].join(', '));
    res.set('Vary', 'Accept-Encoding');
  } else {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
}

export function resolvePolicy(
  path: string,
  query: Record<string, unknown>
): HttpCachePolicy | null {
  if (path === '/v2/telemetry/config') {
    // Analytics switch: a flip (emergency disable) reaches browsers within about a minute.
    return { browserSeconds: 60, sharedSeconds: 60, staleSeconds: 60 };
  }
  if (path === '/v2/tv/read' || path === '/tv/read') {
    const view = String(query.view || 'day');
    if (view === 'now') return { browserSeconds: 5, sharedSeconds: 30, staleSeconds: 60 };
    if (view === 'next') return { browserSeconds: 15, sharedSeconds: 60, staleSeconds: 300 };
    if (view === 'night') return { browserSeconds: 60, sharedSeconds: 300, staleSeconds: 900 };
    return { browserSeconds: 60, sharedSeconds: 300, staleSeconds: 900 };
  }
  if (/\/(v2\/)?tv\/read\/channels(?:\/|$)/.test(path)) {
    return { browserSeconds: 300, sharedSeconds: 900, staleSeconds: 3600 };
  }
  if (path === '/v2/discovery/home' || path === '/discovery/home') {
    return { browserSeconds: 30, sharedSeconds: 120, staleSeconds: 900 };
  }
  if (/\/(v2\/)?sports\/football\/matches\/live$/.test(path)) {
    return { browserSeconds: 3, sharedSeconds: 8, staleSeconds: 30 };
  }
  if (/\/(v2\/)?sports\/football\/home$/.test(path)) {
    return { browserSeconds: 10, sharedSeconds: 45, staleSeconds: 300 };
  }
  if (/\/(v2\/)?sports\/football\/competitions$/.test(path)) {
    // 15 min at the edge: a deploy or ingestion fix shows within minutes; SWR keeps upstream load flat.
    return { browserSeconds: 300, sharedSeconds: 900, staleSeconds: 86400 };
  }
  if (/\/(v2\/)?sports\/football\/(matches|competitions|teams|news|search)(?:\/|$)/.test(path)) {
    return { browserSeconds: 30, sharedSeconds: 180, staleSeconds: 900 };
  }
  if (path === '/v2/blog' || path === '/blog' || path === '/v2/blog/categories' || path === '/blog/categories') {
    return query.slug
      ? { browserSeconds: 300, sharedSeconds: 900, staleSeconds: 3600 }
      : { browserSeconds: 60, sharedSeconds: 300, staleSeconds: 1800 };
  }
  return null;
}
