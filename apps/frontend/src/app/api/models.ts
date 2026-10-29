// API contracts aligned with backend/README_api.md (v2)
export type DateAlias = 'yesterday' | 'today' | 'tomorrow' | 'after_tomorrow' | string; // YYYYMMDD also allowed

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, any>;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ChannelMetaDTO {
  id: string;
  name: string;
  normalizedName?: string;
  aliases?: string[];
  sourceIds?: string[];
  icon?: string | null;
  type?: string;
  group?: string;
  subgroups?: string[];
  sortOrder?: number;
  country?: string;
  countryCode?: string;
  region?: string;
  description?: string;
  distribution?: 'terrestrial' | 'cable' | 'operator' | 'ott' | 'unknown';
  access?: 'free' | 'pay' | 'unknown';
  operator?: string;
  providers?: string[];
  contentFacets?: string[];
  market?: {
    country: string;
    countryCode: string;
    region: string;
    scope: 'national' | 'regional' | 'international' | 'unknown';
  };
  quality?: {
    resolution: 'sd' | 'hd' | 'uhd' | '4k' | 'unknown';
    timeshift: boolean | 'unknown';
  };
  capabilities?: {
    linear: boolean | 'unknown';
    catchup: boolean | 'unknown';
    streaming: boolean | 'unknown';
  };
  provenance?: {
    classification: 'registry' | 'heuristic' | 'unknown';
    sourceIds: string[];
  };
}

export interface TvReadAssetRefDTO {
  kind: 'poster' | 'backdrop' | 'channelLogo' | 'platformLogo';
  role: 'primary' | 'fallback';
  source: string;
  url: string;
}

export interface TvReadAssetSetDTO {
  primary?: TvReadAssetRefDTO;
  poster?: TvReadAssetRefDTO;
  backdrop?: TvReadAssetRefDTO;
  channelLogo?: TvReadAssetRefDTO;
  platformLogo?: TvReadAssetRefDTO;
  fallbackChain: TvReadAssetRefDTO[];
  candidates?: TvReadAssetRefDTO[];
}

export interface TvReadProgramDTO {
  brandKey: string;
  title: string;
  subtitle?: string;
  normalizedTitle: string;
  titleAliases: string[];
  editorialCategory: string;
  genre?: string;
  subgenre?: string;
  sportFacet?: 'Fútbol' | 'Baloncesto' | 'F1' | 'Tenis' | 'MotoGP' | 'Más';
  tmdbId?: number;
  /** M10: verified `/peliculas|/series` work page; absent unless the API proved the identity. */
  workPath?: string;
  description?: string;
  titleResolutionState?:
    | 'specific_source_title'
    | 'specific_from_registry'
    | 'specific_from_manual_override'
    | 'generic_unresolved'
    | 'generic_suppressed';
  isResolvedTitle?: boolean;
}

export interface TvReadAiringDTO {
  id: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  liveNow: boolean;
  partOfDay: 'madrugada' | 'manana' | 'tarde' | 'noche';
  timeSlotKey: string;
}

export interface TvReadItemDTO {
  id: string;
  channel: ChannelMetaDTO;
  program: TvReadProgramDTO;
  airing: TvReadAiringDTO;
  assets: TvReadAssetSetDTO;
  availability: {
    live: boolean;
    catchup: boolean;
    streaming: boolean;
  };
  sourceProvenance: {
    schedule: string[];
    metadata: string[];
    assets: string[];
  };
  timingContext: {
    start?: string;
    end?: string;
    liveNow: boolean;
    window?: 'now' | 'today' | 'tonight' | 'unknown';
  };
  relevance: {
    score: number;
    reason: string;
  };
  trustDecision?: {
    confidence: 'high' | 'medium' | 'low';
    sourceAgreement: 'merged' | 'primary_only' | 'secondary_only' | 'single_source';
    featuredSuppressed: boolean;
    consumerSuppressed?: boolean;
    suppressionReason?: string;
    reasons: string[];
  };
  /** This airing's own page (`/contenido/program:<id>`, noindex); cards prefer `program.workPath` when present. */
  detailPath?: string;
}

export interface TvReadChannelSummaryDTO {
  channel: ChannelMetaDTO;
  current?: TvReadItemDTO;
  next?: TvReadItemDTO;
  tonight?: TvReadItemDTO[];
  counts: {
    total: number;
    live: number;
    tonight: number;
  };
}

export type TvReadView = 'now' | 'next' | 'night' | 'day' | 'search';

export interface TvReadResponseDTO {
  date: string;
  view: TvReadView;
  items: TvReadItemDTO[];
  channels: TvReadChannelSummaryDTO[];
  filters: {
    group?: string;
    category?: string;
    sport?: string;
    channelId?: string;
    q?: string;
  };
  meta: {
    total: number;
    limit: number;
    nextCursor?: string;
    cached?: boolean;
    generatedAt: string;
  };
}

export interface TvReadChannelsResponseDTO {
  date: string;
  group?: string;
  channels: TvReadChannelSummaryDTO[];
  meta: {
    total: number;
    cached?: boolean;
    generatedAt: string;
  };
}

