/**
 * M10-C: channels that are a second XMLTV feed of a channel GuíaTV already publishes.
 *
 * The EPG provider ships one channel in two feeds: `Telemadrid.es` (name "Telemadrid") and `Telemadrid.TV` (name
 * "Telemadrid.TV"). Ingestion keeps them as two channels (their names and aliases differ), so the site served
 * `/canales/telemadrid` and `/canales/telemadrid-tv`, both indexable with their own canonical, for one channel.
 *
 * A channel is a feed alias of another only when all of this holds:
 *  1. persistent identifiers: it carries a `<Key>.TV` source id and no `.es` one, and exactly one other channel of the
 *     directory carries `<Same key>.es` (keys compared without accents, case or separators), or the `.es` key that
 *     FEED_KEY_EQUIVALENTS names for it (reviewed pairs whose two feeds spell the channel differently);
 *  2. the same schedule: at least MIN_SHARED of its airings, and at least half of them, have an airing of the other
 *     channel with the same title key starting within SLOT_TOLERANCE_MS.
 * A `-tv` suffix alone proves nothing ("Aragón TV", "Andalucía TV" and "CMM TV" are channel names), and a pair that
 * fails either check stays two channels. Nothing is written: schedules, history and the API keep both channels.
 */
import type { TvReadQueryService } from './TvReadQueryService';
import type { TvReadItemDTO } from '../dto/TvReadDTO';
import { normalizeTvToken } from '../../shared/utils/tvMetadata';
import { logger } from '../../shared/utils/logger';

const log = logger.child('ChannelFeedAliases');

export const MIN_SHARED = 3;
export const SLOT_TOLERANCE_MS = 10 * 60_000;
const TTL_MS = 10 * 60_000;
const RETRY_MS = 60_000;

export interface FeedChannel {
  id: string;
  name?: string;
  normalizedName?: string;
  sourceIds?: string[];
}

export interface FeedAliasTarget {
  id: string;
  name?: string;
  normalizedName: string;
}

type ScheduleItem = Pick<TvReadItemDTO, 'airing' | 'program'>;

/**
 * `.TV` key -> `.es` key of the same channel where the provider spells them differently. Each pair was reviewed on
 * the production schedules of 2026-10-29 (same title within 10 minutes for 93-100 % of the `.TV` airings,
 * docs/roadmap/M10C-DELIVERY.md); rule 2 still has to hold every day. Deliberately absent: `TeleMadridInt.TV` (61 %
 * shared with Telemadrid, another channel) and `CMM TV` (95 % with "Castilla la Mancha TV", but a brand name of its
 * own: which URL is canonical is the owner's call).
 */
export const FEED_KEY_EQUIVALENTS: Readonly<Record<string, string>> = {
  canarias: 'tvcanaria',
  extremadura: 'canalextremadura',
  tvgal: 'tvgtvgalicia',
  '7rm': '7tvregionmurcia',
  etbsat: 'eitbbasque',
};

const compact = (value: string) => normalizeTvToken(value, ' ').replace(/\s+/g, '');

