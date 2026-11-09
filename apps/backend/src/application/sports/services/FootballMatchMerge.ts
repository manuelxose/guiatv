/**
 * Cross-provider match merge (M07): the single public view of a fixture.
 *
 * Every provider stores its own snapshots (identity `providerId:matchId`, never
 * overwritten by another provider). At READ time the same real fixture reported by
 * several providers is folded into one match:
 *
 *  - Identity: same competition, kickoff within MAX_KICKOFF_DRIFT_MS, and BOTH team
 *    names matching (accent/stopword-insensitive token match).
 *  - Base record (id, slug, teams, events): the first provider in PROVIDER_ORDER, so
 *    public URLs that already exist keep resolving.
 *  - Status/score/minute: the strongest claim wins. A provider-confirmed result beats
 *    a live minute, which beats an explicit postponement, which beats a clock-inferred
 *    "live", which beats "scheduled". Nothing is ever promoted beyond what a provider
 *    said.
 *  - Gaps (crest, logo, venue, statistics) are filled from the other providers.
 *  - A "live" with no minute whose kickoff is older than LIVE_WINDOW_MS is not live:
 *    it falls back to `scheduled` (the UI shows "sin resultado").
 */

import { FootballMatch, FootballTeam } from '../../../domain/sports/football/types';

export const PROVIDER_ORDER = ['openligadb', 'footballdata-io', 'football-data-org'] as const;
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const MAX_KICKOFF_DRIFT_MS = 3 * 60 * 60 * 1000;

const STOPWORDS = new Set([
  'fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ud', 'rcd', 'ca', 'sd', 'rc', 'sv', 'vfb', 'vfl', 'tsg', 'bv', 'club', 'de', 'la', 'el', 'the', 'and',
  'calcio', 'football', 'futbol',
]);

/** OpenLigaDB publishes German exonyms ("AC Mailand", "SSC Neapel"); map them to the international form. */
const EXONYMS: Record<string, string> = {
  mailand: 'milan', neapel: 'napoli', kopenhagen: 'copenhagen', lissabon: 'lisbon', turin: 'torino', rom: 'roma',
  munchen: 'munich', koln: 'cologne', prag: 'prague', moskau: 'moscow', bruegge: 'brugge', brugge: 'brugge', genua: 'genoa',
  florenz: 'fiorentina', sevilla: 'sevilla', glasgow: 'glasgow', eindhoven: 'psv', belgrad: 'belgrade', athen: 'athens',
};

function tokens(name: string | undefined): string[] {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .map((t) => EXONYMS[t] ?? t)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Shared significant token, compared on a 5-letter prefix ("villareal" ~ "villarreal" via "villa"). */
export function sameTeam(a: Pick<FootballTeam, 'name' | 'shortName'>, b: Pick<FootballTeam, 'name' | 'shortName'>): boolean {
  const left = new Set(tokens(a.name).map((t) => t.slice(0, 5)));
  return tokens(b.name).some((t) => left.has(t.slice(0, 5)));
}

export function sameFixture(a: FootballMatch, b: FootballMatch): boolean {
  if (a.competition?.slug !== b.competition?.slug) return false;
  const drift = Math.abs(Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
  if (!(drift <= MAX_KICKOFF_DRIFT_MS)) return false;
  return sameTeam(a.homeTeam, b.homeTeam) && sameTeam(a.awayTeam, b.awayTeam);
}

function providerOf(m: FootballMatch): string {
  return m.sourceProvenance?.source ?? Object.keys(m.providerIds ?? {})[0] ?? '';
}

function providerRank(m: FootballMatch): number {
  const i = (PROVIDER_ORDER as readonly string[]).indexOf(providerOf(m));
  return i === -1 ? PROVIDER_ORDER.length : i;
}

/** Strength of the status claim (higher wins). */
function claimStrength(m: FootballMatch): number {
  if (m.status === 'finished') return m.score?.home != null && m.score?.away != null ? 6 : 5;
  if ((m.status === 'live' || m.status === 'halftime') && (m.minute != null || m.status === 'halftime')) return 4;
  if (m.status === 'postponed' || m.status === 'suspended' || m.status === 'cancelled') return 3;
  if (m.status === 'live') return 2;
  return 1;
}

function fillTeam(base: FootballTeam, others: FootballTeam[]): FootballTeam {
  return {
    ...base,
    // Provider order (OpenLigaDB first): measured 2026-11-09, its crests load while many
    // footballdata.io /matches crest paths 404. Inline data: crests are dropped by the UI, so skip them.
    crest: [base, ...others].find((t) => /^https?:\/\//i.test(t.crest ?? ''))?.crest ?? base.crest ?? null,
    providerIds: Object.assign({}, ...others.map((t) => t.providerIds ?? {}), base.providerIds ?? {}),
  };
}

function sameScore(a: FootballMatch, b: FootballMatch): boolean {
  return a.score?.home === b.score?.home && a.score?.away === b.score?.away;
}

/** Applies the live window: an unconfirmed "live" past it is not live any more. */
export function boundLive(m: FootballMatch, nowMs: number): FootballMatch {
  if (m.status !== 'live' || m.minute != null) return m;
  const since = nowMs - Date.parse(m.kickoffAt);
  return since > LIVE_WINDOW_MS ? { ...m, status: 'scheduled' } : m;
}

export function mergeFixtureGroup(group: FootballMatch[], nowMs: number = Date.now()): FootballMatch {
  const ordered = [...group].sort((a, b) => providerRank(a) - providerRank(b));
  const base = ordered[0];
  if (ordered.length === 1) return boundLive(base, nowMs);
  const others = ordered.slice(1);
  // Strongest claim; ties keep provider order.
  const best = ordered.reduce((acc, m) => (claimStrength(m) > claimStrength(acc) ? m : acc), base);
  const merged: FootballMatch = {
    ...base,
    providerIds: Object.assign({}, ...others.map((m) => m.providerIds ?? {}), base.providerIds ?? {}),
    competition: { ...base.competition, logo: base.competition?.logo ?? others.find((m) => m.competition?.logo)?.competition.logo ?? null },
    homeTeam: fillTeam(base.homeTeam, others.map((m) => m.homeTeam)),
    awayTeam: fillTeam(base.awayTeam, others.map((m) => m.awayTeam)),
    status: best.status,
    score: best.score,
    minute: best.minute,
    venue: base.venue ?? others.find((m) => m.venue)?.venue,
    round: base.round ?? others.find((m) => m.round)?.round,
    statistics: best.statistics ?? ordered.find((m) => m.statistics)?.statistics,
    // Goal events only from a provider whose own score agrees with the one shown.
    events: ordered.find((m) => m.events?.length && sameScore(m, best))?.events,
    sourceProvenance: best.sourceProvenance,
    lastUpdatedAt: ordered.map((m) => m.lastUpdatedAt).filter(Boolean).sort().at(-1) ?? base.lastUpdatedAt,
  };
  if (merged.minute == null) delete merged.minute;
  return boundLive(merged, nowMs);
}

/** Folds the same fixture from several providers into one match; order of first appearance is kept. */
export function mergeProviderMatches(matches: readonly FootballMatch[], nowMs: number = Date.now()): FootballMatch[] {
  const groups: FootballMatch[][] = [];
  for (const match of matches) {
    if (!match) continue;
    const group = groups.find((g) => providerOf(g[0]) !== providerOf(match) && !g.some((m) => providerOf(m) === providerOf(match)) && sameFixture(g[0], match));
    if (group) group.push(match);
    else groups.push([match]);
  }
  return groups.map((g) => mergeFixtureGroup(g, nowMs));
}
