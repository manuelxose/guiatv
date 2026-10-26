import { CatalogItem } from '../services/catalog.service';
import { TvReadItemDTO } from '../api/models';
import { buildDetailPath, CatalogContentType, slugifyTitle } from './catalog';
import { APP_PATHS, channelCanonicalPath } from '../config/route-map';
import { formatMadridHM } from './madrid-time';

// The five verticals the design system's accent tokens key off
// (--accent-live/discover/streaming/sports/editorial). See
// docs/visual-directions.md, Direction 3 "Hybrid Signal", §"Card / component
// treatment" and apps/frontend/src/styles/_card-accent.scss.
export type CardVertical = 'live' | 'discover' | 'streaming' | 'sports' | 'editorial';

export interface UnifiedCardData {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  channelName: string;
  channelId: string;
  channelPath: string;
  channelIcon: string;
  startTime: string;
  endTime: string;
  liveNow: boolean;
  category: string;
  platforms: string[];
  sport: string;
  detailPath: string;
  badges: string[];
  progressPercent: number;
  contentType: CatalogContentType;
  vertical: CardVertical;
}

export function isTvReadItem(item: TvReadItemDTO | CatalogItem | null | undefined): item is TvReadItemDTO {
  return Boolean(item && 'airing' in item && 'program' in item && 'channel' in item);
}

/**
 * Derives the card's wayfinding vertical from signals already present on the
 * normalized card data — no separate/parallel data shape. `live` (on-air now)
 * takes priority over `sports` (a live sports airing reads as "live", not
 * "sports"), which takes priority over `streaming` (has a platform to watch
 * on), falling back to `discover` for everything else. Editorial content
 * doesn't flow through here — EditorialCard's vertical is always 'editorial'.
 */
export function resolveVertical(params: {
  liveNow?: boolean;
  category?: string;
  sport?: string;
  platforms?: string[];
}): CardVertical {
  if (params.liveNow) {
    return 'live';
  }
  if (params.sport || params.category === 'Deportes') {
    return 'sports';
  }
  if (params.platforms && params.platforms.length) {
    return 'streaming';
  }
  return 'discover';
}

export function normalizeToCard(item: TvReadItemDTO | CatalogItem): UnifiedCardData {
  if (isTvReadItem(item)) {
    const category = normalizeCategory(item.program.editorialCategory || item.program.genre);
    const contentType = resolveTvContentType(category);
    const liveNow = Boolean(item.airing.liveNow || item.timingContext?.liveNow);
    const sport = String(item.program.sportFacet || '').trim();
    const platforms = item.availability.streaming ? ['Streaming'] : [];
    return {
      id: item.id,
      title: String(item.program.title || 'Sin título').trim(),
      subtitle: buildTvSubtitle(item),
      description: String(item.program.description || '').trim(),
      image: resolveTvImage(item),
      channelName: String(item.channel.name || '').trim(),
      channelId: String(item.channel.id || '').trim(),
      channelPath: item.channel.id ? channelCanonicalPath(item.channel, item.channel.id) : '',
      channelIcon: String(item.assets.channelLogo?.url || item.channel.icon || '').trim(),
      startTime: item.airing.start,
      endTime: item.airing.end,
      liveNow,
      category,
      platforms,
      sport,
      // M10: the API-verified work page first; then the airing's own page; older cached responses fall back to the channel.
      detailPath: item.program.workPath || item.detailPath || (item.channel.id ? channelCanonicalPath(item.channel, item.channel.id) : APP_PATHS.guide),
      badges: buildTvBadges(item, category),
      progressPercent: computeProgress(item.airing.start, item.airing.end),
      contentType,
      vertical: resolveVertical({ liveNow, category, sport, platforms }),
    };
  }

  const contentType = item.contentType || 'program';
  const category = normalizeCategory(item.genres?.[0] || item.contentType || '');
  const liveNow = Boolean(item.liveNow);
  const platforms = item.primaryPlatforms || [];
  return {
    id: String(item.catalogId || item.title || 'content').trim(),
    title: String(item.title || 'Sin título').trim(),
    subtitle: buildCatalogSubtitle(item),
    description: String(item.synopsis || '').trim(),
    image: String(item.backdrop || item.image || '').trim(),
    channelName: String(item.channel?.name || '').trim(),
    channelId: String(item.channel?.id || '').trim(),
    channelPath: item.channel?.id ? channelCanonicalPath(item.channel, item.channel.id) : '',
    channelIcon: String(item.channel?.icon || '').trim(),
    startTime: String(item.start || '').trim(),
    endTime: String(item.end || '').trim(),
    liveNow,
    category,
    platforms,
    sport: '',
    // TMDB movie/series paths are derived from the title so a stale cached
    // detailPath (pre-transliteration) can never resurface; program paths and
    // programme-sourced films/series keep the API's known airing destination.
    detailPath:
      contentType === 'program' || item.source === 'program'
        ? item.workPath || item.detailPath || (item.channel?.id ? channelCanonicalPath(item.channel, item.channel.id) : APP_PATHS.guide)
        : resolvableWorkPath(contentType, item.title),
    badges: buildCatalogBadges(item),
    progressPercent: computeProgress(item.start, item.end),
    contentType,
    vertical: resolveVertical({ liveNow, category, platforms }),
  };
}

