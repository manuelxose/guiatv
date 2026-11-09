import { Router } from 'express';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../../domain/services/AuthService';
import { FootballController } from '../controllers/FootballController';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { errorResponse } from '../../shared/types/ApiResponse';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';

/** Every host a provider crest or a catalogue logo was observed on (2026-11-09). */
export const CREST_HOSTS: ReadonlySet<string> = new Set([
  'footballdata.io', 'crests.football-data.org', 'upload.wikimedia.org', 'thumb.wikimedia.org', 'img.uefa.com', 'mediadb.kicker.de', 'assets.dfb.de',
  'i.imgur.com', 'ssl.gstatic.com', 'encrypted-tbn0.gstatic.com', 's.hs-data.com', 'preview.redd.it', 'derivates.kicker.de',
  'i.pinimg.com',
]);

/**
 * Wikimedia originals are large and rate-limited (429 on bursts, measured 2026-11-09);
 * its standard 120px thumbnail is a small PNG served from its CDN. Returns null when the
 * URL is not a Wikimedia original (already a thumb, or another host).
 */
export function wikimediaThumb(url: string): string | null {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)/i.exec(url);
  if (!m) return null;
  const [, project, a, ab, file] = m;
  const thumbName = /\.svg$/i.test(file) ? `120px-${file}.png` : `120px-${file}`;
  return `https://upload.wikimedia.org/wikipedia/${project}/thumb/${a}/${ab}/${file}/${thumbName}`;
}

interface CrestEntry { body: Buffer | null; type: string; expiresAt: number }
const CREST_MAX_BYTES = 512 * 1024;
const CREST_CACHE_BYTES = 32 * 1024 * 1024;
const crestCache = new Map<string, CrestEntry>();
let crestCacheBytes = 0;

function rememberCrest(key: string, entry: CrestEntry): void {
  const old = crestCache.get(key);
  if (old) { crestCacheBytes -= old.body?.byteLength ?? 0; crestCache.delete(key); }
  crestCache.set(key, entry);
  crestCacheBytes += entry.body?.byteLength ?? 0;
  // shortcut: FIFO eviction of a per-process map; move to a shared cache if several instances serve crests.
  while (crestCacheBytes > CREST_CACHE_BYTES || crestCache.size > 2000) {
    const [k, v] = crestCache.entries().next().value as [string, CrestEntry];
    crestCacheBytes -= v.body?.byteLength ?? 0;
    crestCache.delete(k);
  }
}

/**
 * At most 2 upstream fetches per host at once, so a page full of crests never bursts a provider.
 * Wikimedia also rate-limits by request RATE (429 at ~20 req/s, measured 2026-11-09), so its
 * requests are spaced; with the disk copy this is paid once per crest, not per visitor.
 */
const HOST_SPACING_MS: Readonly<Record<string, number>> = { 'upload.wikimedia.org': 300 };
const hostSlots = new Map<string, number>();
const hostQueue = new Map<string, Array<() => void>>();
const hostNextStart = new Map<string, number>();
async function withHostSlot<T>(host: string, run: () => Promise<T>): Promise<T> {
  if ((hostSlots.get(host) ?? 0) >= 2) await new Promise<void>((r) => hostQueue.set(host, [...(hostQueue.get(host) ?? []), r]));
  hostSlots.set(host, (hostSlots.get(host) ?? 0) + 1);
  const spacing = HOST_SPACING_MS[host] ?? 0;
  if (spacing) {
    const start = Math.max(Date.now(), hostNextStart.get(host) ?? 0);
    hostNextStart.set(host, start + spacing);
    if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));
  }
  try {
    return await run();
  } finally {
    hostSlots.set(host, (hostSlots.get(host) ?? 1) - 1);
    const next = hostQueue.get(host)?.shift();
    if (next) next();
  }
}

async function fetchOne(url: string, fetchImpl: typeof fetch): Promise<CrestEntry & { status: number }> {
  // Wikimedia rejects anonymous/generic clients; identify the service (no personal data).
  const upstream = await fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'GuiaTV-crest-proxy/1.0 (https://guiaprogramaciontv.com)', Accept: 'image/*' } });
  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  // A rate limit is transient (retry in 2 min); anything else is remembered for 1 h.
  const fail = { body: null, type: '', status: upstream.status, expiresAt: Date.now() + (upstream.status === 429 ? 2 : 60) * 60 * 1000 };
  if (!upstream.ok || !/^image\//i.test(type)) return fail;
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.byteLength > CREST_MAX_BYTES) return fail;
  return { body, type, status: upstream.status, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
}

/**
 * Durable copy on disk: a crest is downloaded once and survives restarts and deploys,
 * so the provider is not asked again for a week of traffic after every release.
 */
