export type CanonicalChannelType =
  | 'TDT'
  | 'Cable'
  | 'Movistar'
  | 'Autonomico'
  | 'OTT';

export type CanonicalChannelGroup =
  | 'tdt'
  | 'cable'
  | 'autonomico'
  | 'movistar'
  | 'online'
  | 'deporte';

export type CanonicalChannelDistribution =
  | 'terrestrial'
  | 'cable'
  | 'operator'
  | 'ott'
  | 'unknown';

export type CanonicalChannelAccess = 'free' | 'pay' | 'unknown';

export type CanonicalChannelContentFacet =
  | 'general'
  | 'movies'
  | 'series'
  | 'documentary'
  | 'kids'
  | 'news'
  | 'sports'
  | 'music'
  | 'lifestyle'
  | 'unknown';

export interface CanonicalChannelMarket {
  country: string;
  countryCode: string;
  region: string;
  scope: 'national' | 'regional' | 'international' | 'unknown';
}

export interface CanonicalChannelQuality {
  resolution: 'sd' | 'hd' | 'uhd' | '4k' | 'unknown';
  timeshift: boolean | 'unknown';
}

export interface CanonicalChannelCapabilities {
  linear: boolean | 'unknown';
  catchup: boolean | 'unknown';
  streaming: boolean | 'unknown';
}

export interface CanonicalChannelProvenance {
  classification: 'registry' | 'heuristic' | 'unknown';
  sourceIds: string[];
}

export type TvPartOfDay =
  | 'madrugada'
  | 'manana'
  | 'tarde'
  | 'noche';

export type TvTimeWindow =
  | 'now'
  | 'next'
  | 'today'
  | 'tonight'
  | 'unknown';

export type TvTitleResolutionState =
  | 'specific_source_title'
  | 'specific_from_registry'
  | 'specific_from_manual_override'
  | 'generic_unresolved'
  | 'generic_suppressed';

export type TvSportFacet =
  | 'Fútbol'
  | 'Baloncesto'
  | 'F1'
  | 'Tenis'
  | 'MotoGP'
  | 'Más';

export type TvSportFacetKey =
  | 'all'
  | 'futbol'
  | 'baloncesto'
  | 'f1'
  | 'tenis'
  | 'motogp'
  | 'mas';

export interface ChannelIdentityInput {
  name?: string;
  sourceId?: string;
  country?: string;
  countryCode?: string;
  region?: string;
}

export interface ChannelIdentityMetadata {
  normalizedName: string;
  aliases: string[];
  sourceIds: string[];
  canonicalId: string;
  inferredType: CanonicalChannelType;
  inferredGroup: CanonicalChannelGroup;
  inferredRegion?: string;
  sortOrder: number;
  distribution: CanonicalChannelDistribution;
  access: CanonicalChannelAccess;
  operator: string;
  providers: string[];
  contentFacets: CanonicalChannelContentFacet[];
  market: CanonicalChannelMarket;
  quality: CanonicalChannelQuality;
  capabilities: CanonicalChannelCapabilities;
  provenance: CanonicalChannelProvenance;
}

export interface CatalogAssetCandidate {
  kind: 'poster' | 'backdrop' | 'channelLogo' | 'platformLogo';
  role: 'primary' | 'fallback';
  source: 'epg_program_image' | 'tmdb_poster' | 'tmdb_backdrop' | 'channel_icon' | 'platform_logo';
  url: string;
}

export interface CatalogAssetSet {
  primary?: CatalogAssetCandidate;
  poster?: CatalogAssetCandidate;
  backdrop?: CatalogAssetCandidate;
  channelLogo?: CatalogAssetCandidate;
  platformLogo?: CatalogAssetCandidate;
  candidates?: CatalogAssetCandidate[];
  fallbackChain: CatalogAssetCandidate[];
}

const REGIONAL_KEYWORDS: Record<string, string[]> = {
  Andalucía: ['andaluc', 'canal sur'],
  Aragón: ['aragon', 'arago'],
  Asturias: ['tpa', 'asturias'],
  Baleares: ['ib3', 'balear'],
  Canarias: ['canaria'],
  'Castilla-La Mancha': ['cmm', 'castilla la mancha'],
  Cataluña: ['tv3', 'catalu', '3cat', 'el 33', 'esport3', 'sx3', 'betev', '324'],
  Extremadura: ['extremadura'],
  Galicia: ['tvg', 'galicia'],
  Madrid: ['telemadrid', 'la otra', 'madrid'],
  Murcia: ['murcia', '7 tv region murcia', '7 tv murcia', '7rm'],
  Navarra: ['navarra'],
  'País Vasco': ['etb', 'euskadi', 'eitb'],
  Valencia: ['a punt', 'apunt', 'valencia', '7televalencia'],
};

const NATIONAL_TDT_ORDER = [
  'la_1',
  'la_2',
  'antena_3',
  'cuatro',
  'telecinco',
  'la_sexta',
  'neox',
  'nova',
  'mega',
  'energy',
  'dmax',
  'boing',
  'clan',
  'atreseries',
  'fdf',
  'divinity',
  'dkiss',
  'ten',
  'be_mad',
  'paramount_network',
  'trece',
  '24_horas',
];

export const GUIDE_GROUP_ORDER: CanonicalChannelGroup[] = [
  'tdt',
  'cable',
  'movistar',
  'online',
  'deporte',
];

const GUIDE_GROUP_SORT_ORDER: Record<CanonicalChannelGroup, number> = {
  tdt: 0,
  cable: 1,
  movistar: 2,
  online: 3,
  deporte: 4,
  autonomico: 5,
};