/** Feed keys of a channel for one feed suffix: `Telemadrid.TV` -> `telemadrid` for `tv`. */
export function feedKeys(channel: FeedChannel, feed: 'tv' | 'es'): string[] {
  const keys = new Set<string>();
  for (const id of channel.sourceIds ?? []) {
    const m = /^(.+)\.(tv|es)$/i.exec(String(id || '').trim());
    if (m && m[2].toLowerCase() === feed) {
      const key = compact(m[1]);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

/** Identity half (rule 1): alias channel id -> the one channel carrying the `.es` id with the same key. */
export function feedAliasCandidates(channels: readonly FeedChannel[]): Map<string, FeedChannel> {
  const byEsKey = new Map<string, FeedChannel[]>();
  for (const channel of channels) {
    for (const key of feedKeys(channel, 'es')) (byEsKey.get(key) ?? byEsKey.set(key, []).get(key)!).push(channel);
  }
  const out = new Map<string, FeedChannel>();
  for (const channel of channels) {
    const tv = feedKeys(channel, 'tv').flatMap((key) => (FEED_KEY_EQUIVALENTS[key] ? [key, FEED_KEY_EQUIVALENTS[key]] : [key]));
    if (!tv.length || feedKeys(channel, 'es').length) continue;
    const targets = new Map<string, FeedChannel>();
    for (const key of tv) for (const t of byEsKey.get(key) ?? []) if (t.id !== channel.id) targets.set(t.id, t);
    if (targets.size === 1) out.set(channel.id, [...targets.values()][0]);
  }
  return out;
}

/** Schedule half (rule 2): the alias's airings are the other channel's airings. */
export function schedulesAgree(alias: readonly ScheduleItem[], target: readonly ScheduleItem[]): boolean {
  const slots = new Map<string, number[]>();
  for (const item of target) {
    const key = normalizeTvToken(item.program?.title, ' ');
    const start = Date.parse(item.airing?.start ?? '');
    if (key && Number.isFinite(start)) (slots.get(key) ?? slots.set(key, []).get(key)!).push(start);
  }
  let considered = 0;
  let shared = 0;
  for (const item of alias) {
    const key = normalizeTvToken(item.program?.title, ' ');
    const start = Date.parse(item.airing?.start ?? '');
    if (!key || !Number.isFinite(start)) continue;
    considered += 1;
    if ((slots.get(key) ?? []).some((s) => Math.abs(s - start) <= SLOT_TOLERANCE_MS)) shared += 1;
  }
  return shared >= MIN_SHARED && shared * 2 >= considered;
}

type Reader = Pick<TvReadQueryService, 'getChannels' | 'getChannelDetail'>;

/**
 * Verified feed aliases of one day's channel directory, cached per instance (10 min). `resolve` waits for a fresh
 * list (the sitemap); `current` never waits (page requests): it answers the last list, stale or not, and refreshes it
 * in the background, so a page pays no directory read. Before the first list exists it answers an empty map.
 */
export class ChannelFeedAliasResolver {
  private readonly cache = new Map<string, { at: number; value: Map<string, FeedAliasTarget> }>();
  private readonly inFlight = new Map<string, Promise<Map<string, FeedAliasTarget>>>();
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly reader: Reader, private readonly now: () => number = Date.now) {}

  /** Throws when the directory cannot be read (callers decide: the sitemap keeps its last good copy). */
  resolve(date = 'today'): Promise<Map<string, FeedAliasTarget>> {
    const hit = this.cache.get(date);
    if (hit && this.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
    const running = this.inFlight.get(date);
    if (running) return running;
    const load = this.load(date)
      .then((value) => {
        this.cache.set(date, { at: this.now(), value });
        this.failedAt.delete(date);
        return value;
      }, (error) => {
        this.failedAt.set(date, this.now());
        throw error;
      })
      .finally(() => this.inFlight.delete(date));
    this.inFlight.set(date, load);
    return load;
  }

  current(date = 'today'): Map<string, FeedAliasTarget> {
    const hit = this.cache.get(date);
    const failed = this.failedAt.get(date);
    // After a failed load, page requests wait RETRY_MS before starting another one (a database incident must not
    // turn every request into a directory read).
    if ((!hit || this.now() - hit.at >= TTL_MS) && (failed === undefined || this.now() - failed >= RETRY_MS)) {
      this.resolve(date).catch((error) => log.warn('Feed aliases refresh failed; last list kept', { error: (error as Error).message }));
    }
    return hit?.value ?? new Map();
  }

  private async load(date: string): Promise<Map<string, FeedAliasTarget>> {
    const directory = await this.reader.getChannels(date);
    const channels = directory.channels.map((entry) => entry.channel);
    const verified = new Map<string, FeedAliasTarget>();
    for (const [aliasId, target] of feedAliasCandidates(channels)) {
      const [alias, canonical] = await Promise.all([
        this.reader.getChannelDetail(aliasId, date, 'day'),
        this.reader.getChannelDetail(target.id, date, 'day'),
      ]);
      // getChannelDetail matches aliases too: keep only the rows of each channel itself.
      const own = (items: TvReadItemDTO[], id: string) => items.filter((item) => item.channel?.id === id);
      if (schedulesAgree(own(alias.items, aliasId), own(canonical.items, target.id))) {
        verified.set(aliasId, { id: target.id, name: target.name, normalizedName: target.normalizedName || target.id });
      } else {
        log.info('Feed alias candidate kept as its own channel: schedules differ', { aliasId, targetId: target.id });
      }
    }
    log.info('Verified channel feed aliases', { date, count: verified.size });
    return verified;
  }
}