const CREST_DIR = process.env.CREST_CACHE_DIR || path.join(os.tmpdir(), 'guiatv-crests');
const crestFile = (url: string) => path.join(CREST_DIR, createHash('sha256').update(url).digest('hex'));

async function readCrestFromDisk(url: string): Promise<CrestEntry | null> {
  try {
    const file = crestFile(url);
    const [body, type] = await Promise.all([fs.readFile(`${file}.img`), fs.readFile(`${file}.type`, 'utf8')]);
    return /^image\//.test(type) ? { body, type, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 } : null;
  } catch {
    return null;
  }
}

async function writeCrestToDisk(url: string, entry: CrestEntry): Promise<void> {
  if (!entry.body) return;
  try {
    await fs.mkdir(CREST_DIR, { recursive: true });
    const file = crestFile(url);
    await fs.writeFile(`${file}.img`, entry.body);
    await fs.writeFile(`${file}.type`, entry.type);
  } catch {
    // Disk is an optimisation only; the in-memory copy still serves.
  }
}

/** Fetches one crest (disk copy, then Wikimedia thumbnail, then the original); failures are cached too. */
export async function fetchCrest(url: string, fetchImpl: typeof fetch = fetch): Promise<CrestEntry> {
  const stored = await readCrestFromDisk(url);
  if (stored) return stored;
  const entry = await fetchCrestUpstream(url, fetchImpl);
  await writeCrestToDisk(url, entry);
  return entry;
}

async function fetchCrestUpstream(url: string, fetchImpl: typeof fetch): Promise<CrestEntry> {
  try {
    const host = new URL(url).hostname;
    return await withHostSlot(host, async () => {
      const thumb = wikimediaThumb(url);
      if (thumb) {
        const small = await fetchOne(thumb, fetchImpl);
        if (small.body || small.status === 429) return small;
      }
      return fetchOne(url, fetchImpl);
    });
  } catch {
    return { body: null, type: '', expiresAt: Date.now() + 2 * 60 * 1000 };
  }
}

/** Identical concurrent requests share one upstream fetch. */
const crestInflight = new Map<string, Promise<CrestEntry>>();

export const createFootballRoutes = (controller: FootballController, authService: AuthService): Router => {
  const router = Router();
  const adminAccessGuard = createAdminAccessGuard(authService);

  router.get('/home', asyncHandler(controller.home.bind(controller)));

  router.get('/matches/live', asyncHandler(controller.liveMatches.bind(controller)));
  router.get('/matches', asyncHandler(controller.matches.bind(controller)));
  router.get('/matches/:idOrSlug', asyncHandler(controller.matchDetail.bind(controller)));

  router.get('/competitions', asyncHandler(controller.competitions.bind(controller)));
  router.get('/competitions/:slug', asyncHandler(controller.competitionDetail.bind(controller)));

  router.get('/teams/:slug', asyncHandler(controller.teamDetail.bind(controller)));

  router.get('/news', asyncHandler(controller.news.bind(controller)));
  router.get('/search', asyncHandler(controller.search.bind(controller)));

  // Crest/logo proxy (M07): every crest and competition logo the public pages show is
  // served from OUR origin, so a provider that blocks hotlinking, rate-limits bursts
  // (Wikimedia 429) or serves http:// never leaves a blank badge. Only allowlisted
  // hosts are fetched, responses are size-capped, and results — including failures —
  // are cached in memory so a 404 is never re-fetched on every page view.
  router.get('/image', asyncHandler(async (req, res) => {
    let target: URL;
    try {
      target = new URL(String(req.query.url ?? ''));
    } catch {
      res.status(400).json(errorResponse('INVALID_PARAMS', 'url must be an absolute image URL'));
      return;
    }
    if (!CREST_HOSTS.has(target.hostname)) {
      res.status(400).json(errorResponse('INVALID_PARAMS', 'host not allowed'));
      return;
    }
    // We only ever upgrade to https: never fetch over plain http.
    target.protocol = 'https:';
    const key = target.href;
    let entry = crestCache.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      let pending = crestInflight.get(key);
      if (!pending) {
        pending = fetchCrest(key).finally(() => crestInflight.delete(key));
        crestInflight.set(key, pending);
      }
      entry = await pending;
      rememberCrest(key, entry);
    }
    if (!entry.body) {
      res.setHeader('cache-control', 'public, max-age=3600');
      res.status(502).end();
      return;
    }
    res.setHeader('content-type', entry.type);
    // An SVG served from our origin must never run script or load anything.
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800, immutable');
    res.status(200).end(entry.body);
  }));

  // Broadcast reconciliation overrides (admin-only, shared admin boundary).
  router.post(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.upsertBroadcastOverride.bind(controller))
  );
  router.delete(
    '/broadcasts/override',
    adminAccessGuard,
    asyncHandler(controller.clearBroadcastOverride.bind(controller))
  );

  return router;
};
