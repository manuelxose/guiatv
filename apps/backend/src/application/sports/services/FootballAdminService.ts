/**
 * Football admin read models — every read is served from stored snapshots and
 * projections only. No method here issues an upstream provider call; that is a
 * hard invariant (see FootballAdminService.readsAreProjectionOnly).
 *
 * Every measurement that can be unknown carries an explicit `AvailabilityState`
 * companion field; the value field is `null`/`undefined` when it is not a real
 * measured value (never a fabricated zero). See M06-R1-F01-F09-BACKEND.md.
 */

import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { redact } from '@/application/sports/ingestion/util';
import { MongoDurableQuotaStore } from '@/infrastructure/sports/persistence/DurableQuotaStore';
import {
  FootballSnapshotModel,
  FootballProviderSyncStateModel,
  FootballIngestionRunModel,
} from '@/infrastructure/sports/persistence/models';
import { FootballTeamModel } from '@/infrastructure/sports/models/FootballTeam.model';
import { FootballCompetitionModel } from '@/infrastructure/sports/models/FootballCompetition.model';
import { FootballBroadcastMappingModel } from '@/infrastructure/sports/models/FootballBroadcastMapping.model';
import { AdminOperationalEventModel } from '@/infrastructure/database/models/AdminOperationalEvent.model';
import { AdminOperationModel } from '@/infrastructure/database/models/AdminOperation.model';
import { getCompetitionCatalog } from '@/application/sports/services/FootballCompetitionCatalog';
import { resolveOpenLigaDbCoverage, OPENLIGADB_COMPETITION_MAP } from '@/infrastructure/sports/providers/openLigaDb/OpenLigaDbAdapter';
import { sharedFootballIngestionService } from '@/application/sports/ingestion/footballIngestionContainer';
import {
  AvailabilityState,
  FootballAdminMatchDTO,
  FootballAdminMatchesDTO,
  FootballAuditDTO,
  FootballBroadcastDTO,
  FootballBroadcastsDTO,
  FootballCoverageMatrixDTO,
  FootballCoverageRowDTO,
  FootballDashboardDTO,
  FootballEntityMappingDTO,
  FootballEntityMappingsDTO,
  FootballIngestionStatusDTO,
  FootballProviderDetailDTO,
  FootballProviderSummaryDTO,
  FootballQualityIssueDTO,
  FootballQualityIssuesDTO,
  FootballSyncResultDTO,
  MatchListQuery,
  AuditQuery,
} from '../dto/FootballAdminDTO';

