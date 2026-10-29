import type { EntityBroadcast } from '../services/EntityBroadcastService';
import type { ProgrammeSeo } from '../services/ProgrammeSeoPolicy';
import type { WorkSeo } from '../services/WorkSeoPolicy';

export type CatalogSource = 'program' | 'tmdb';
export type CatalogContentType = 'movie' | 'series' | 'program';
export type CatalogAvailability =
  | 'live'
  | 'streaming'
  | 'free'
  | 'flatrate'
  | 'rent'
  | 'buy';

export interface CatalogPlatformDTO {
  key: string;
  name: string;
  tmdbProviderId: number;
  color: string;
  logoUrl?: string;
  supportedAvailability: CatalogAvailability[];
}

export interface CatalogProviderDTO {
  id: number;
  name: string;
  logoUrl: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free';
  price?: string;
  deepLink?: string;
}

export interface CatalogAssetRefDTO {
  kind: 'poster' | 'backdrop' | 'channelLogo' | 'platformLogo';
  role: 'primary' | 'fallback';
  source: 'epg_program_image' | 'tmdb_poster' | 'tmdb_backdrop' | 'channel_icon' | 'platform_logo';
  url: string;
}

export interface CatalogAssetSetDTO {
  primary?: CatalogAssetRefDTO;
  poster?: CatalogAssetRefDTO;
  backdrop?: CatalogAssetRefDTO;
  channelLogo?: CatalogAssetRefDTO;
  platformLogo?: CatalogAssetRefDTO;
  fallbackChain: CatalogAssetRefDTO[];
}

export interface CatalogSourceProvenanceDTO {
  schedule: string[];
  metadata: string[];
  assets: string[];
  titleSource?: string;
}

export interface CatalogTimingContextDTO {
  start?: string;
  end?: string;
  liveNow: boolean;
  window?: 'now' | 'today' | 'tonight' | 'unknown';
}

export interface CatalogChannelDTO {
  id: string;
  name: string;
  icon?: string;
  normalizedName?: string;
  aliases?: string[];
  sourceIds?: string[];
  type?: string;
  region?: string;
}

export interface CatalogAiringDTO {
  channelId: string;
  /** M10: the channel's canonical slug source (`/canales/discovery`, not the `dmax` id). */
  channelNormalizedName?: string;
  channelName: string;
  channelIcon?: string;
  start: string;
  end: string;
  /** Title of the program actually airing in this slot — required so the
   * frontend can show "what's on" instead of repeating the channel name. */
  title: string;
  /** Catalog id + friendly detail path for this specific airing's own
   * program page, so links resolve to `/programas/<slug>` instead of a
   * raw `program:<id>` fallback URL. */
  catalogId: string;
  detailPath: string;
  /** M10: verified work page of this airing's programme (absent unless proven). */
  workPath?: string;
  liveNow?: boolean;
  /** Program poster/still, when the EPG source has one — without it, airing
   * cards on the detail page rendered as plain text-only boxes. */
  image?: string;
}

export interface CatalogUserInteractionDTO {
  status?: string;
  rating?: number;
  liked?: boolean;
  inWatchlist: boolean;
  lists: string[];
  watchedAt?: string;
}

export interface CatalogWhereToWatchDTO {
  flatrate: CatalogProviderDTO[];
  rent: CatalogProviderDTO[];
  buy: CatalogProviderDTO[];
  free: CatalogProviderDTO[];
  tmdbLink: string;
}

export interface CatalogItemDTO {
  catalogId: string;
  source: CatalogSource;
  contentType: CatalogContentType;
  title: string;
  slug: string;
  detailPath: string;
  /** M10, programme-sourced items only: the verified work page of this airing (absent unless proven). */
  workPath?: string;
  /**
   * M10-C, TMDB catalogue items: true when the work page for this title is known not to show this work (its slug
   * answered 404 within the last 6 h, or resolves locally to another TMDB id). Cards then link nothing.
   */
  workPathUnresolved?: true;
  /**
   * M10, TMDB work detail: the `/programas/:slug` broadcast page resolving to this same TMDB id (absent unless proven, and
   * since M10-B absent when that page declares this work page canonical). M10-B, programme airing detail: the
   * programme's own page when it is indexed under its own URL (`standalone`).
   */
  programmePath?: string;
  subtitle?: string;
  synopsis?: string;
  image?: string;
  backdrop?: string;
  assets?: CatalogAssetSetDTO;
  sourceProvenance?: CatalogSourceProvenanceDTO;
  timingContext?: CatalogTimingContextDTO;
  genres: string[];
  tmdbId?: number;
  rating?: number;
  releaseYear?: number;
  durationMinutes?: number;
  /** TMDB detail only, and only when it differs from `title`. */
  originalTitle?: string;
  start?: string;
  end?: string;
  liveNow?: boolean;
  primaryPlatforms: string[];
  whereToWatch?: CatalogWhereToWatchDTO;
  channel?: CatalogChannelDTO;
  airings?: CatalogAiringDTO[];
  /** Programme-sourced detail only: the channel's other upcoming programmes, never airings of this work. */
  channelAirings?: CatalogAiringDTO[];
  userInteraction?: CatalogUserInteractionDTO;
}

