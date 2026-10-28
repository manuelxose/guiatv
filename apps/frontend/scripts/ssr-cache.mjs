// SSR page cache with stale-while-revalidate (2D-2C.1). Imported by ssr-server.mjs; shipped by publish-release.
//
// An entry is fresh for `ttlMs`. Until `staleMs(path)` it is still served (marked stale) while one refresh per
// path replaces it: a hub render takes 4-22 s in production, so nobody waits for (or times out on) it.
// Every public render outcome goes through `settle`, so a stale copy can never outlive a confirmed change:
//   - cacheable and < 500: replaces the entry;
//   - anything else < 500 (redirect, 404/410, non-HTML, uncacheable shell): a confirmed change, evicts it;
//   - 5xx: says nothing about the page, so the stale copy stays until it ages out.
export function createSsrCache({ ttlMs, staleMs, maxEntries = 200, now = Date.now }) {
  const entries = new Map();
  const refreshing = new Set();
  return {
    get(path) {
      const entry = entries.get(path);
      if (!entry) return null;
      const age = now() - entry.ts;
      if (age > staleMs(path)) {
        entries.delete(path);
        return null;
      }
      return { statusCode: entry.statusCode, html: entry.html, stale: age > ttlMs };
    },
    settle(path, { statusCode, html, cacheable }) {
      if (statusCode >= 500) return;
      entries.delete(path);
      if (!cacheable || typeof html !== 'string') return;
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(path, { statusCode, html, ts: now() });
    },
    /** Drops every rendered page (the rollout state of a server-side feature changed). */
    clear(matches = () => true) {
      for (const path of [...entries.keys()]) if (matches(path)) entries.delete(path);
    },
    /** Starts `refresh()` unless one is already running for `path`; false when it was already running. */
    refreshOnce(path, refresh) {
      if (refreshing.has(path)) return false;
      refreshing.add(path);
      Promise.resolve()
        .then(refresh)
        .catch(() => undefined)
        .finally(() => refreshing.delete(path));
      return true;
    },
  };
}

// Pages whose content is "what is on now": a stale copy of these may only be a few minutes old.
const LIVE_PATHS = /^\/(?:$|programacion-tv\/(?:en-directo|que-ver-hoy)$|canales\/[^/]+$|deportes\/futbol(?:\/.*)?$)/;
export const isLivePath = (path) => LIVE_PATHS.test(path);

// Pages that list or show editorial posts (M11-F): dropped when the API's editorial epoch changes.
const EDITORIAL_PATHS = /^\/(?:$|guias(?:\/.*)?$|deportes\/futbol(?:\/.*)?$)/;
export const isEditorialPath = (path) => EDITORIAL_PATHS.test(path);
