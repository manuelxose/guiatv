/**
 * Football normalization — turns raw EPG sports airings into structured
 * `FootballMatch` domain objects.
 *
 * Design rules (mirroring the product spec):
 *  - A broadcast program is NOT a match. Only two-team matchups become matches.
 *  - Scores/minutes are NEVER fabricated — the EPG does not provide them.
 *  - Competition is resolved against the canonical catalog, never via a bare
 *    `title.split(':')[0]`.
 *  - Regex is an auxiliary reconciliation tool, never the source of truth.
 */

import { ITVReadAiringDocument } from '../../../infrastructure/database/models/TVReadAiring.model';
import {
  FootballBroadcast,
  FootballCompetition,
  FootballMatch,
  FootballMatchStatus,
  FootballScore,
  FootballTeam,
} from '../../../domain/sports/football/types';
import {
  CompetitionCatalogEntry,
  getCompetitionCatalog,
  getCompetitionCatalogBySlug,
  toCompetitionEntity,
} from './FootballCompetitionCatalog';
import { channelPagePath } from '../../../shared/utils/tvMetadata';

/** Non-football signals that override a "Deportes" editorial category. */
const NON_FOOTBALL_SIGNAL =
  /\bf1\b|f[óo]rmula\s*1|motogp|moto\s*gp|grand\s+prix|jiu[- ]?jitsu|baloncesto|basket|\bnba\b|\bacb\b|eurobasket|tenis|\batp\b|\bwta\b|\bufc\b|\bmma\b|boxeo|ciclismo|rally|nataci[óo]n|atletismo|balonmano|rugby|\bgolf\b|darts|snooker|cricket|padel|p[áa]del|f[úu]tbol\s+sala|futsal/i;

const MATCH_SEPARATORS = [
  / - /,
  / vs /i,
  /\bvs\.?\s/i,
  /–/,
  /—/,
] as const;

const TEAM_NAME_NOISE = /^(en directo|directo|hoy|esta noche|final|semifinal|cuartos|octavos)$/i;

export interface NormalizedAiringInput {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  sportFacet?: string;
  editorialCategory?: string;
  description?: string;
  channelId: string;
  /** The channel's canonical slug source (the URL the channel page declares canonical), when the airing carries it. */
  channelNormalizedName?: string;
  channelName: string;
  channelGroup?: string;
  streaming?: boolean;
}

/** `/canales/<slug>` by the canonical name, not the internal id (`movistar-laliga` serves `m-laliga-uhd` as canonical). */
export const canonicalChannelPath = (input: Pick<NormalizedAiringInput, 'channelId' | 'channelNormalizedName'>) =>
  channelPagePath(input.channelNormalizedName || input.channelId);