const CANONICAL_CHANNEL_ALIASES: Record<string, string[]> = {
  // Pay-TV and operator services. These aliases are identity data, not a
  // chatbot catalogue: every ingestion path resolves them to one channel id.
  tcm: ['tcm', 'tcm españa', 'tcm hd'],
  axn: ['axn', 'axn hd'],
  axn_movies: ['axn movies', 'axn white', 'axn movies hd'],
  amc: ['amc', 'amc hd'],
  amc_crime: ['amc crime'],
  amc_break: ['amc break'],
  amc_living: ['amc living'],
  canal_hollywood: ['canal hollywood', 'hollywood'],
  sundance_tv: ['sundance tv', 'sundance'],
  dark: ['dark', 'dark hd'],
  xtrm: ['xtrm'],
  somos: ['somos'],
  historia: ['historia', 'canal historia'],
  odisea: ['odisea'],
  canal_cocina: ['canal cocina'],
  national_geographic: ['national geographic', 'nat geo'],
  nat_geo_wild: ['nat geo wild', 'national geographic wild'],
  warner_tv: ['warner tv', 'warner channel'],
  star_channel: ['star channel', 'fox'],
  calle_13: ['calle 13', 'calle13'],
  syfy: ['syfy'],
  comedy_central: ['comedy central'],
  cosmo: ['cosmo'],
  mtv: ['mtv'],
  movistar_plus: ['m+', 'm plus', 'movistar plus', 'movistar+', 'movistar plus+'],
  movistar_hits: ['m+ hits', 'm hits', 'm plus hits', 'movistar hits', 'movistar+ hits', 'movistar plus hits', 'm.hits'],
  movistar_estrenos: ['m+ estrenos', 'm estrenos', 'm plus estrenos', 'movistar estrenos', 'movistar+ estrenos', 'movistar plus estrenos', 'm.estrenos'],
  movistar_comedia: ['m+ comedia', 'm comedia', 'm plus comedia', 'movistar comedia', 'movistar+ comedia', 'movistar plus comedia'],
  movistar_accion: ['m+ accion', 'm+ acción', 'm accion', 'm acción', 'm plus accion', 'm plus acción', 'movistar accion', 'movistar acción', 'movistar+ accion', 'movistar+ acción', 'movistar plus accion', 'movistar plus acción'],
  movistar_drama: ['m+ drama', 'movistar drama'],
  movistar_indie: ['m+ indie', 'movistar indie'],
  movistar_clasicos: ['m+ clasicos', 'm+ clásicos', 'movistar clasicos', 'movistar clásicos'],
  movistar_cine_espanol: ['m+ cine español', 'm+ cine espanol', 'movistar cine español'],
  movistar_documentales: ['m+ documentales', 'movistar documentales'],
  movistar_vamos: ['m+ vamos', 'movistar vamos'],
  movistar_deportes: ['m+ deportes', 'movistar deportes'],
  movistar_laliga: ['m+ laliga', 'movistar laliga', 'm+ la liga'],
  movistar_liga_campeones: ['m+ liga de campeones', 'movistar liga de campeones'],
  movistar_golf: ['m+ golf', 'movistar golf'],
  la_1: ['la1', 'la_1', 'la primera', 'tve1', 'la 1', 'la1 tv', 'la1_tv', 'la1 can', 'la1_can', 'la1 can tv', 'la1_can_tv'],
  la_2: ['la2', 'la_2', 'la dos', 'tve2', 'la 2', 'la2 tv', 'la2_tv', 'la2 can', 'la2_can', 'la2 can tv', 'la2_can_tv'],
  antena_3: ['antena3', 'antena_3', 'antena 3', 'a3', 'antena3 tv', 'antena3_tv'],
  cuatro: ['cuatro', 'cuatro tv', 'cuatro_tv'],
  telecinco: ['telecinco', 'tele 5', 'tele5', 'telecinco tv', 'telecinco_tv'],
  la_sexta: ['la sexta', 'lasexta', 'la_6', 'la6', 'la_sexta', 'lasexta tv', 'lasexta_tv', 'la sexta tv'],
  neox: ['neox', 'neox tv', 'neox_tv'],
  nova: ['nova', 'nova tv', 'nova_tv'],
  mega: ['mega', 'mega tv', 'mega_tv'],
  energy: ['energy'],
  dmax: [
    'dmax',
    'discovery',
    'discovery es',
    'discovery_es',
    'discovery max',
    'discovery_max',
    'discoverymax',
    'discovery max es',
    'discoverymax es',
    'discoverymax_es',
    'discoverymaxes',
  ],
  boing: ['boing', 'boing tv', 'boing_tv'],
  clan: ['clan', 'clan tve', 'clantve', 'clan_tve'],
  atreseries: ['atreseries'],
  fdf: ['fdf', 'factoria de ficcion', 'factoria_de_ficcion', 'fdf tv', 'fdf_tv'],
  divinity: ['divinity'],
  dkiss: ['dkiss', 'd kiss', 'd_kiss'],
  ten: ['ten'],
  be_mad: ['be mad', 'be_mad', 'bemad', 'be mad tv', 'be_mad_tv', 'bemad_tv'],
  paramount_network: ['paramount network', 'paramount_network', 'paramount channel', 'paramount_channel'],
  '24_horas': ['24_horas', '24 horas', 'canal 24 horas', '24h', '24_h'],
  teledeporte: ['teledeporte'],
  real_madrid_tv: ['real madrid tv', 'real_madrid_tv', 'realmadridtv'],
  gol: ['gol', 'gol tv', 'gol_tv'],
  trece: ['trece', '13tv', '13 tv', '13_tv', 'trece tv'],
};

