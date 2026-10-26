/**
 * How a legacy catalogue payload and its (optional, Phase 3E) verified enrichment combine on screen. Pure.
 * The legacy item is never replaced: gaps are filled for display and structured data only, and the schedule
 * list holds the verified broadcasts plus any legacy airing the verification did not confirm, so nothing
 * the page listed before disappears. The channel's other programmes are a separate list.
 */
import type { CatalogItem } from '../services/catalog.service';
import { EntityBroadcast, EntityBroadcasts, GUIDE_TIME_ZONE } from '../pages/entity-detail/entity-detail.model';
import { channelCanonicalPath } from '../config/route-map';

type Airing = NonNullable<CatalogItem['airings']>[number];

/** The item with the verified genres / runtime filled in where the legacy payload has none. Same object when there is nothing to add. */
export function fillLegacyGaps(item: CatalogItem): CatalogItem {
  const meta = item.enrichment?.metadata;
  if (!meta) return item;
  const genres = !item.genres?.length && meta.genres?.length ? meta.genres : item.genres;
  const durationMinutes = item.durationMinutes === undefined && meta.runtimeMinutes ? meta.runtimeMinutes : item.durationMinutes;
  return genres === item.genres && durationMinutes === item.durationMinutes ? item : { ...item, genres, durationMinutes };
}

export interface ScheduleView {
  /** This work's current and upcoming airings for the broadcast list: the verified ones plus every legacy airing they do not contain, by start. */
  broadcasts: EntityBroadcasts;
  /** Programme-sourced pages only: the channel's other current or upcoming programmes. Never airings of this work. */
  channel: Airing[];
}

const slot = (channelId: string, start: string) => `${channelId}|${Date.parse(start)}`;
const madridTime = new Intl.DateTimeFormat('es-ES', { timeZone: GUIDE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: GUIDE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** A legacy airing in the broadcast list's shape (the API already sends Madrid wall-clock fields for verified ones). */
export function airingAsBroadcast(airing: Airing): EntityBroadcast {
  const start = new Date(airing.start);
  return {
    airingId: slot(airing.channelId, airing.start),
    channel: { id: airing.channelId, name: airing.channelName, icon: airing.channelIcon, path: channelCanonicalPath({ normalizedName: airing.channelNormalizedName }, airing.channelId) },
    programmeTitle: airing.title,
    start: airing.start,
    end: airing.end,
    startLocal: airing.start,
    localDate: madridDate.format(start),
    localTime: madridTime.format(start),
    durationMinutes: Math.max(0, Math.round((Date.parse(airing.end) - start.getTime()) / 60_000)),
  };
}

const currentAndUpcoming = <T extends { start: string; end: string }>(airings: readonly T[] | undefined, now: number): T[] =>
  (airings ?? []).filter((airing) => Number.isFinite(Date.parse(airing.start)) && Date.parse(airing.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

export function scheduleView(item: CatalogItem, now: number = Date.now()): ScheduleView {
  const enriched = item.enrichment?.broadcasts;
  const verified = enriched && enriched.status !== 'unavailable' && item.contentType !== 'program' ? enriched : null;
  const known = new Set((verified?.items ?? []).map((b) => slot(b.channel.id, b.start)));
  const legacy = currentAndUpcoming(item.airings, now).filter((a) => !known.has(slot(a.channelId, a.start))).map(airingAsBroadcast);
  const items = [...(verified?.items ?? []), ...legacy].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return {
    broadcasts: { status: items.length ? 'ok' : enriched?.status === 'unavailable' ? 'unavailable' : 'none', items, generatedAt: verified?.generatedAt ?? new Date(now).toISOString(), timeZone: GUIDE_TIME_ZONE },
    channel: currentAndUpcoming(item.channelAirings, now),
  };
}
