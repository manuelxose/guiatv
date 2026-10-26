/**
 * Broadcast reconciliation engine.
 *
 * Relates `FootballMatch` <-> EPG `TvReadAiring` <-> channel so the product can
 * answer "¿dónde puedo verlo?" with real data. Matching never relies on exact
 * titles: it scores team aliases, competition, kickoff proximity and channel,
 * and only surfaces high/medium confidence associations. Manual overrides are
 * persisted and survive syncs.
 */

import { TVReadAiringModel } from '../../../infrastructure/database/models/TVReadAiring.model';
import { FootballBroadcastMappingModel } from '../../../infrastructure/sports/models/FootballBroadcastMapping.model';
import { ICacheRepository } from '../../../domain/repositories/ICacheRepository';
import { StaleWhileRevalidateCache } from '../../../infrastructure/cache/StaleWhileRevalidateCache';
import {
  BroadcastConfidence,
  FootballMatch,
} from '../../../domain/sports/football/types';
import {
  canonicalChannelPath,
  isFootballAiring,
  resolveCompetition,
  splitMatchup,
  toNormalizedAiringInput,
} from '../../../application/sports/services/FootballNormalizer';
import { channelPagePath } from '../../../shared/utils/tvMetadata';

const KICKOFF_PROXIMITY_MS = 30 * 60 * 1000; // ±30 minutes

interface Candidate {
  airing: any;
  channelId: string;
  channelName: string;
  score: number;
  confidence: BroadcastConfidence;
}

export class BroadcastReconciliationService {
  private readonly airingCache: StaleWhileRevalidateCache;

  constructor(cacheRepository?: ICacheRepository) {
    this.airingCache = new StaleWhileRevalidateCache(cacheRepository);
  }

  /** Attach broadcasts to matches by reconciling with the EPG read model. */
  async reconcile(matches: FootballMatch[]): Promise<FootballMatch[]> {
    if (!matches.length) {
      return matches;
    }

    const airings = await this.loadSportsAirings();
    const overrides = await this.loadOverrides(matches.map((match) => match.id));
    const airingsByHour = this.indexAiringsByHour(airings);

    return matches.map((match) => {
      const existing = match.broadcasts.filter((broadcast) => broadcast.provenance === 'airing');

      // 1. Admin overrides always win (they survive syncs).
      const matchOverrides = (overrides.get(match.id) || []).map((override) => ({
        channelId: override.channelId,
        channelName: override.channelName,
        availability: override.availability,
        provenance: 'override' as const,
        confidence: 'high' as const,
        channelPath: override.channelId ? channelPagePath(override.channelId) : undefined,
      }));

      if (matchOverrides.length) {
        return { ...match, broadcasts: matchOverrides };
      }

      // 2. If a provider already links an airing, keep it.
      if (existing.length) {
        return match;
      }

      // 3. Reconcile against EPG airings.
      const candidates = this.matchCandidates(match, this.nearbyAirings(match, airingsByHour));
      if (candidates.length) {
        const best = candidates[0];
        if (best.confidence !== 'low') {
          return {
            ...match,
            broadcasts: [
              {
                channelId: best.channelId,
                channelName: best.channelName,
                availability: 'tv',
                provenance: 'reconciliation',
                confidence: best.confidence,
                channelPath: best.channelId ? canonicalChannelPath(toNormalizedAiringInput(best.airing)) : undefined,
              },
            ],
          };
        }
      }

      return match;
    });
  }

  async upsertOverride(
    matchId: string,
    matchSlug: string,
    channelId: string,
    channelName: string
  ): Promise<void> {
    await FootballBroadcastMappingModel.updateOne(
      { matchId, channelId },
      {
        $set: {
          matchSlug,
          channelName,
          availability: 'tv',
          provenance: 'override',
          confidence: 'high',
        },
      },
      { upsert: true }
    ).exec();
  }

  async clearOverride(matchId: string, channelId: string): Promise<void> {
    await FootballBroadcastMappingModel.deleteOne({ matchId, channelId }).exec();
  }