const MOVISTAR_PATTERNS = [/^m\+/, /^movistar/, /\bmovistar\b/i];
const OTT_PATTERNS = [/^dazn/i, /rakuten/i, /pluto/i, /fast/i];
const CABLE_PATTERNS = [
  /^axn/i,
  /^amc/i,
  /^syfy/i,
  /^tcm/i,
  /^warner/i,
  /^comedy central/i,
  /^national geographic/i,
  /^discovery/i,
  /^dark$/i,
  /^calle 13/i,
  /^hollywood/i,
];

const CABLE_CANONICAL_IDS = new Set([
  'tcm',
  'axn',
  'axn_movies',
  'amc',
  'amc_crime',
  'amc_break',
  'amc_living',
  'canal_hollywood',
  'sundance_tv',
  'dark',
  'xtrm',
  'somos',
  'historia',
  'odisea',
  'canal_cocina',
  'national_geographic',
  'nat_geo_wild',
  'warner_tv',
  'star_channel',
  'calle_13',
  'syfy',
  'comedy_central',
  'cosmo',
  'mtv',
]);

const TITLE_ALIAS_SUFFIXES = [
  /\b360\b/gi,
  /\bexpress\b/gi,
  /\bexpress? news\b/gi,
  /\bextra\b/gi,
  /\btemporada\s+\d+\b/gi,
  /\bt\d+\b/gi,
  /\b(edicion|edición)\s+\d+\b/gi,
  /\be\d+\b/gi,
  /\bs\d+\s*e\d+\b/gi,
];

const BRAND_SUFFIX_PATTERNS = [
  /\bexpress\b/gi,
  /\bexpress? news\b/gi,
  /\bextra\b/gi,
  /\btemporada\s+\d+\b/gi,
  /\bt\d+\b/gi,
  /\b(edicion|edición)\s+\d+\b/gi,
  /\be\d+\b/gi,
  /\bs\d+\s*e\d+\b/gi,
];

const SPORTS_KEYWORDS = [
  'dazn',
  'eurosport',
  'deporte',
  'deportes',
  'sport',
  'sports',
  'liga',
  'futbol',
  'motor',
  'golf',
  'teledeporte',
  'real madrid tv',
  'gol',
];

const SPORTS_SIGNAL_KEYWORDS = [
  ...SPORTS_KEYWORDS,
  'nba',
  'acb',
  'euroliga',
  'atp',
  'wta',
  'roland garros',
  'wimbledon',
  'us open',
  'australian open',
  'motogp',
  'moto2',
  'moto3',
  'ciclismo',
  'cycling',
  'boxeo',
  'ufc',
  'rugby',
  'golf',
  'atletismo',
];

const SPORT_FACET_LABELS: Record<Exclude<TvSportFacetKey, 'all'>, TvSportFacet> = {
  futbol: 'Fútbol',
  baloncesto: 'Baloncesto',
  f1: 'F1',
  tenis: 'Tenis',
  motogp: 'MotoGP',
  mas: 'Más',
};

const SPORT_FACET_PATTERNS: Array<[Exclude<TvSportFacetKey, 'all' | 'mas'>, RegExp[]]> = [
  [
    'futbol',
    [
      /\bf[uú]tbol\b/i,
      /\bfootball\b/i,
      /\blaliga\b/i,
      /\bliga\b/i,
      /\bchampions\b/i,
      /\bpremier\b/i,
      /\bcopa del rey\b/i,
      /\buefa\b/i,
      /\bmundial\b/i,
    ],
  ],
  [
    'baloncesto',
    [
      /\bbaloncesto\b/i,
      /\bbasket\b/i,
      /\bnba\b/i,
      /\bacb\b/i,
      /\beuroliga\b/i,
      /\bbasketball\b/i,
    ],
  ],
  [
    'motogp',
    [
      /\bmotogp\b/i,
      /\bmoto2\b/i,
      /\bmoto3\b/i,
      /\bmotociclismo\b/i,
      /\bmotocross\b/i,
    ],
  ],
  [
    'f1',
    [
      /\bf(?:ormula)?\s*1\b/i,
      /\bformula one\b/i,
      /\bsky sports f1\b/i,
      /\bdazn f1\b/i,
      /\bpaddock\b/i,
      /(?:formula\s*1|formula1|f1).*(?:grand prix|gran premio|qualifying|clasificaci[oó]n|pole|box,?\s*box)/i,
      /(?:grand prix|gran premio).*(?:formula\s*1|formula1|f1)/i,
    ],
  ],
  [
    'tenis',
    [
      /\btenis\b/i,
      /\btennis\b/i,
      /\batp\b/i,
      /\bwta\b/i,
      /\broland garros\b/i,
      /\bwimbledon\b/i,
      /\bus open\b/i,
      /\baustralian open\b/i,
      /\bmasters 1000\b/i,
    ],
  ],
];

const NEWS_KEYWORDS = [
  'noticia',
  'informativo',
  'actualidad',
  'debate',
  'politica',
  'telediario',
];

const KIDS_KEYWORDS = [
  'infantil',
  'dibujos',
  'kids',
  'juvenil',
  'clan',
  'boing',
];

const SHOPPING_KEYWORDS = [
  'teletienda',
  'televenta',
  'shopping',
  'infocomercial',
  'tarot',
  'horoscopo',
  'horoscopo',
];