/**
 * M10: a title with no Latin letters or digits ("चार यार") has an empty slug and used to link `/series/sin-titulo`,
 * a 404 shared by every such title. No link then (`''` renders the card without an href). Other titles keep the
 * existing slug: the page also resolves punctuation variants through its TMDB search, which the client cannot predict.
 */
export function resolvableWorkPath(contentType: CatalogContentType, title: string): string {
  return slugifyTitle(title) ? buildDetailPath(contentType, title, slugifyTitle) : '';
}

export function normalizeCategory(value: unknown): string {
  const safe = String(value || '').trim();
  if (!safe) {
    return 'Contenido';
  }
  if (/cine|pel[ií]cula|^movie$/i.test(safe)) return 'Cine';
  if (/serie/i.test(safe)) return 'Series';
  if (/deporte|f[úu]tbol|baloncesto|tenis|motogp|f1/i.test(safe)) return 'Deportes';
  if (/infantil|kids/i.test(safe)) return 'Infantil';
  if (/noticia/i.test(safe)) return 'Noticias';
  return safe;
}

export function computeProgress(start?: string | null, end?: string | null, reference = new Date()): number {
  const startMs = start ? new Date(start).getTime() : Number.NaN;
  const endMs = end ? new Date(end).getTime() : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const ratio = ((reference.getTime() - startMs) / (endMs - startMs)) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

function resolveTvImage(item: TvReadItemDTO): string {
  return String(
    item.assets.poster?.url ||
      item.assets.backdrop?.url ||
      item.assets.primary?.url ||
      item.assets.channelLogo?.url ||
      item.channel.icon ||
      ''
  ).trim();
}

function resolveTvContentType(category: string): CatalogContentType {
  if (category === 'Cine') return 'movie';
  if (category === 'Series') return 'series';
  return 'program';
}

function buildTvSubtitle(item: TvReadItemDTO): string {
  const parts = [
    item.channel.name,
    item.program.sportFacet,
    formatTimeRange(item.airing.start, item.airing.end),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return parts.join(' · ');
}

// Platform names are deliberately left out here — the card already renders
// them as their own colored badges (see `card.platforms` / `<app-platform-
// badge>` in unified-program-card.component.html), and printing the same
// two names again as plain text right above those badges was a duplicate,
// unstyled restatement of the same information.
function buildCatalogSubtitle(item: CatalogItem): string {
  const parts = [item.channel?.name, formatTimeRange(item.start, item.end), item.releaseYear]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return parts.join(' · ');
}

function buildTvBadges(item: TvReadItemDTO, category: string): string[] {
  const badges = new Set<string>();
  if (item.airing.liveNow) badges.add('LIVE');
  if (item.program.sportFacet) badges.add(item.program.sportFacet);
  if (category) badges.add(category);
  if (item.availability.streaming) badges.add('Streaming');
  return Array.from(badges);
}

// These render as the small overlay chips on the poster image itself
// (`.program-card__badge`, top-left over the artwork) — kept intentionally
// minimal (just LIVE + channel, when relevant) because everything else this
// used to add here already has its own, better-styled place on the card:
// content type ("Serie"/"Película") is in the eyebrow row right under the
// title, and the platform is a full logo badge in the meta row — repeating
// either as a second, plainer chip on the poster was pure duplication.
function buildCatalogBadges(item: CatalogItem): string[] {
  const badges = new Set<string>();
  if (item.liveNow) badges.add('LIVE');
  if (item.channel?.name) badges.add(item.channel.name);
  return Array.from(badges);
}

function formatTimeRange(start?: string | null, end?: string | null): string {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  if (!startLabel && !endLabel) {
    return '';
  }
  if (!startLabel) {
    return endLabel;
  }
  if (!endLabel) {
    return startLabel;
  }
  return `${startLabel} - ${endLabel}`;
}

function formatTime(value?: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatMadridHM(date);
}