  private async loadSportsAirings(): Promise<any[]> {
    const windowKey = new Date().toISOString().slice(0, 10);
    return this.airingCache.getOrLoad(
      `v2:football:reconciliation:airings:${windowKey}`,
      { freshSeconds: 5 * 60, staleSeconds: 30 * 60 },
      () => this.querySportsAirings()
    );
  }

  private async querySportsAirings(): Promise<any[]> {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dateKeys = this.windowDateKeys(from, to);
    const docs = await TVReadAiringModel.find({
      date: { $in: dateKeys },
      $or: [
        { 'program.sportFacet': 'Fútbol' },
        { 'program.editorialCategory': 'Deportes' },
      ],
      'airing.start': { $gte: from.toISOString(), $lte: to.toISOString() },
    })
      .select({ channel: 1, program: 1, airing: 1, availability: 1, sourceProvenance: 1 })
      .lean()
      .exec();
    return (docs as any[]).filter((doc) => isFootballAiring(toNormalizedAiringInput(doc)));
  }

  private windowDateKeys(start: Date, end: Date): string[] {
    const keys: string[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      keys.push(`${y}${m}${d}`);
      cursor.setDate(cursor.getDate() + 1);
      if (keys.length > 12) break;
    }
    return keys;
  }

  private async loadOverrides(matchIds: string[]): Promise<Map<string, any[]>> {
    const docs = await FootballBroadcastMappingModel.find({
      matchId: { $in: matchIds },
      provenance: 'override',
    })
      .lean()
      .exec();
    const map = new Map<string, any[]>();
    for (const doc of docs) {
      const list = map.get(doc.matchId) || [];
      list.push(doc);
      map.set(doc.matchId, list);
    }
    return map;
  }

  private matchCandidates(match: FootballMatch, airings: any[]): Candidate[] {
    const matchKickoff = new Date(match.kickoffAt).getTime();
    const candidates: Candidate[] = [];

    for (const airing of airings) {
      const input = toNormalizedAiringInput(airing);
      const split = splitMatchup(input.title);
      if (!split) continue;

      let score = 0;
      score += this.teamAliasScore(match.homeTeam, split.homeTeam);
      score += this.teamAliasScore(match.awayTeam, split.awayTeam);

      const comp = resolveCompetition(input);
      if (comp.slug === match.competition.slug) score += 30;

      const airingStart = new Date(input.start).getTime();
      const delta = Math.abs(airingStart - matchKickoff);
      if (delta <= KICKOFF_PROXIMITY_MS) score += 30;
      else if (delta <= 2 * KICKOFF_PROXIMITY_MS) score += 15;

      const confidence: BroadcastConfidence =
        score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

      candidates.push({
        airing,
        channelId: input.channelId,
        channelName: input.channelName,
        score,
        confidence,
      });
    }

    return candidates
      .filter((candidate) => candidate.confidence !== 'low')
      .sort((a, b) => b.score - a.score);
  }

  private indexAiringsByHour(airings: any[]): Map<number, any[]> {
    const index = new Map<number, any[]>();
    for (const airing of airings) {
      const start = new Date(toNormalizedAiringInput(airing).start).getTime();
      if (!Number.isFinite(start)) continue;
      const bucket = Math.floor(start / (60 * 60 * 1000));
      const entries = index.get(bucket) || [];
      entries.push(airing);
      index.set(bucket, entries);
    }
    return index;
  }

  private nearbyAirings(match: FootballMatch, index: Map<number, any[]>): any[] {
    const kickoff = new Date(match.kickoffAt).getTime();
    if (!Number.isFinite(kickoff)) return [];
    const bucket = Math.floor(kickoff / (60 * 60 * 1000));
    return [bucket - 1, bucket, bucket + 1].flatMap((key) => index.get(key) || []);
  }

  private teamAliasScore(a: { name: string }, b: string): number {
    const normalizedA = this.normalize(a.name);
    const normalizedB = this.normalize(b);
    if (!normalizedA || !normalizedB) return 0;
    if (normalizedA === normalizedB) return 40;
    if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 25;
    return 0;
  }

  private normalize(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }
}