const GENERIC_MOVIE_TITLES = new Set([
  'cine',
  'pelicula',
  'peliculas',
  'movie',
  'film',
  'cinema',
  'estreno',
  'historia de nuestro cine',
  'el blockbuster',
  'blockbuster',
  'el taquillazo',
  'taquillazo',
  'cine cuatro',
  'el peliculon',
  'peliculon',
  'multicine',
  'sesion de tarde',
  'sesion de noche',
  'el western de la 2',
  'western de la 2',
  'pelicula de la semana',
]);

const MOVIE_CONTAINER_TITLE_PATTERNS: RegExp[] = [
  /^(?:el\s+blockbuster|el\s+taquillazo|el\s+pelicul[oó]n|cine\s+cuatro|cine)\s*[:|-]\s*(.+)$/i,
  /^(?:el\s+western\s+de\s+la\s+2)\s+(.+)$/i,
];

/** Public channel URL: ids are `[a-z0-9_]`, URLs use hyphens (`la_1` -> `/canales/la-1`), as the frontend does. */
export function channelPagePath(channelId: string): string {
  return `/canales/${encodeURIComponent(String(channelId).replace(/_/g, '-'))}`;
}

export function normalizeTvToken(
  value: string | null | undefined,
  separator: '_' | ' ' = '_'
): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${separator}+`, 'g'), separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, 'g'), '');

  return normalized;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const safe = String(value || '').trim();
    if (!safe) {
      return;
    }
    if (!seen.has(safe)) {
      seen.add(safe);
      result.push(safe);
    }
  });

  return result;
}

export function isGenericMovieTitle(value: string | null | undefined): boolean {
  const normalized = normalizeTvToken(value, ' ');
  if (!normalized) {
    return true;
  }

  if (GENERIC_MOVIE_TITLES.has(normalized)) {
    return true;
  }

  if (normalized.startsWith('cine') && normalized.split(' ').length <= 4) {
    return true;
  }

  return false;
}

export function resolveProgramDisplayTitle(
  title: string | null | undefined,
  subtitle?: string | null | undefined
): string {
  const safeTitle = String(title || '').trim();
  const safeSubtitle = String(subtitle || '').trim();

  if (!safeTitle) {
    return safeTitle;
  }

  if (isGenericMovieTitle(safeTitle) && safeSubtitle) {
    return safeSubtitle;
  }

  for (const pattern of MOVIE_CONTAINER_TITLE_PATTERNS) {
    const match = safeTitle.match(pattern);
    const candidate = String(match?.[1] || '').trim();
    if (candidate && !isGenericMovieTitle(candidate)) {
      return candidate;
    }
  }

  return safeTitle;
}

export function normalizeSportFacet(
  value: string | null | undefined
): TvSportFacetKey | undefined {
  const normalized = normalizeTvToken(value, ' ');
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'todos' || normalized === 'todo' || normalized === 'all') {
    return 'all';
  }
  if (normalized === 'futbol' || normalized === 'futbol sala') return 'futbol';
  if (normalized === 'baloncesto' || normalized === 'basket') return 'baloncesto';
  if (normalized === 'f1' || normalized === 'formula 1' || normalized === 'formula1') return 'f1';
  if (normalized === 'tenis' || normalized === 'tennis') return 'tenis';
  if (normalized === 'motogp' || normalized === 'moto gp' || normalized === 'motociclismo') return 'motogp';
  if (normalized === 'mas' || normalized === 'otros' || normalized === 'multideporte' || normalized === 'multisport') {
    return 'mas';
  }
  return undefined;
}

export function getSportFacetLabel(
  value: Exclude<TvSportFacetKey, 'all'> | TvSportFacet | null | undefined
): TvSportFacet | undefined {
  if (!value) {
    return undefined;
  }
  if (Object.values(SPORT_FACET_LABELS).includes(value as TvSportFacet)) {
    return value as TvSportFacet;
  }
  const normalized = normalizeSportFacet(String(value));
  if (!normalized || normalized === 'all') {
    return undefined;
  }
  return SPORT_FACET_LABELS[normalized];
}

function hasNormalizedKeyword(normalized: string, keyword: string): boolean {
  const safeKeyword = normalizeTvToken(keyword, ' ');
  if (!safeKeyword) {
    return false;
  }

  const escaped = safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^| )${escaped}( |$)`, 'i').test(normalized);
}

export function inferSportFacet(input: {
  editorialCategory?: string | null;
  genre?: string | null;
  subgenre?: string | null;
  title?: string | null;
  description?: string | null;
  channelName?: string | null;
}): TvSportFacet | undefined {
  const combined = [
    input.editorialCategory,
    input.genre,
    input.subgenre,
    input.title,
    input.description,
  ]
    .filter(Boolean)
    .join(' ');

  const normalized = normalizeTvToken(combined, ' ');
  if (!normalized) {
    return undefined;
  }

  const hasSportsSignal =
    /(^| )(deport|sport|liga|champions|motogp|formula|f1|nba|acb|tenis|tennis|golf|rugby|boxeo|ufc|ciclismo|cycling)( |$)/.test(
      normalized
    ) ||
    SPORTS_SIGNAL_KEYWORDS.some((keyword) => hasNormalizedKeyword(normalized, keyword));

  if (!hasSportsSignal) {
    return undefined;
  }

  for (const [facet, patterns] of SPORT_FACET_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(combined))) {
      return SPORT_FACET_LABELS[facet];
    }
  }

  return 'Más';
}

export function getGuideGroupSortOrder(
  group: CanonicalChannelGroup | string | null | undefined
): number {
  const normalized = normalizeTvToken(group, ' ');
  if (
    normalized === 'tdt' ||
    normalized === 'cable' ||
    normalized === 'movistar' ||
    normalized === 'online' ||
    normalized === 'deporte' ||
    normalized === 'autonomico'
  ) {
    return GUIDE_GROUP_SORT_ORDER[normalized];
  }
  return 999;
}