export function slugify(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isFootballAiring(input: NormalizedAiringInput): boolean {
  const facet = String(input.sportFacet || '').trim();
  const title = String(input.title || '').trim();
  const combined = `${facet} ${title}`;

  if (NON_FOOTBALL_SIGNAL.test(combined)) {
    return false;
  }

  if (/f[úu]tbol|futbol/i.test(facet)) {
    return true;
  }

  // A football competition hint in the title is a strong signal only when the
  // program is already inside the sports vertical.
  const category = String(input.editorialCategory || '').toLowerCase();
  if (!/deport|sport|futbol/i.test(category)) {
    return false;
  }

  return getCompetitionCatalog().some((entry) =>
    entry.titleHints.some((hint) => containsFootballHint(title, hint))
  );
}

/** Word-boundary match so "champions" never matches "championship" (golf…). */
function containsFootballHint(title: string, hint: string): boolean {
  const normalized = String(hint || '').toLowerCase();
  if (!normalized) return false;
  return new RegExp(`(^|[^a-z])${escapeRegex(normalized)}($|[^a-z])`, 'i').test(title);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveCompetition(input: NormalizedAiringInput): FootballCompetition {
  const title = String(input.title || '').toLowerCase();
  const facetSlug = slugify(String(input.sportFacet || ''));
  const bySlug = getCompetitionCatalogBySlug(facetSlug);
  if (bySlug) {
    return toCompetitionEntity(bySlug);
  }

  // 2. Title hint matching, longest hint wins (more specific names first).
  let best: CompetitionCatalogEntry | undefined;
  let bestLength = 0;
  for (const entry of getCompetitionCatalog()) {
    for (const hint of entry.titleHints) {
      if (containsFootballHint(title, hint) && hint.length > bestLength) {
        best = entry;
        bestLength = hint.length;
      }
    }
  }
  if (best) {
    return toCompetitionEntity(best);
  }

  // 3. Fallback: unresolved competitions still get a stable slug, but we mark
  //    them as "other" rather than trusting a raw title lead.
  const lead = String(input.title || '').split(/[:·]/)[0]?.trim();
  const fallbackSlug = slugify(lead) || 'competicion';
  return {
    id: `catalog:${fallbackSlug}`,
    slug: fallbackSlug,
    name: lead || 'Competición',
    type: 'other',
    providerIds: {},
    lastUpdatedAt: new Date().toISOString(),
  };
}

interface TeamSplit {
  homeTeam: string;
  awayTeam: string;
}

function trySplitMatchup(value: string): TeamSplit | null {
  for (const separator of MATCH_SEPARATORS) {
    const parts = value
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2 && looksLikeTeamName(parts[0]) && looksLikeTeamName(parts[1])) {
      return { homeTeam: parts[0], awayTeam: parts[1] };
    }
  }
  return null;
}

function looksLikeTeamName(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  return value.length > 0 && value.length <= 40 && words.length <= 6 && !TEAM_NAME_NOISE.test(value);
}

export function splitMatchup(title: string): TeamSplit | null {
  const text = String(title || '').trim();
  const segments = text
    .split(/[:·]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const split = trySplitMatchup(segment);
    if (split) {
      return split;
    }
  }
  return trySplitMatchup(text);
}

export function buildTeamEntity(name: string, country?: string): FootballTeam {
  const slug = slugify(name);
  return {
    id: `team:${slug}`,
    slug,
    name,
    country,
    aliases: [name],
    providerIds: {},
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function inferStatus(startIso: string, endIso: string, reference = new Date()): FootballMatchStatus {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const now = reference.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'scheduled';
  }
  if (now >= start && now < end) {
    return 'live';
  }
  if (now >= end) {
    return 'finished';
  }
  return 'scheduled';
}

const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' });

/**
 * `<home>-<away>-<YYYY-MM-DD>` where the date is the kickoff's Europe/Madrid calendar day, the same day the
 * match is listed under. A 01:00 Madrid kickoff is 23:00 UTC the day before: dating it in UTC built a slug
 * for a day whose listing does not contain the match.
 */
export function buildMatchSlug(home: string, away: string, kickoffIso: string): string {
  const kickoff = new Date(kickoffIso);
  const date = Number.isNaN(kickoff.getTime()) ? kickoffIso.slice(0, 10) : madridDate.format(kickoff);
  const base = `${slugify(home)}-${slugify(away)}`.slice(0, 120);
  return `${base}-${date}`;
}

/** True when `slug` names `match`: its current slug, or the pre-2026-10-20 one dated by the UTC kickoff day. */
export function matchHasSlug(match: { slug: string; kickoffAt: string }, slug: string): boolean {
  return match.slug === slug || `${match.slug.slice(0, -10)}${match.kickoffAt.slice(0, 10)}` === slug;
}

export function buildScore(): FootballScore {
  // EPG never carries a score; keep it null unless a provider supplies one.
  return { home: null, away: null };
}

function buildBroadcast(input: NormalizedAiringInput): FootballBroadcast[] {
  if (!input.channelId || !input.channelName) {
    return [];
  }
  return [
    {
      channelId: input.channelId,
      channelName: input.channelName,
      availability: input.streaming ? 'both' : 'tv',
      provenance: 'airing',
      confidence: 'high',
      channelPath: input.channelId ? canonicalChannelPath(input) : undefined,
    },
  ];
}

/**
 * Normalizes an EPG airing into a `FootballMatch`, or returns `null` when the
 * airing is not a football matchup (talk shows, magazines, single teams…).
 */
export function normalizeEpgAiringToMatch(
  input: NormalizedAiringInput,
  reference = new Date()
): FootballMatch | null {
  if (!isFootballAiring(input)) {
    return null;
  }

  const split = splitMatchup(input.title);
  if (!split) {
    return null;
  }

  const competition = resolveCompetition(input);
  const status = inferStatus(input.start, input.end, reference);
  const homeTeam = buildTeamEntity(split.homeTeam, competition.country);
  const awayTeam = buildTeamEntity(split.awayTeam, competition.country);

  return {
    id: input.id,
    slug: buildMatchSlug(split.homeTeam, split.awayTeam, input.start),
    providerIds: { epg: input.id },
    competition,
    kickoffAt: input.start,
    status,
    homeTeam,
    awayTeam,
    score: buildScore(),
    minute: null,
    broadcasts: buildBroadcast(input),
    sourceProvenance: {
      source: 'epg',
      externalId: input.id,
      confidence: 'high',
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

/** Converts a persisted TVReadAiring document into the normalizer input. */
export function toNormalizedAiringInput(doc: ITVReadAiringDocument): NormalizedAiringInput {
  const channel = (doc as any).channel || {};
  const program = (doc as any).program || {};
  const airing = (doc as any).airing || {};
  return {
    id: String((doc as any).id || (doc as any)._id || ''),
    date: String((doc as any).date || ''),
    start: String(airing.start || (doc as any).start || ''),
    end: String(airing.end || (doc as any).end || ''),
    title: String(program.title || ''),
    sportFacet: program.sportFacet,
    editorialCategory: program.editorialCategory,
    description: program.description,
    channelId: String(channel.id || ''),
    channelNormalizedName: channel.normalizedName ? String(channel.normalizedName) : undefined,
    channelName: String(channel.name || ''),
    channelGroup: channel.group,
    streaming: Boolean((doc as any).availability?.streaming),
  };
}