const STALENESS_MS = 6 * 60 * 60 * 1000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function iso(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** `observed` when a stored value exists; `missing` when the field is absent. */
function measuredState(value: unknown): AvailabilityState {
  return value === undefined || value === null ? 'missing' : 'observed';
}

interface DurableQuota {
  consumed: number | null;
  disabled: boolean | null;
  throttleUntil: number | undefined;
  state: AvailabilityState;
}

/** Quota numbers come from the durable authority, never a process-local budget. */
async function durableQuota(): Promise<DurableQuota> {
  const db = mongoose.connection.db;
  // Fail truthful: no database means the quota is unavailable, not zero.
  if (!db) return { consumed: null, disabled: null, throttleUntil: undefined, state: 'unavailable' };
  const store = new MongoDurableQuotaStore(db.collection('football_quota'), db.collection('football_ingestion_control'));
  const windowStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const [consumed, disabled, throttleUntil] = await Promise.all([
    store.consumedInWindow('openligadb', windowStart),
    store.isDisabled('openligadb'),
    store.getThrottleUntil('openligadb'),
  ]);
  return { consumed, disabled, throttleUntil, state: 'observed' };
}

export class FootballAdminService {
  /** Invariant marker: the service never holds a provider/adapter reference. */
  readonly readsAreProjectionOnly = true;

  async dashboard(): Promise<FootballDashboardDTO> {
    const now = new Date();
    const staleAt = new Date(now.getTime() - STALENESS_MS);
    const [competitions, teams, snapshots, providers, mappings, staleSnapshots, lastRun] = await Promise.all([
      FootballCompetitionModel.countDocuments().exec(),
      FootballTeamModel.countDocuments().exec(),
      FootballSnapshotModel.countDocuments().exec(),
      FootballProviderSyncStateModel.countDocuments().exec(),
      FootballBroadcastMappingModel.countDocuments().exec(),
      FootballSnapshotModel.countDocuments({ sourceTimestamp: { $lt: staleAt } }).exec(),
      FootballIngestionRunModel.findOne().sort({ startedAt: -1 }).lean().exec(),
    ]);
    const failedOrEmpty = await FootballIngestionRunModel.countDocuments({ outcome: { $in: ['failed', 'empty'] } }).exec();
    const lastStartedAt = lastRun?.startedAt;
    const lastSyncState: AvailabilityState = lastStartedAt
      ? new Date(lastStartedAt).getTime() < staleAt.getTime()
        ? 'stale'
        : 'observed'
      : 'not_measured';
    return {
      generatedAt: now.toISOString(),
      competitions,
      teams,
      snapshots,
      providers,
      broadcastMappings: mappings,
      staleSnapshots,
      lastSyncAt: iso(lastRun?.startedAt),
      lastSyncOutcome: lastRun?.outcome as FootballDashboardDTO['lastSyncOutcome'],
      openQualityIssues: failedOrEmpty,
      countsState: 'observed',
      lastSyncState,
    };
  }

  async listProviders(): Promise<FootballProviderSummaryDTO[]> {
    const docs = await FootballProviderSyncStateModel.find().lean().exec();
    return docs.map((d) => ({
      provider: d.provider,
      health: (d.consecutiveFailures > 0 ? 'degraded' : d.circuitState === 'open' ? 'down' : 'ok') as FootballProviderSummaryDTO['health'],
      lastSuccessAt: iso(d.lastSuccessAt),
      lastErrorAt: iso(d.lastErrorAt),
      consecutiveFailures: d.consecutiveFailures ?? null,
      consecutiveFailuresState: measuredState(d.consecutiveFailures),
      quotaConsumedToday: d.quotaConsumedToday ?? null,
      quotaConsumedTodayState: measuredState(d.quotaConsumedToday),
      circuitState: d.circuitState ?? 'closed',
    }));
  }

  async providerDetail(provider: string): Promise<FootballProviderDetailDTO | null> {
    const doc = await FootballProviderSyncStateModel.findOne({ provider }).lean().exec();
    if (!doc) return null;
    const runs = await FootballIngestionRunModel.find({ providerId: provider }).sort({ startedAt: -1 }).limit(10).lean().exec();
    return {
      provider: doc.provider,
      health: (doc.consecutiveFailures > 0 ? 'degraded' : doc.circuitState === 'open' ? 'down' : 'ok') as FootballProviderDetailDTO['health'],
      lastSuccessAt: iso(doc.lastSuccessAt),
      lastErrorAt: iso(doc.lastErrorAt),
      consecutiveFailures: doc.consecutiveFailures ?? null,
      consecutiveFailuresState: measuredState(doc.consecutiveFailures),
      quotaConsumedToday: doc.quotaConsumedToday ?? null,
      quotaConsumedTodayState: measuredState(doc.quotaConsumedToday),
      quotaResetAt: iso(doc.quotaResetAt),
      circuitState: doc.circuitState ?? 'closed',
      lastRuns: runs.map((r) => ({
        runId: r.runId,
        startedAt: iso(r.startedAt) ?? '',
        outcome: r.outcome,
        requestsUsed: r.requestsUsed ?? null,
        requestsUsedState: measuredState(r.requestsUsed),
      })),
    };
  }

  async coverageMatrix(): Promise<FootballCoverageMatrixDTO> {
    const catalog = getCompetitionCatalog();
    const slugCounts = await FootballSnapshotModel.aggregate([
      { $group: { _id: '$competitionSlug', count: { $sum: 1 } } },
    ]).exec();
    const countBySlug = new Map<string, number>((slugCounts as Array<{ _id: string; count: number }>).map((r) => [r._id, r.count]));
    const rows: FootballCoverageRowDTO[] = catalog.map((entry) => {
      const shortcut = Object.keys(OPENLIGADB_COMPETITION_MAP).find((key) => OPENLIGADB_COMPETITION_MAP[key] === entry.slug);
      const coverage: ReturnType<typeof resolveOpenLigaDbCoverage> = shortcut
        ? resolveOpenLigaDbCoverage(shortcut, 2026)
        : { state: 'competition_not_covered', leagueShortcut: '', season: '2026', competitionSlug: entry.slug };
      const count = countBySlug.get(entry.slug);
      const snapshotCountState: AvailabilityState =
        coverage.state === 'competition_not_covered'
          ? 'not_covered'
          : coverage.state === 'provider_unavailable'
            ? 'unavailable'
            : coverage.state === 'provider_supported_no_fixtures'
              ? 'empty'
              : 'observed';
      const snapshotCount =
        coverage.state === 'competition_not_covered' || coverage.state === 'provider_unavailable'
          ? null
          : (count ?? 0);
      return {
        competitionSlug: entry.slug,
        name: entry.name,
        type: entry.type,
        coverageState: coverage.state,
        seasonLabel: coverage.seasonLabel,
        snapshotCount,
        snapshotCountState,
      };
    });
    return { generatedAt: new Date().toISOString(), rows };
  }

  async listMatches(query: MatchListQuery): Promise<FootballAdminMatchesDTO> {
    const filter: Record<string, unknown> = {};
    if (query.competitionSlug) filter.competitionSlug = query.competitionSlug;
    if (query.status) filter['match.status'] = query.status;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ 'match.homeTeam.name': rx }, { 'match.awayTeam.name': rx }];
    }
    const [total, docs] = await Promise.all([
      FootballSnapshotModel.countDocuments(filter).exec(),
      FootballSnapshotModel.find(filter)
        .sort({ sourceTimestamp: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean()
        .exec(),
    ]);
    return {
      page: query.page,
      limit: query.limit,
      total,
      items: docs.map((d) => this.toMatchDTO(d)),
    };
  }

  async matchDetail(idOrSlug: string): Promise<FootballAdminMatchDTO | null> {
    const doc = await FootballSnapshotModel.findOne({
      $or: [{ matchId: idOrSlug }, { canonicalKey: idOrSlug }, { 'match.slug': idOrSlug }],
    }).lean().exec();
    return doc ? this.toMatchDTO(doc) : null;
  }

  async listEntityMappings(query: MatchListQuery): Promise<FootballEntityMappingsDTO> {
    const rx = query.q ? new RegExp(escapeRegex(query.q), 'i') : undefined;
    const [competitions, teams] = await Promise.all([
      FootballCompetitionModel.find(rx ? { $or: [{ name: rx }, { slug: rx }] } : {}).lean().exec(),
      FootballTeamModel.find(rx ? { $or: [{ name: rx }, { slug: rx }] } : {}).lean().exec(),
    ]);
    const items: FootballEntityMappingDTO[] = [
      ...competitions.map((c) => ({
        kind: 'competition' as const,
        id: String(c._id),
        slug: c.slug,
        name: c.name,
        providerIds: c.providerIds ?? {},
        lastUpdatedAt: iso(c.lastUpdatedAt),
      })),
      ...teams.map((t) => ({
        kind: 'team' as const,
        id: String(t._id),
        slug: t.slug,
        name: t.name,
        providerIds: t.providerIds ?? {},
        lastUpdatedAt: iso(t.lastUpdatedAt),
      })),
    ].sort((a, b) => (b.lastUpdatedAt ?? '').localeCompare(a.lastUpdatedAt ?? ''));
    const start = (query.page - 1) * query.limit;
    return { page: query.page, limit: query.limit, total: items.length, items: items.slice(start, start + query.limit) };
  }

  async listBroadcasts(query: MatchListQuery): Promise<FootballBroadcastsDTO> {
    const filter: Record<string, unknown> = query.q ? { $or: [{ matchSlug: new RegExp(escapeRegex(query.q), 'i') }, { channelName: new RegExp(escapeRegex(query.q), 'i') }] } : {};
    const [total, docs] = await Promise.all([
      FootballBroadcastMappingModel.countDocuments(filter).exec(),
      FootballBroadcastMappingModel.find(filter).sort({ updatedAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
    ]);
    const items: FootballBroadcastDTO[] = docs.map((d) => ({
      matchId: d.matchId,
      matchSlug: d.matchSlug,
      channelId: d.channelId,
      channelName: d.channelName,
      availability: d.availability,
      provenance: d.provenance,
      confidence: d.confidence,
    }));
    return { page: query.page, limit: query.limit, total, items };
  }

  async ingestionStatus(): Promise<FootballIngestionStatusDTO> {
    const service = sharedFootballIngestionService();
    const [providers, lastRun] = await Promise.all([
      this.listProviders(),
      FootballIngestionRunModel.findOne().sort({ startedAt: -1 }).lean().exec(),
    ]);
    const quota = await durableQuota();
    const providersDetail = await Promise.all(providers.map(async (p) => (await this.providerDetail(p.provider)) ?? (p as FootballProviderDetailDTO)));
    return {
      generatedAt: new Date().toISOString(),
      enabled: service != null,
      providers: providersDetail,
      lastRun: lastRun
        ? {
            startedAt: iso(lastRun.startedAt) ?? '',
            finishedAt: iso(lastRun.finishedAt),
            outcome: lastRun.outcome,
            requestsUsed: lastRun.requestsUsed ?? null,
            requestsUsedState: measuredState(lastRun.requestsUsed),
          }
        : undefined,
      quota: {
        consumed: quota.consumed,
        disabled: quota.disabled,
        throttleUntil: quota.throttleUntil || undefined,
        state: quota.state,
      },
    };
  }

  async qualityIssues(query: MatchListQuery): Promise<FootballQualityIssuesDTO> {
    const issues: FootballQualityIssueDTO[] = [];
    const providers = await FootballProviderSyncStateModel.find({ consecutiveFailures: { $gt: 0 } }).lean().exec();
    for (const p of providers) {
      issues.push({ id: `provider-${p.provider}`, kind: 'provider_failure', message: `${p.provider}: ${p.consecutiveFailures} consecutive failures` });
    }
    const staleCount = await FootballSnapshotModel.countDocuments({ sourceTimestamp: { $lt: new Date(Date.now() - STALENESS_MS) } }).exec();
    if (staleCount > 0) issues.push({ id: 'stale-snapshots', kind: 'stale', message: `${staleCount} snapshots older than 6h` });
    const emptyRuns = await FootballIngestionRunModel.find({ outcome: 'empty' }).sort({ startedAt: -1 }).limit(5).lean().exec();
    for (const r of emptyRuns) {
      issues.push({ id: `empty-${r.runId}`, kind: 'empty_ingestion', message: `run ${r.runId} returned no fixtures` });
    }
    const start = (query.page - 1) * query.limit;
    return { page: query.page, limit: query.limit, total: issues.length, items: issues.slice(start, start + query.limit) };
  }

  async listAudit(query: AuditQuery): Promise<FootballAuditDTO> {
    const filter: Record<string, unknown> = {};
    if (query.severity) filter.severity = query.severity;
    if (query.subsystem) filter.subsystem = query.subsystem;
    const [total, docs] = await Promise.all([
      AdminOperationalEventModel.countDocuments(filter).exec(),
      AdminOperationalEventModel.find(filter).sort({ timestamp: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
    ]);
    return {
      page: query.page,
      limit: query.limit,
      total,
      items: docs.map((d) => ({
        timestamp: iso(d.timestamp) ?? '',
        severity: d.severity,
        subsystem: d.subsystem,
        message: redact(d.message),
        correlationId: d.correlationId,
      })),
    };
  }

  /** Manual sync: idempotency-keyed, audited, and truthfully status-reported. */
  async enqueueSync(actor: string, idempotencyKey?: string): Promise<FootballSyncResultDTO> {
    const correlationId = idempotencyKey || `football.sync.${randomUUID()}`;
    const existing = await AdminOperationModel.findOne({ correlationId, type: 'football.sync' }).lean().exec();
    if (existing) {
      return { id: String(existing._id), status: existing.status, correlationId };
    }
    const job = await AdminOperationModel.create({
      type: 'football.sync',
      status: 'queued',
      queuedAt: new Date(),
      attempts: 1,
      triggeredBy: actor,
      correlationId,
      target: 'manual-sync',
    });
    await AdminOperationalEventModel.create({
      timestamp: new Date(),
      severity: 'info',
      subsystem: 'football',
      message: `Queued manual football sync`,
      correlationId,
      jobId: String(job._id),
    });
    void (async () => {
      try {
        await AdminOperationModel.updateOne({ _id: job._id }, { status: 'running', startedAt: new Date(), currentStep: 'Ingesting' });
        const service = sharedFootballIngestionService();
        if (!service) throw new Error('Football ingestion is disabled');
        await service.runTick();
        await AdminOperationModel.updateOne({ _id: job._id }, { status: 'completed', completedAt: new Date(), progress: 100 });
      } catch (error) {
        await AdminOperationModel.updateOne(
          { _id: job._id },
          { status: 'failed', completedAt: new Date(), errorSummary: redact(error instanceof Error ? error.message : String(error)).slice(0, 240) }
        );
      }
    })();
    return { id: String(job._id), status: 'queued', correlationId };
  }

  private toMatchDTO(d: { matchId: string; canonicalKey: string; competitionSlug: string; sourceTimestamp: Date; ingestedAt: Date; contentHash: string; match: Record<string, any> }): FootballAdminMatchDTO {
    const m = d.match ?? {};
    const hasScore = typeof m.score?.home === 'number' || typeof m.score?.away === 'number';
    return {
      matchId: d.matchId,
      canonicalKey: d.canonicalKey,
      competitionSlug: d.competitionSlug,
      kickoffAt: typeof m.kickoffAt === 'string' ? m.kickoffAt : undefined,
      kickoffState: measuredState(typeof m.kickoffAt === 'string' ? m.kickoffAt : undefined),
      status: typeof m.status === 'string' ? m.status : undefined,
      statusState: measuredState(typeof m.status === 'string' ? m.status : undefined),
      homeTeam: typeof m.homeTeam?.name === 'string' ? m.homeTeam.name : undefined,
      homeTeamState: measuredState(typeof m.homeTeam?.name === 'string' ? m.homeTeam.name : undefined),
      awayTeam: typeof m.awayTeam?.name === 'string' ? m.awayTeam.name : undefined,
      awayTeamState: measuredState(typeof m.awayTeam?.name === 'string' ? m.awayTeam.name : undefined),
      score: m.score ? { home: m.score.home ?? null, away: m.score.away ?? null } : undefined,
      scoreState: hasScore ? 'observed' : 'missing',
      ingestedAt: iso(d.ingestedAt) ?? '',
      contentHash: d.contentHash,
    };
  }
}