export function isMixedGuideGroup(
  group: CanonicalChannelGroup | string | null | undefined
): boolean {
  const normalized = normalizeTvToken(group, ' ');
  return normalized === 'tdt' ||
    normalized === 'cable' ||
    normalized === 'movistar' ||
    normalized === 'online' ||
    normalized === 'deporte';
}

function stripChannelVariantSuffixes(value: string | null | undefined): string {
  return normalizeTvToken(value, ' ')
    .replace(/\b(hd|uhd|fhd|4k|sd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferChannelRegion(input: ChannelIdentityInput): string | undefined {
  const tokens = [input.name, input.sourceId, input.region]
    .map((value) => normalizeTvToken(value, ' '))
    .filter(Boolean);

  for (const [region, keywords] of Object.entries(REGIONAL_KEYWORDS)) {
    if (keywords.some((keyword) => tokens.some((token) => token.includes(keyword)))) {
      return region;
    }
  }

  return undefined;
}

export function buildChannelAliases(input: ChannelIdentityInput): string[] {
  const normalizedName = normalizeTvToken(input.name);
  const compactName = normalizeTvToken(input.name, ' ').replace(/\s+/g, '');
  const strippedName = stripChannelVariantSuffixes(input.name);
  const strippedNameNormalized = normalizeTvToken(strippedName);
  const strippedCompactName = normalizeTvToken(strippedName, ' ').replace(/\s+/g, '');
  const normalizedSourceId = normalizeTvToken(input.sourceId);
  const compactSourceId = normalizeTvToken(input.sourceId, ' ').replace(/\s+/g, '');
  const strippedSourceId = stripChannelVariantSuffixes(input.sourceId);
  const strippedSourceIdNormalized = normalizeTvToken(strippedSourceId);
  const strippedCompactSourceId = normalizeTvToken(strippedSourceId, ' ').replace(/\s+/g, '');
  const directAliases = unique([
    normalizedName,
    compactName,
    strippedNameNormalized,
    strippedCompactName,
    normalizedSourceId,
    compactSourceId,
    strippedSourceIdNormalized,
    strippedCompactSourceId,
  ]);

  const canonicalAliasEntry = Object.entries(CANONICAL_CHANNEL_ALIASES).find(
    ([canonicalId, aliases]) =>
      [canonicalId, ...aliases.map((alias) => normalizeTvToken(alias))]
        .some((candidate) => directAliases.includes(candidate))
  );

  if (!canonicalAliasEntry) {
    return directAliases;
  }

  const [canonicalId, aliases] = canonicalAliasEntry;
  return unique([
    canonicalId,
    ...aliases.map((alias) => normalizeTvToken(alias)),
    ...directAliases,
  ]);
}

/**
 * Resolves a user/provider channel label through the same registry used by
 * ingestion. This deliberately performs only exact normalized alias matches;
 * callers that need text extraction should use findCanonicalChannelInText.
 */
export function resolveCanonicalChannelId(value: string | null | undefined): string | undefined {
  const normalized = normalizeTvToken(value, ' ');
  if (!normalized) return undefined;

  for (const [canonicalId, aliases] of Object.entries(CANONICAL_CHANNEL_ALIASES)) {
    if (canonicalId === normalized || aliases.some((alias) => normalizeTvToken(alias, ' ') === normalized)) {
      return canonicalId;
    }
  }
  return undefined;
}

/** Returns the longest explicit registry alias contained as whole words. */
export function findCanonicalChannelInText(value: string | null | undefined): string | undefined {
  const normalized = normalizeTvToken(value, ' ');
  if (!normalized) return undefined;

  const candidates = Object.entries(CANONICAL_CHANNEL_ALIASES)
    .flatMap(([canonicalId, aliases]) => [canonicalId, ...aliases].map((alias) => ({
      canonicalId,
      alias: normalizeTvToken(alias, ' '),
    })))
    .filter(({ alias }) => alias)
    .sort((left, right) => right.alias.length - left.alias.length);

  return candidates.find(({ alias }) =>
    normalized === alias || normalized.startsWith(`${alias} `) ||
    normalized.endsWith(` ${alias}`) || normalized.includes(` ${alias} `)
  )?.canonicalId;
}

export function inferChannelType(input: ChannelIdentityInput): CanonicalChannelType {
  const aliases = buildChannelAliases(input);
  const normalizedName = normalizeTvToken(input.name, ' ');
  const region = inferChannelRegion(input);
  const isNationalTdt = NATIONAL_TDT_ORDER.some((canonicalId) => aliases.includes(canonicalId));

  if (isNationalTdt) {
    return 'TDT';
  }

  if (region) {
    return 'Autonomico';
  }

  if (
    MOVISTAR_PATTERNS.some((pattern) => pattern.test(normalizedName)) ||
    aliases.some((alias) => alias.startsWith('movistar_'))
  ) {
    return 'Movistar';
  }

  if (OTT_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return 'OTT';
  }

  if (CABLE_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return 'Cable';
  }

  if (aliases.some((alias) => CABLE_CANONICAL_IDS.has(alias))) {
    return 'Cable';
  }

  return 'OTT';
}

function inferChannelOperationalMetadata(
  input: ChannelIdentityInput,
  aliases: string[],
  canonicalId: string,
  inferredType: CanonicalChannelType
): Pick<
  ChannelIdentityMetadata,
  | 'distribution'
  | 'access'
  | 'operator'
  | 'providers'
  | 'contentFacets'
  | 'market'
  | 'quality'
  | 'capabilities'
  | 'provenance'
> {
  const normalizedName = normalizeTvToken(input.name, ' ');
  const rawIdentity = `${input.name || ''} ${input.sourceId || ''}`;
  const isMovistar =
    inferredType === 'Movistar' || aliases.some((alias) => alias.startsWith('movistar_'));
  const isDazn = /^dazn(?:\b|_)/i.test(normalizedName) || canonicalId.startsWith('dazn_');
  const isCable = inferredType === 'Cable' || CABLE_CANONICAL_IDS.has(canonicalId);
  const distribution: CanonicalChannelDistribution =
    inferredType === 'TDT' || inferredType === 'Autonomico'
      ? 'terrestrial'
      : isMovistar
        ? 'operator'
        : isCable
          ? 'cable'
          : inferredType === 'OTT'
            ? 'ott'
            : 'unknown';
  const access: CanonicalChannelAccess =
    distribution === 'terrestrial'
      ? 'free'
      : distribution === 'cable' || distribution === 'operator' || isDazn
        ? 'pay'
        : 'unknown';
  const operator = isMovistar
    ? 'Movistar Plus+'
    : isDazn
      ? 'DAZN'
      : canonicalId.startsWith('amc') ||
          ['canal_hollywood', 'sundance_tv', 'dark', 'xtrm', 'somos', 'odisea', 'canal_cocina'].includes(canonicalId)
        ? 'AMC Networks'
        : ['warner_tv', 'tcm'].includes(canonicalId)
          ? 'Warner Bros. Discovery'
          : canonicalId === 'mtv' || canonicalId === 'comedy_central'
            ? 'Paramount'
            : 'unknown';
  const providers = operator === 'unknown' ? [] : [operator];
  const contentFacets = new Set<CanonicalChannelContentFacet>();
  if (SPORTS_KEYWORDS.some((keyword) => normalizedName.includes(keyword))) {
    contentFacets.add('sports');
  }
  if (/\b(cine|movie|movies|estrenos|accion|drama|comedia|tcm|hollywood|sundance|somos)\b/.test(normalizedName)) {
    contentFacets.add('movies');
  }
  if (/\b(axn|syfy|calle 13|cosmo|warner)\b/.test(normalizedName)) {
    contentFacets.add('series');
  }
  if (/\b(national geographic|historia|odisea|discovery|documental)\b/.test(normalizedName)) {
    contentFacets.add('documentary');
  }
  if (/\b(mtv|music|musica)\b/.test(normalizedName)) contentFacets.add('music');
  if (/\b(cocina|living|lifestyle)\b/.test(normalizedName)) contentFacets.add('lifestyle');
  if (/\b(clan|boing|kids|infantil)\b/.test(normalizedName)) contentFacets.add('kids');
  if (/\b(news|noticias|24 horas)\b/.test(normalizedName)) contentFacets.add('news');
  if (!contentFacets.size && (inferredType === 'TDT' || inferredType === 'Autonomico')) {
    contentFacets.add('general');
  }
  if (!contentFacets.size) contentFacets.add('unknown');

  const region = input.region || inferChannelRegion(input) || 'unknown';
  const country = input.country || 'unknown';
  const countryCode = input.countryCode || 'unknown';
  const scope: CanonicalChannelMarket['scope'] =
    region !== 'unknown'
      ? 'regional'
      : country !== 'unknown' || countryCode !== 'unknown'
        ? 'national'
        : 'unknown';
  const resolution: CanonicalChannelQuality['resolution'] = /\b4k\b/i.test(rawIdentity)
    ? '4k'
    : /\buhd\b/i.test(rawIdentity)
      ? 'uhd'
      : /\bhd\b/i.test(rawIdentity)
        ? 'hd'
        : 'unknown';
  const registryMatched = Object.prototype.hasOwnProperty.call(
    CANONICAL_CHANNEL_ALIASES,
    canonicalId
  );

  return {
    distribution,
    access,
    operator,
    providers,
    contentFacets: Array.from(contentFacets),
    market: { country, countryCode, region, scope },
    quality: {
      resolution,
      timeshift: /(?:\+1|\bplus 1\b)/i.test(rawIdentity) ? true : 'unknown',
    },
    capabilities: {
      linear: true,
      catchup: 'unknown',
      streaming: 'unknown',
    },
    provenance: {
      classification: registryMatched
        ? 'registry'
        : input.name || input.sourceId
          ? 'heuristic'
          : 'unknown',
      sourceIds: unique([String(input.sourceId || '').trim()]),
    },
  };
}

export function inferChannelGroup(
  input: ChannelIdentityInput & {
    type?: string | null | undefined;
    name?: string;
  }
): CanonicalChannelGroup {
  const aliases = buildChannelAliases(input);
  const normalizedName = normalizeTvToken(input.name, ' ');
  const normalizedType = normalizeTvToken(input.type, ' ');
  const isNationalTdt = NATIONAL_TDT_ORDER.some((canonicalId) => aliases.includes(canonicalId));
  const isCanonicalMovistar = aliases.some((alias) => alias.startsWith('movistar_'));
  const hasRegionalSignal = Boolean(inferChannelRegion(input));
  const inferredType =
    !isNationalTdt &&
    !hasRegionalSignal &&
    input.type &&
    normalizedType !== 'tdt' &&
    ['tdt', 'cable', 'movistar', 'autonomico', 'ott'].includes(normalizedType)
      ? (input.type as CanonicalChannelType)
      : inferChannelType(input);

  if (SPORTS_KEYWORDS.some((keyword) => normalizedName.includes(keyword))) {
    return 'deporte';
  }

  if (normalizedType === 'deportes' || normalizedType === 'sports') {
    return 'deporte';
  }

  if (isNationalTdt) return 'tdt';
  // Canonical registry identity wins over stale persisted provider type. Some
  // older EPG snapshots stored M+ services as OTT even though they are
  // Movistar channels.
  if (isCanonicalMovistar) return 'movistar';
  if (inferredType === 'TDT') return 'tdt';
  if (inferredType === 'Cable') return 'cable';
  if (inferredType === 'Autonomico') return 'autonomico';
  if (inferredType === 'Movistar') return 'movistar';
  return 'online';
}

export function inferChannelSortOrder(input: ChannelIdentityInput): number {
  const aliases = buildChannelAliases(input);
  const nationalIndex = NATIONAL_TDT_ORDER.findIndex((candidate) =>
    aliases.includes(candidate)
  );

  if (nationalIndex !== -1) {
    return nationalIndex;
  }

  const group = inferChannelGroup(input);
  if (group === 'cable') return 200;
  if (group === 'movistar') return 300;
  if (group === 'online') return 400;
  if (group === 'deporte') return 500;
  if (group === 'autonomico') return 900;
  return 999;
}

export function buildChannelIdentityMetadata(
  input: ChannelIdentityInput
): ChannelIdentityMetadata {
  const aliases = buildChannelAliases(input);
  const normalizedName = normalizeTvToken(input.name);
  const canonicalAlias = aliases.find((alias) =>
    Object.prototype.hasOwnProperty.call(CANONICAL_CHANNEL_ALIASES, alias)
  );

  const canonicalId =
    canonicalAlias || normalizedName || normalizeTvToken(input.sourceId) || 'unknown_channel';
  const inferredType = inferChannelType(input);

  return {
    normalizedName,
    aliases,
    sourceIds: unique([normalizeTvToken(input.sourceId), String(input.sourceId || '').trim()]),
    canonicalId,
    inferredType,
    inferredGroup: inferChannelGroup(input),
    inferredRegion: inferChannelRegion(input),
    sortOrder: inferChannelSortOrder(input),
    ...inferChannelOperationalMetadata(input, aliases, canonicalId, inferredType),
  };
}

export function buildProgramTitleAliases(
  title: string | null | undefined
): string[] {
  const base = normalizeTvToken(title, ' ');
  if (!base) {
    return [];
  }

  const aliases = new Set<string>([
    base,
    normalizeTvToken(base),
  ]);

  let simplified = base;
  TITLE_ALIAS_SUFFIXES.forEach((pattern) => {
    simplified = simplified.replace(pattern, ' ');
  });
  simplified = simplified.replace(/\s+/g, ' ').trim();

  if (simplified && simplified !== base) {
    aliases.add(simplified);
    aliases.add(normalizeTvToken(simplified));
  }

  if (simplified.includes(' ')) {
    const withoutTrailingNumber = simplified.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (withoutTrailingNumber && withoutTrailingNumber !== simplified) {
      aliases.add(withoutTrailingNumber);
      aliases.add(normalizeTvToken(withoutTrailingNumber));
    }
  }

  return Array.from(aliases).filter(Boolean);
}

export function buildProgramBrandKey(
  title: string | null | undefined
): string {
  const base = normalizeTvToken(title, ' ');
  if (!base) {
    return 'unknown_brand';
  }

  let simplified = base;
  BRAND_SUFFIX_PATTERNS.forEach((pattern) => {
    simplified = simplified.replace(pattern, ' ');
  });
  simplified = simplified.replace(/\s+/g, ' ').trim();

  return normalizeTvToken(simplified || base) || 'unknown_brand';
}

export function inferEditorialCategory(
  category?: string | null,
  title?: string | null,
  description?: string | null
): string {
  const titleSource = `${category || ''} ${title || ''}`.toLowerCase();
  const fullSource = `${titleSource} ${description || ''}`.toLowerCase();
  const descriptionSource = String(description || '').toLowerCase();

  if (SHOPPING_KEYWORDS.some((keyword) => titleSource.includes(keyword))) return 'Otros';
  if (NEWS_KEYWORDS.some((keyword) => titleSource.includes(keyword))) return 'Noticias';
  if (/(telenovela|novela|serie|series|ficci[oó]n|cap[ií]tulo)/.test(titleSource)) return 'Series';
  if (/(cine|pel[ií]cula|film|movie|estreno)/.test(titleSource)) return 'Cine';
  if (/(deport|f[úu]tbol|baloncesto|tenis|formula|motogp|liga|champions|golf)/.test(titleSource)) return 'Deportes';
  if (KIDS_KEYWORDS.some((keyword) => titleSource.includes(keyword))) return 'Infantil';
  if (/(documental|docu)/.test(titleSource)) return 'Documental';
  if (/(magazine|entretenimiento|concurso|show|reality|variedades)/.test(titleSource)) return 'Entretenimiento';

  if (/^\s*cine\b/.test(descriptionSource) || /\bcine[,.:;|]/.test(descriptionSource)) return 'Cine';
  if (
    /^\s*documental\b/.test(descriptionSource) ||
    /\bdocumental[,.:;|]/.test(descriptionSource)
  ) {
    return 'Documental';
  }
  if (/(telenovela|novela|serie|series|ficci[oó]n|cap[ií]tulo)/.test(fullSource)) return 'Series';
  if (/(documental|docu)/.test(fullSource)) return 'Documental';
  if (/(magazine|entretenimiento|concurso|show|reality|variedades)/.test(fullSource)) return 'Entretenimiento';
  return String(category || '').trim() || 'Otros';
}

export function inferPartOfDay(dateLike: Date | string | null | undefined): TvPartOfDay {
  const value = dateLike instanceof Date ? dateLike : new Date(String(dateLike || ''));
  const hours = value.getHours();
  if (hours < 6) return 'madrugada';
  if (hours < 12) return 'manana';
  if (hours < 20) return 'tarde';
  return 'noche';
}

export function inferTimeWindow(
  startLike: Date | string | null | undefined,
  endLike?: Date | string | null | undefined,
  referenceLike?: Date | string | null | undefined
): TvTimeWindow {
  const reference =
    referenceLike instanceof Date
      ? referenceLike
      : referenceLike
        ? new Date(String(referenceLike))
        : new Date();
  const start =
    startLike instanceof Date ? startLike : new Date(String(startLike || ''));
  const end =
    endLike instanceof Date ? endLike : endLike ? new Date(String(endLike)) : undefined;

  if (!Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime())) {
    if (start <= reference && reference < end) return 'now';
    if (start > reference && start.getTime() - reference.getTime() <= 2 * 60 * 60 * 1000) {
      return 'next';
    }
  }

  const partOfDay = inferPartOfDay(start);
  if (partOfDay === 'noche') return 'tonight';
  if (!Number.isNaN(start.getTime())) return 'today';
  return 'unknown';
}

export function buildTimeSlotKey(
  dateLike: Date | string | null | undefined
): string {
  const value = dateLike instanceof Date ? dateLike : new Date(String(dateLike || ''));
  if (Number.isNaN(value.getTime())) {
    return 'unknown';
  }
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = value.getMinutes() < 30 ? '00' : '30';
  return `${hh}:${mm}`;
}

export function buildTvReadAiringId(input: {
  viewDate: string;
  channelId: string | null | undefined;
  startTime: Date | string | null | undefined;
  normalizedTitle: string | null | undefined;
}): string {
  const start =
    input.startTime instanceof Date
      ? input.startTime
      : new Date(String(input.startTime || ''));
  const startToken = Number.isNaN(start.getTime())
    ? 'unknown_start'
    : [
        start.getFullYear(),
        String(start.getMonth() + 1).padStart(2, '0'),
        String(start.getDate()).padStart(2, '0'),
        String(start.getHours()).padStart(2, '0'),
        String(start.getMinutes()).padStart(2, '0'),
        String(start.getSeconds()).padStart(2, '0'),
      ].join('');
  const viewDateToken = /^\d{8}$/.test(String(input.viewDate || ''))
    ? String(input.viewDate)
    : normalizeTvToken(input.viewDate) || 'unknown_date';
  const channelToken = normalizeTvToken(input.channelId, '_') || 'unknown_channel';
  return `${viewDateToken}_${channelToken}_${startToken}`;
}

export function buildSearchTokens(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => {
          const normalizedSpace = normalizeTvToken(value, ' ');
          const normalizedUnderscore = normalizeTvToken(value, '_');
          const tokens = String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/g)
            .map((token) => token.trim())
            .filter(Boolean);
          return [normalizedSpace, normalizedUnderscore, ...tokens];
        })
        .filter(Boolean)
    )
  );
}

