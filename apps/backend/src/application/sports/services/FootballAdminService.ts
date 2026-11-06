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
import { TickResult } from '@/application/sports/ingestion/types';
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
  FootballSyncOperationDTO,
  FootballSyncOperationsDTO,
  FootballSyncResultDTO,
  FootballSyncStatus,
  MatchListQuery,
  AuditQuery,
  EntityMappingQuery,
  SyncListQuery,
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

/**
 * R1-6: health is NEVER 'ok' when the failure counter was not measured. A legacy
 * or partial document without consecutiveFailures cannot justify a healthy
 * verdict, so it reports 'unknown' (never a fabricated 'ok').
 */
function providerHealth(consecutiveFailures: number | null | undefined, circuitState: string | null | undefined): string {
  if (circuitState === 'open') return 'down';
  if (consecutiveFailures == null) return 'unknown';
  return consecutiveFailures > 0 ? 'degraded' : 'ok';
}

/** Maps a tick outcome to a truthful terminal operation status (F06). */
function mapTickToOperation(tick: TickResult): {
  status: FootballSyncStatus;
  /** Null means "not measured", never "zero records". */
  recordsFetched: number | null;
  errors: string[];
  skipReason?: string;
  quotaOutcome?: 'allowed' | 'exhausted';
} {
  // F06: use the tick's OWN measurement of fetched matches. Summing bucket counts
  // was a derivation, not a measurement: buckets classify match STATUS, so a tick
  // that fetched matches would have reported a number that only happened to be
  // non-zero, and an unclassified tick would have reported a fabricated 0.
  const recordsFetched: number | null =
    typeof tick.matchesFetched === 'number' ? tick.matchesFetched : null;
  switch (tick.outcome) {
    case 'success':
    case 'partial':
      return { status: 'succeeded', recordsFetched, errors: [], quotaOutcome: 'allowed' };
    case 'empty':
      // A successful fetch that yielded no matches is a MEASURED zero.
      return {
        status: 'empty',
        recordsFetched: recordsFetched ?? 0,
        errors: [],
        skipReason: tick.reason ?? 'no records returned',
        quotaOutcome: 'allowed',
      };
    case 'failed':
      return { status: 'failed', recordsFetched, errors: tick.reason ? [tick.reason] : [], quotaOutcome: 'allowed' };
    case 'skipped':
      // R1-2: a skipped/throttled run NEVER measured records — it did not run.
      // Reporting 0 with state "observed" would be the exact
      // "unavailable-as-zero" anti-pattern F09 removes. Only 'empty' is a
      // MEASURED zero (the fetch succeeded and found nothing).
      if (tick.reason === 'budget_exhausted') {
        return { status: 'throttled', recordsFetched: null, errors: [], skipReason: tick.reason, quotaOutcome: 'exhausted' };
      }
      return { status: 'skipped', recordsFetched: null, errors: [], skipReason: tick.reason ?? 'skipped', quotaOutcome: 'allowed' };
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { code?: number; message?: string };
  const message = typeof e.message === 'string' ? e.message : '';
  return e.code === 11000 || message.includes('E11000') || message.toLowerCase().includes('duplicate key');
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
      health: providerHealth(d.consecutiveFailures, d.circuitState) as FootballProviderSummaryDTO['health'],
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
      health: providerHealth(doc.consecutiveFailures, doc.circuitState) as FootballProviderDetailDTO['health'],
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

  async listEntityMappings(query: EntityMappingQuery): Promise<FootballEntityMappingsDTO> {
    // F08: server-side pagination across the two entity collections. Filter,
    // count, sort, skip and limit all happen in the database (`$unionWith` +
    // `$facet`), so only `limit` documents ever leave Mongo — no unbounded scan
    // into memory and no unbounded response payload.
    const filter = this.entityMappingFilter(query.q);
    const sortSpec = this.entityMappingSort(query.sort, query.order);
    const start = (query.page - 1) * query.limit;
    const project = (kind: 'team' | 'competition') => [
      { $match: filter },
      { $project: { kind: { $literal: kind }, slug: 1, name: 1, providerIds: 1, lastUpdatedAt: 1 } },
    ];
    const facet = [
      { $sort: sortSpec },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          items: [{ $skip: start }, { $limit: query.limit }],
        },
      },
    ];

    let resultDoc: { meta?: Array<{ total: number }>; items?: Array<Record<string, any>> } | undefined;
    if (query.kind === 'team') {
      [resultDoc] = await FootballTeamModel.aggregate([...project('team'), ...facet] as any[]).exec();
    } else if (query.kind === 'competition') {
      [resultDoc] = await FootballCompetitionModel.aggregate([...project('competition'), ...facet] as any[]).exec();
    } else {
      [resultDoc] = await FootballCompetitionModel.aggregate([
        ...project('competition'),
        { $unionWith: { coll: 'football_teams', pipeline: project('team') } },
        ...facet,
      ] as any[]).exec();
    }

    const total = resultDoc?.meta?.[0]?.total ?? 0;
    const items: FootballEntityMappingDTO[] = (resultDoc?.items ?? []).map((d) => ({
      kind: d.kind,
      id: String(d._id),
      slug: d.slug,
      name: d.name,
      providerIds: d.providerIds ?? {},
      lastUpdatedAt: iso(d.lastUpdatedAt),
    }));
    return { page: query.page, limit: query.limit, total, items };
  }

  /** Regex search is always escaped and length-bounded by the DTO parser. */
  private entityMappingFilter(q?: string): Record<string, unknown> {
    if (!q) return {};
    const rx = new RegExp(escapeRegex(q), 'i');
    return { $or: [{ name: rx }, { slug: rx }] };
  }

  /**
   * Deterministic total ordering: the requested sort field/direction, then
   * `slug` (asc), then `_id` (asc) — so pages are stable across boundaries even
   * when many entities share the same sort key. `sort` is already allow-listed
   * by `parseEntityMappingQuery`.
   */
  private entityMappingSort(
    sort: EntityMappingQuery['sort'],
    order: EntityMappingQuery['order']
  ): Record<string, 1 | -1> {
    const direction: 1 | -1 = order === 'asc' ? 1 : -1;
    const spec: Record<string, 1 | -1> = { [sort]: direction };
    if (sort !== 'slug') spec.slug = 1;
    spec._id = 1;
    return spec;
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

  /** Manual sync: idempotency-keyed (database-enforced), audited, and truthfully status-reported. */
  async enqueueSync(actor: string, idempotencyKey?: string, scope?: string): Promise<FootballSyncResultDTO> {
    const correlationId = idempotencyKey || `football.sync.${randomUUID()}`;
    const doc: Record<string, unknown> = {
      type: 'football.sync',
      status: 'queued',
      queuedAt: new Date(),
      attempts: 1,
      triggeredBy: actor,
      correlationId,
      scope: scope ?? 'full',
      target: 'manual-sync',
    };
    // Only set the key when the client supplied one, so the partial unique index
    // never collides on auto-generated (keyless) correlations.
    if (idempotencyKey) doc.idempotencyKey = idempotencyKey;

    try {
      const job = await AdminOperationModel.create(doc);
      await AdminOperationalEventModel.create({
        timestamp: new Date(),
        severity: 'info',
        subsystem: 'football',
        message: `Queued manual football sync`,
        correlationId,
        jobId: String(job._id),
      });
      void this.executeSync(job._id);
      return this.toSyncOperationDTO(job.toObject());
    } catch (error) {
      // Atomic idempotency: a concurrent identical request hit the unique index.
      if (isDuplicateKeyError(error) && idempotencyKey) {
        const winner = await AdminOperationModel.findOne({ type: 'football.sync', idempotencyKey }).lean().exec();
        if (winner) return this.toSyncOperationDTO(winner);
      }
      throw error;
    }
  }

  /** Operation history for the sync screen — truthful states, newest first. */
  async listSyncOperations(query: SyncListQuery): Promise<FootballSyncOperationsDTO> {
    const filter: Record<string, unknown> = { type: 'football.sync' };
    if (query.status) filter.status = query.status;
    const [total, docs] = await Promise.all([
      AdminOperationModel.countDocuments(filter).exec(),
      AdminOperationModel.find(filter).sort({ queuedAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean().exec(),
    ]);
    return { page: query.page, limit: query.limit, total, items: docs.map((d) => this.toSyncOperationDTO(d)) };
  }

  private async executeSync(operationId: unknown): Promise<void> {
    try {
      await AdminOperationModel.updateOne(
        { _id: operationId },
        { status: 'running', startedAt: new Date(), currentStep: 'Ingesting' }
      );
      const service = sharedFootballIngestionService();
      if (!service) throw new Error('Football ingestion is disabled');
      const tick = await service.runTick();
      // Never collapse outcomes into a generic success: map each tick outcome to
      // its own terminal status. An all-empty tick is `empty` (never `succeeded`,
      // and it never advances lastSuccessAt — that is the ingestion service's F03
      // guarantee, which we merely record truthfully).
      const mapped = mapTickToOperation(tick);
      await AdminOperationModel.updateOne(
        { _id: operationId },
        {
          status: mapped.status,
          completedAt: new Date(),
          outcome: tick.outcome,
          recordsFetched: mapped.recordsFetched,
          recordsPersisted: tick.snapshotsWritten,
          errors: mapped.errors,
          skipReason: mapped.skipReason,
          quotaOutcome: mapped.quotaOutcome,
          currentStep: mapped.status,
        }
      );
    } catch (error) {
      const summary = redact(error instanceof Error ? error.message : String(error)).slice(0, 240);
      await AdminOperationModel.updateOne(
        { _id: operationId },
        { status: 'failed', completedAt: new Date(), errorSummary: summary, currentStep: 'Failed', errors: [summary] }
      );
    }
  }

  private toSyncOperationDTO(d: Record<string, any>): FootballSyncOperationDTO {
    const fetchedSet = typeof d.recordsFetched === 'number';
    const persistedSet = typeof d.recordsPersisted === 'number';
    return {
      id: String(d._id),
      status: d.status,
      outcome: d.outcome,
      scope: d.scope ?? 'full',
      triggeredBy: d.triggeredBy ?? '',
      correlationId: d.correlationId ?? '',
      idempotencyKey: d.idempotencyKey,
      queuedAt: iso(d.queuedAt),
      startedAt: iso(d.startedAt),
      completedAt: iso(d.completedAt),
      recordsFetched: fetchedSet ? d.recordsFetched : null,
      recordsFetchedState: fetchedSet ? 'observed' : 'not_measured',
      recordsPersisted: persistedSet ? d.recordsPersisted : null,
      recordsPersistedState: persistedSet ? 'observed' : 'not_measured',
      errors: Array.isArray(d.errors) ? d.errors : [],
      skipReason: d.skipReason,
      quotaOutcome: d.quotaOutcome,
    };
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

