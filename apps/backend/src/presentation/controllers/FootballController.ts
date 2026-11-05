import { Request, Response } from 'express';
import { successResponse } from '@/shared/types/ApiResponse';
import { NotFoundError, ValidationError } from '@/shared/errors';
import { FootballQueryService } from '@/application/sports/services/FootballQueryService';
import { BroadcastReconciliationService } from '@/application/sports/services/BroadcastReconciliationService';
import { normalizeMatchStatus } from '@/domain/sports/football/types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 10; // football-data.org rejects wider ranges

/** Optional inclusive day range (YYYY-MM-DD). Both bounds or neither; at most 10 days. Exported for tests. */
export function parseDateRange(from: unknown, to: unknown): { dateFrom?: string; dateTo?: string } {
  if (from === undefined && to === undefined) return {};
  const [a, b] = [String(from ?? ''), String(to ?? '')];
  const ms = (d: string) => {
    const t = DAY.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
    return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? NaN : t; // rejects 2026-02-31
  };
  const span = (ms(b) - ms(a)) / 86_400_000;
  if (Number.isNaN(span) || span < 0 || span > MAX_RANGE_DAYS) {
    throw new ValidationError('dateFrom and dateTo must be YYYY-MM-DD, ordered, at most 10 days apart', [
      { field: 'dateFrom', message: 'Invalid range', value: { from, to } },
    ]);
  }
  return { dateFrom: a, dateTo: b };
}

export class FootballController {
  constructor(
    private readonly footballQueryService: FootballQueryService,
    private readonly reconciliation: BroadcastReconciliationService
  ) {}

  async home(_req: Request, res: Response): Promise<void> {
    const result = await this.footballQueryService.getHome();
    res.status(200).json(successResponse(result, { generatedAt: result.generatedAt }));
  }

  async matches(req: Request, res: Response): Promise<void> {
    const result = await this.footballQueryService.getMatches({
      date: req.query.date ? String(req.query.date) : undefined,
      ...parseDateRange(req.query.dateFrom, req.query.dateTo),
      status: req.query.status ? normalizeMatchStatus(String(req.query.status)) : undefined,
      competitionSlug: req.query.competition ? String(req.query.competition) : undefined,
      teamSlug: req.query.team ? String(req.query.team) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.status(200).json(successResponse(result, result.meta));
  }

  async liveMatches(_req: Request, res: Response): Promise<void> {
    const result = await this.footballQueryService.getLiveMatches();
    res.status(200).json(successResponse(result, result.meta));
  }

  async matchDetail(req: Request, res: Response): Promise<void> {
    const idOrSlug = String(req.params.idOrSlug || '').trim();
    if (!idOrSlug) {
      throw new ValidationError('Match id or slug is required', [
        { field: 'idOrSlug', message: 'Required', value: idOrSlug },
      ]);
    }
    const result = await this.footballQueryService.getMatch(idOrSlug);
    res.status(200).json(successResponse(result, result.meta));
  }

  async competitions(_req: Request, res: Response): Promise<void> {
    const result = await this.footballQueryService.getCompetitions();
    res.status(200).json(successResponse(result, result.meta));
  }

  async competitionDetail(req: Request, res: Response): Promise<void> {
    const slug = String(req.params.slug || '').trim();
    const result = await this.footballQueryService.getCompetition(slug);
    res.status(200).json(successResponse(result, result.meta));
  }

  async teamDetail(req: Request, res: Response): Promise<void> {
    const slug = String(req.params.slug || '').trim();
    const result = await this.footballQueryService.getTeam(slug);
    res.status(200).json(successResponse(result, result.meta));
  }

  async news(req: Request, res: Response): Promise<void> {
    const news = await this.footballQueryService.getNews({
      teamId: req.query.team ? String(req.query.team) : undefined,
      competitionId: req.query.competition ? String(req.query.competition) : undefined,
      matchId: req.query.match ? String(req.query.match) : undefined,
      slug: req.query.slug ? String(req.query.slug) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.status(200).json(
      successResponse(
        { news },
        { total: news.length, generatedAt: new Date().toISOString() }
      )
    );
  }

  async search(req: Request, res: Response): Promise<void> {
    const result = await this.footballQueryService.search(String(req.query.q || ''));
    res.status(200).json(successResponse(result, result.meta));
  }

  async upsertBroadcastOverride(req: Request, res: Response): Promise<void> {
    const { matchId, matchSlug, channelId, channelName } = req.body || {};
    if (!matchId || !channelId || !channelName) {
      throw new ValidationError('matchId, channelId and channelName are required', [
        {
          field: 'override',
          message: 'Missing required fields',
          value: req.body,
        },
      ]);
    }
    await this.reconciliation.upsertOverride(
      String(matchId),
      String(matchSlug || ''),
      String(channelId),
      String(channelName)
    );
    await this.footballQueryService.invalidatePublicReads();
    res.status(200).json(successResponse({ saved: true }));
  }

  async clearBroadcastOverride(req: Request, res: Response): Promise<void> {
    const { matchId, channelId } = req.body || {};
    if (!matchId || !channelId) {
      throw new ValidationError('matchId and channelId are required', [
        { field: 'override', message: 'Missing required fields', value: req.body },
      ]);
    }
    await this.reconciliation.clearOverride(String(matchId), String(channelId));
    await this.footballQueryService.invalidatePublicReads();
    res.status(200).json(successResponse({ cleared: true }));
  }
}

// Re-exported for convenience in route factories.
export const footballNotFound = (resource: string, identifier: string) =>
  new NotFoundError(resource, identifier);