export function buildCatalogAssetCandidates(input: {
  poster?: string;
  backdrop?: string;
  channelLogo?: string;
  platformLogo?: string;
  posterSource?: 'epg_program_image' | 'tmdb_poster';
  backdropSource?: 'epg_program_image' | 'tmdb_backdrop';
}): CatalogAssetCandidate[] {
  return unique([
    input.poster,
    input.backdrop,
    input.channelLogo,
    input.platformLogo,
  ]).reduce<CatalogAssetCandidate[]>((assets, url) => {
    if (url === input.poster) {
      assets.push({
        kind: 'poster',
        role: 'primary',
        source: input.posterSource || 'epg_program_image',
        url,
      });
      return assets;
    }
    if (url === input.backdrop) {
      assets.push({
        kind: 'backdrop',
        role: 'fallback',
        source: input.backdropSource || 'tmdb_backdrop',
        url,
      });
      return assets;
    }
    if (url === input.channelLogo) {
      assets.push({
        kind: 'channelLogo',
        role: 'fallback',
        source: 'channel_icon',
        url,
      });
      return assets;
    }
    assets.push({
      kind: 'platformLogo',
      role: 'fallback',
      source: 'platform_logo',
      url,
    });
    return assets;
  }, []);
}

export function buildCatalogAssetSet(input: {
  poster?: string;
  backdrop?: string;
  channelLogo?: string;
  platformLogo?: string;
  posterSource?: 'epg_program_image' | 'tmdb_poster';
  backdropSource?: 'epg_program_image' | 'tmdb_backdrop';
}): CatalogAssetSet {
  const candidates = buildCatalogAssetCandidates(input);
  const primary =
    candidates.find((candidate) => candidate.kind === 'poster') ||
    candidates.find((candidate) => candidate.kind === 'backdrop');

  const findByKind = (
    kind: CatalogAssetCandidate['kind']
  ): CatalogAssetCandidate | undefined =>
    candidates.find((candidate) => candidate.kind === kind);

  return {
    primary,
    poster: findByKind('poster'),
    backdrop: findByKind('backdrop'),
    channelLogo: findByKind('channelLogo'),
    platformLogo: findByKind('platformLogo'),
    candidates,
    fallbackChain: candidates,
  };
}