export interface TvReadScheduleResponseDTO {
  date: string;
  group?: string;
  channels: Array<{
    channel: ChannelMetaDTO;
    items: TvReadItemDTO[];
    counts: { total: number; returned: number; complete: boolean };
  }>;
  meta: {
    totalChannels: number;
    totalItems: number;
    itemsPerChannel: number;
    truncatedChannels: number;
    cached?: boolean;
    generatedAt: string;
  };
}

export interface TvReadItemResponseDTO {
  item: TvReadItemDTO;
  relatedChannelItems: TvReadItemDTO[];
  meta: {
    cached?: boolean;
    generatedAt: string;
  };
}

export interface TvGuideSurfaceDTO {
  date: string;
  filters: {
    group?: string;
    category?: string;
    sport?: string;
  };
  nowItems: TvReadItemDTO[];
  nextItems: TvReadItemDTO[];
  nightItems: TvReadItemDTO[];
  channels: TvReadChannelSummaryDTO[];
  meta: {
    totalChannels: number;
    totalItems: number;
    group?: string;
    category?: string;
    sport?: string;
    primeTimeWindowStart: string;
    primeTimeWindowEnd: string;
    groupOrder: string[];
    availableSports?: Array<'Fútbol' | 'Baloncesto' | 'F1' | 'Tenis' | 'MotoGP' | 'Más'>;
    groupCounts: Record<string, number>;
    generatedAt: string;
    cached?: boolean;
  };
}

export interface TvChannelSurfaceDTO {
  date: string;
  channel: ChannelMetaDTO | null;
  /** M10-C: `channel` is a verified second feed of this channel, whose page is the canonical one. */
  canonicalChannel?: { id: string; name?: string; normalizedName: string };
  current?: TvReadItemDTO;
  next?: TvReadItemDTO;
  tonightItems: TvReadItemDTO[];
  scheduleItems: TvReadItemDTO[];
  relatedChannels: TvReadChannelSummaryDTO[];
  meta: {
    totalItems: number;
    generatedAt: string;
    cached?: boolean;
  };
}

export interface TimeSlotDTO {
  index: number; // 0-7
  start: string; // "00:00"
  end: string; // "03:00"
  startMinutes: number;
  endMinutes: number;
}

export interface ProgramLayoutDTO {
  id: string;
  channelId: string;
  channelName?: string;
  channelIcon?: string;
  title: string | { value: string; lang?: string };
  start: string;
  end: string;
  durationMinutes: number;
  category?: string;
  editorialCategory?: string;
  image?: string;
  poster?: string;
  background?: string;
  rating?: string;
  tmdbId?: number;
  description?: string;
  timeSlotIndex: number | null;
  gridColumnStart: number;
  gridColumnEnd: number;
  columnStartMinutes?: number;
  columnEndMinutes?: number;
  layerIndex: number;
  isCutAtStart: boolean;
  isCutAtEnd: boolean;
  visibleStartTime: string;
  visibleEndTime: string;
  crossesMidnight: boolean;
  pxStart?: number;
  pxWidth?: number;
  fieldsProvided?: 'minimal' | 'full';
  liveNow?: boolean;
  groupKey?: string;
  assets?: TvReadAssetSetDTO;
  sourceProvenance?: TvReadItemDTO['sourceProvenance'];
  timingContext?: TvReadItemDTO['timingContext'];
  layoutsBySlot?: Array<{
    timeSlotIndex: number;
    gridColumnStart: number;
    gridColumnEnd: number;
    layerIndex?: number;
    isCutAtStart?: boolean;
    isCutAtEnd?: boolean;
    visibleStartTime?: string;
    visibleEndTime?: string;
    crossesMidnight?: boolean;
    pxStart?: number;
    pxWidth?: number;
    columnStartMinutes?: number;
    columnEndMinutes?: number;
  }>;
}

export interface LayoutsResponse {
  date: string;
  timeSlots: TimeSlotDTO[];
  channels: Array<{
    channel: ChannelMetaDTO;
    programs: ProgramLayoutDTO[];
  }>;
}

export interface ProgramsResponse {
  date: string;
  timeSlots: TimeSlotDTO[];
  channels: ChannelMetaDTO[];
  programs: ProgramLayoutDTO[];
}

export interface ProgramResponse {
  program: ProgramLayoutDTO;
}

export interface ScheduleResponse {
  date: string;
  channels: Array<{
    channel: ChannelMetaDTO;
    programs: ProgramLayoutDTO[];
  }>;
}

export interface ScheduleChannelsSummary {
  date: string;
  channels: Array<{
    channel: Pick<ChannelMetaDTO, 'id' | 'name'>;
    programCount: number;
    firstProgram?: { title: string; start: string };
    lastProgram?: { title: string; end: string };
  }>;
}

export interface NowPlayingResponse {
  programs: Array<{
    id: string;
    channelId: string;
    title: string;
    start: string;
    end: string;
    isLive: boolean;
  }>;
  timestamp: string;
}

export interface ProgramsQuery {
  date: DateAlias;
  channels?: string[];
  timeSlot?: string;
  fields?: 'minimal' | 'full';
  page?: number;
  limit?: number;
  country?: string;
  channelTypes?: string[];
}

export interface LayoutsQuery {
  channels?: string[];
  timeSlot?: string;
  fields?: 'minimal' | 'full';
  channelTypes?: string[];
}
