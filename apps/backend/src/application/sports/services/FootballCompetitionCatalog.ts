/**
 * Canonical football competition catalog.
 *
 * This is the structured source of truth for competition identity. The old
 * "competition = title.split(':')[0]" heuristic is forbidden as a canonical
 * mechanism — it only lives on as one *input* signal inside the normalizer,
 * which must always resolve against a catalog entry with a stable slug.
 */

import { FootballCompetition, FootballCompetitionType } from '../../../domain/sports/football/types';

export interface CompetitionCatalogEntry {
  slug: string;
  name: string;
  shortName: string;
  country?: string;
  type: FootballCompetitionType;
  /** Title hints used only for reconciliation, never as canonical identity. */
  titleHints: string[];
  aliases: string[];
}

const entries: CompetitionCatalogEntry[] = [
  {
    slug: 'laliga',
    name: 'LaLiga',
    shortName: 'LaLiga',
    country: 'España',
    type: 'league',
    titleHints: ['laliga', 'la liga', 'liga ea sports', 'primera division', 'primera división', 'liga santander'],
    aliases: ['laliga ea sports', 'la liga ea sports', 'primera'],
  },
  {
    slug: 'laliga-hypermotion',
    name: 'LaLiga Hypermotion',
    shortName: 'Hypermotion',
    country: 'España',
    type: 'league',
    titleHints: ['hypermotion', 'segunda division', 'segunda división', 'liga hypermotion'],
    aliases: ['laliga 2', 'segunda'],
  },
  {
    slug: 'copa-del-rey',
    name: 'Copa del Rey',
    shortName: 'Copa del Rey',
    country: 'España',
    type: 'cup',
    titleHints: ['copa del rey', 'copa de sm el rey'],
    aliases: ['copa del rey'],
  },
  {
    slug: 'dfb-pokal',
    name: 'DFB-Pokal',
    shortName: 'DFB-Pokal',
    country: 'Alemania',
    type: 'cup',
    titleHints: ['dfb pokal', 'dfb-pokal', 'copa de alemania', 'pokal'],
    aliases: ['dfb pokal', 'dfb-pokal', 'copa alemana'],
  },
  {
    slug: 'champions-league',
    name: 'UEFA Champions League',
    shortName: 'Champions',
    country: 'Europa',
    type: 'cup',
    titleHints: ['champions league', 'champions', 'liga de campeones', 'uefa champions'],
    aliases: ['champions', 'ucl', 'liga de campeones'],
  },
  {
    slug: 'europa-league',
    name: 'UEFA Europa League',
    shortName: 'Europa League',
    country: 'Europa',
    type: 'cup',
    titleHints: ['europa league', 'uefa europa league'],
    aliases: ['uel', 'europa league'],
  },
  {
    slug: 'conference-league',
    name: 'UEFA Conference League',
    shortName: 'Conference',
    country: 'Europa',
    type: 'cup',
    titleHints: ['conference league', 'uefa conference'],
    aliases: ['conference', 'uecl'],
  },
  {
    slug: 'premier-league',
    name: 'Premier League',
    shortName: 'Premier',
    country: 'Inglaterra',
    type: 'league',
    titleHints: ['premier league', 'premier'],
    aliases: ['premier league', 'epl'],
  },
  {
    slug: 'championship',
    name: 'Championship',
    shortName: 'Championship',
    country: 'Inglaterra',
    type: 'league',
    titleHints: ['championship', 'efl championship'],
    aliases: ['championship', 'segunda inglesa'],
  },
  {
    slug: 'brasileirao',
    name: 'Brasileirão',
    shortName: 'Brasileirão',
    country: 'Brasil',
    type: 'league',
    titleHints: ['brasileirao', 'brasileirão', 'serie a brasileirao'],
    aliases: ['brasileirao', 'brasil'],
  },
  {
    slug: 'copa-libertadores',
    name: 'Copa Libertadores',
    shortName: 'Libertadores',
    country: 'Sudamérica',
    type: 'cup',
    titleHints: ['copa libertadores', 'libertadores'],
    aliases: ['libertadores', 'sudamericana'],
  },
  {
    slug: 'serie-a',
    name: 'Serie A',
    shortName: 'Serie A',
    country: 'Italia',
    type: 'league',
    titleHints: ['serie a', 'serie a tim'],
    aliases: ['serie a', 'calcio'],
  },
  {
    slug: 'bundesliga',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    country: 'Alemania',
    type: 'league',
    titleHints: ['bundesliga', 'bundesliga 1'],
    aliases: ['bundesliga'],
  },
  {
    slug: 'bundesliga-2',
    name: 'Bundesliga 2',
    shortName: 'Bundesliga 2',
    country: 'Alemania',
    type: 'league',
    titleHints: ['bundesliga 2', '2. bundesliga', '2. fußball-bundesliga', 'segunda bundesliga', 'zweite bundesliga'],
    aliases: ['bundesliga 2', '2. bundesliga', 'segunda division alemana', 'zweite liga'],
  },
  {
    slug: 'ligue-1',
    name: 'Ligue 1',
    shortName: 'Ligue 1',
    country: 'Francia',
    type: 'league',
    titleHints: ['ligue 1', 'ligue1'],
    aliases: ['ligue 1', 'l1'],
  },
  {
    slug: 'primeira-liga',
    name: 'Primeira Liga',
    shortName: 'Primeira Liga',
    country: 'Portugal',
    type: 'league',
    titleHints: ['primeira liga', 'liga portugal', 'liga portugal betclic'],
    aliases: ['primeira liga', 'liga portugal'],
  },
  {
    slug: 'eredivisie',
    name: 'Eredivisie',
    shortName: 'Eredivisie',
    country: 'Países Bajos',
    type: 'league',
    titleHints: ['eredivisie'],
    aliases: ['eredivisie'],
  },
  {
    slug: 'seleccion-espanola',
    name: 'Selección española',
    shortName: 'España',
    country: 'España',
    type: 'national_team',
    titleHints: ['selección española', 'seleccion española', 'espana', 'españa', 'la roja'],
    aliases: ['españa', 'espana', 'la roja'],
  },
  {
    slug: 'eurocopa',
    name: 'UEFA Euro',
    shortName: 'Eurocopa',
    country: 'Europa',
    type: 'international',
    titleHints: ['eurocopa', 'uefa euro', 'euro 2024', 'euro 2028'],
    aliases: ['euro', 'uefa euro', 'eurocopa'],
  },
  {
    slug: 'mundial',
    name: 'FIFA World Cup',
    shortName: 'Mundial',
    country: 'Mundial',
    type: 'international',
    titleHints: ['mundial de futbol', 'mundial de fútbol', 'copa del mundo', 'world cup', 'qatar 2022', 'mundial 2026'],
    aliases: ['copa del mundo', 'world cup', 'fifa world cup'],
  },
  {
    slug: 'nations-league',
    name: 'UEFA Nations League',
    shortName: 'Nations League',
    country: 'Europa',
    type: 'international',
    titleHints: ['nations league', 'uefa nations'],
    aliases: ['nations league'],
  },
];