/**
 * Phase 3E: verified additions to a legacy detail page, present only while `CONTENT_LEGACY_ENRICHMENT_ENABLED` serves
 * that page and only for the parts whose identity check passed. It never replaces a field of the legacy payload.
 */
export interface CatalogLegacyEnrichmentDTO {
  version: 1;
  /** Verified catalogue facts the legacy payload lacks (each present only when the legacy value is absent). */
  metadata?: { originalTitle?: string; runtimeMinutes?: number; genres?: string[] };
  /** Upcoming broadcasts of this work in the next days, on catalogue-row evidence. Absent when the schedule could not be read (nothing is claimed either way). */
  broadcasts?: {
    status: 'ok' | 'none';
    windowDays: number;
    generatedAt: string;
    timeZone: 'Europe/Madrid';
    items: EntityBroadcast[];
  };
  /** Required notice where TMDB-sourced metadata is shown, with the date the catalogue row was last filled from TMDB. */
  attribution?: { notice: string; updatedAt: string };
}

export interface CatalogDetailDTO extends CatalogItemDTO {
  enrichment?: CatalogLegacyEnrichmentDTO;
  cast?: Array<{ name: string; character?: string; profile?: string }>;
  director?: string;
  related?: CatalogItemDTO[];
  socialSummary?: {
    friendsWhoWatched: number;
    avgFriendRating?: number;
  };
  /** true when `related`/`socialSummary`/`whereToWatch`/`userInteraction` were
   * intentionally left out of this response to keep it on the fast path —
   * fetch them via `GET /catalog/:catalogId/enrichment`. Absent (not `false`)
   * on a response that already carries the full payload. */
  enrichmentPending?: boolean;
  /** M09-B, `/programas/:slug` lookups only: the canonical and robots the page declares. */
  seo?: ProgrammeSeo | WorkSeo;
}

/** Secondary, deferrable detail data: never required to render the main
 * page, always safe to fetch after the critical response and merge in. */
export interface CatalogDetailEnrichmentDTO {
  related: CatalogItemDTO[];
  socialSummary?: {
    friendsWhoWatched: number;
    avgFriendRating?: number;
  };
  whereToWatch?: CatalogWhereToWatchDTO;
  userInteraction?: CatalogUserInteractionDTO;
}

export interface CatalogQueryResultDTO {
  items: CatalogItemDTO[];
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  availableGenres: string[];
  availablePlatforms: CatalogPlatformDTO[];
}

export interface CatalogSuggestionDTO {
  catalogId: string;
  source: CatalogSource;
  contentType: CatalogContentType;
  title: string;
  slug: string;
  detailPath: string;
  subtitle?: string;
  image?: string;
  primaryPlatforms: string[];
}

export const CATALOG_PLATFORM_REGISTRY: CatalogPlatformDTO[] = [
  {
    key: 'netflix',
    name: 'Netflix',
    tmdbProviderId: 8,
    color: '#E50914',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'prime-video',
    name: 'Prime Video',
    tmdbProviderId: 119,
    color: '#00A8E1',
    supportedAvailability: ['streaming', 'flatrate', 'rent', 'buy'],
  },
  {
    key: 'disney-plus',
    name: 'Disney+',
    tmdbProviderId: 337,
    color: '#113CCF',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'max',
    name: 'HBO Max',
    tmdbProviderId: 1899,
    color: '#2962FF',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'movistar-plus',
    name: 'Movistar+',
    tmdbProviderId: 149,
    color: '#00C6FF',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'skyshowtime',
    name: 'SkyShowtime',
    tmdbProviderId: 1773,
    color: '#1D9BF0',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'apple-tv-plus',
    name: 'Apple TV+',
    tmdbProviderId: 350,
    color: '#A3A3A3',
    supportedAvailability: ['streaming', 'flatrate', 'rent', 'buy'],
  },
  {
    key: 'filmin',
    name: 'Filmin',
    tmdbProviderId: 63,
    color: '#00D1B2',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'rtve-play',
    name: 'RTVE Play',
    tmdbProviderId: 541,
    color: '#F59E0B',
    supportedAvailability: ['streaming', 'free'],
  },
  {
    key: 'atresplayer',
    name: 'ATRESplayer',
    tmdbProviderId: 581,
    color: '#F97316',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'mitele',
    name: 'Mitele',
    tmdbProviderId: 613,
    color: '#EC4899',
    supportedAvailability: ['streaming', 'flatrate'],
  },
  {
    key: 'pluto-tv',
    name: 'Pluto TV',
    tmdbProviderId: 300,
    color: '#9333EA',
    supportedAvailability: ['streaming', 'free'],
  },
  {
    key: 'rakuten-tv',
    name: 'Rakuten TV',
    tmdbProviderId: 35,
    color: '#EF4444',
    supportedAvailability: ['streaming', 'rent', 'buy'],
  },
];

export const CATALOG_PLATFORM_NAME_MAP = new Map(
  CATALOG_PLATFORM_REGISTRY.map((platform) => [platform.name.toLowerCase(), platform])
);
// Pre-rebrand name, kept so old ?platform=Max links and stored preferences still resolve.
CATALOG_PLATFORM_NAME_MAP.set('max', CATALOG_PLATFORM_NAME_MAP.get('hbo max')!);