/**
 * Competition logos (owner-authorised 2026-11-09). Each URL was verified to answer
 * 200: footballdata.io's public league images, or the Wikidata P154 logo on Commons
 * when footballdata.io has none. Absent = neutral trophy icon, never a guess.
 */
const FD = 'https://footballdata.io/img/league/';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
export const COMPETITION_LOGOS: Readonly<Record<string, string>> = {
  laliga: `${FD}spain-la-liga.png`,
  'laliga-hypermotion': `${FD}spain-segunda-division.png`,
  'copa-del-rey': `${FD}spain-copa-del-rey.png`,
  'dfb-pokal': `${COMMONS}2/2a/DFB-Pokal_Wordmark.svg`,
  'champions-league': `${FD}europe-uefa-champions-league.png`,
  'europa-league': `${FD}europe-uefa-europa-league.png`,
  'conference-league': `${COMMONS}2/26/UEFA_Conference_League_logo_%282024_version%29.svg`,
  'premier-league': `${FD}england-premier-league.png`,
  championship: `${FD}england-championship.png`,
  brasileirao: `${FD}brazil-serie-a.png`,
  'copa-libertadores': `${FD}south-america-copa-libertadores.png`,
  'serie-a': `${FD}italy-serie-a.png`,
  bundesliga: `${FD}germany-bundesliga.png`,
  'bundesliga-2': `${FD}germany-2-bundesliga.png`,
  'ligue-1': `${FD}france-ligue-1.png`,
  'primeira-liga': `${FD}portugal-liga-nos.png`,
  eredivisie: `${FD}netherlands-eredivisie.png`,
  'seleccion-espanola': 'https://footballdata.io/img/team/spain-national-team.png',
  mundial: `${FD}international-world-cup.png`,
  'nations-league': `${COMMONS}d/de/Uefa_nations_league_textlogo.png`,
};

/** Knockout competitions: a "table" for them is meaningless, so none is ever served. */
// nations-league: four separate groups; one merged table would be false.
const NO_TABLE = new Set(['copa-del-rey', 'dfb-pokal', 'copa-libertadores', 'eurocopa', 'mundial', 'seleccion-espanola', 'nations-league']);

export function competitionHasTable(slug: string): boolean {
  return !NO_TABLE.has(slug);
}

const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));

export function getCompetitionCatalog(): readonly CompetitionCatalogEntry[] {
  return entries;
}

export function getCompetitionCatalogBySlug(slug: string): CompetitionCatalogEntry | undefined {
  return bySlug.get(String(slug || '').trim().toLowerCase());
}

export function toCompetitionEntity(entry: CompetitionCatalogEntry): FootballCompetition {
  return {
    id: `catalog:${entry.slug}`,
    slug: entry.slug,
    name: entry.name,
    shortName: entry.shortName,
    country: entry.country,
    type: entry.type,
    logo: COMPETITION_LOGOS[entry.slug] ?? null,
    hasTable: competitionHasTable(entry.slug),
    hasData: false,
    providerIds: {},
    lastUpdatedAt: new Date().toISOString(),
  };
}
