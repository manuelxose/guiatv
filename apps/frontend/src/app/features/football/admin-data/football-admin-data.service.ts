import { Injectable } from '@angular/core';
import { combineLatest, map, Observable } from 'rxjs';
import { AdminOperationsService } from '@app/services/admin-operations.service';
import { FootballMatchDTO } from '../football.models';
import {
  COVERAGE_STALE_MS,
  deriveCoverageState,
  FootballAdminEntity,
  FootballAdminJob,
  FootballAdminOverview,
  FootballAdminProvider,
  FootballAdminQualityReport,
  FootballAdminSyncState,
  FootballCompetitionCoverage,
  FootballCoverageReport,
  isProviderApproved,
  OPENLIGADB_COVERAGE_MATRIX,
  ProviderEligibility,
} from './football-admin.models';

interface ListResponse<T> {
  page?: number;
  limit?: number;
  total?: number;
  items?: T[];
}

/**
 * Rights/eligibility verdicts by provider id, sourced from
 * M06-PROVIDER-ELIGIBILITY.md (captain-authored). Unknown ids
 * stay `not-measured` so they can never read as available. This is the rights
 * input to coverage derivation — not a hardcoded approval flag.
 */
const PROVIDER_ELIGIBILITY_BY_ID: Record<string, ProviderEligibility> = {
  openligadb: 'approved-limited',
  'football-data.org': 'legal-review-required',
  thesportsdb: 'blocked',
};

/** The single wired provider (see apps/backend/src/jobs/football/factory.ts). */
const PROVIDER_ID = 'openligadb';

/**
 * Admin-only football data facade. It wraps the existing `/v2/admin/football/*`
 * endpoints (auth handled by AdminOperationsService) and normalizes/derives the
 * typed shapes the Futbol control center renders. No provider name or approval
 * flag is hardcoded: approval is derived from `provider.configured` plus a
 * non-empty `providerIds` mapping per competition.
 */
@Injectable({ providedIn: 'root' })
export class FootballAdminDataService {
  constructor(private readonly adminOps: AdminOperationsService) {}

  getOverview(): Observable<FootballAdminOverview> {
    return this.adminOps.getFootballOverview().pipe(map((raw) => this.toOverview(raw)));
  }

  getCoverage(): Observable<FootballCoverageReport> {
    return combineLatest([
      this.getOverview(),
      this.adminOps.getFootballCompetitions({ limit: 100 }),
    ]).pipe(
      map(([overview, raw]) => {
        const approved = isProviderApproved(overview.provider);
        const context = {
          providerConfigured: overview.provider.configured,
          eligibility: overview.provider.eligibility,
        };
        const competitions = this.items<Record<string, unknown>>(raw).map((item) =>
          this.toCoverage(item, approved, context)
        );
        return { provider: overview.provider, competitions, matrix: OPENLIGADB_COVERAGE_MATRIX };
      })
    );
  }

  getMatches(): Observable<FootballMatchDTO[]> {
    return this.adminOps.getFootballFixtures({ limit: 100 }).pipe(
      map((raw) => this.items<FootballMatchDTO>(raw))
    );
  }

  getEntities(): Observable<FootballAdminEntity[]> {
    return combineLatest([
      this.adminOps.getFootballCompetitions({ limit: 100 }),
      this.adminOps.getFootballTeams({ limit: 100 }),
    ]).pipe(
      map(([comps, teams]) => {
        const now = Date.now();
        return [
          ...this.items<Record<string, unknown>>(comps).map((item) =>
            this.toEntity(item, 'competition', now)
          ),
          ...this.items<Record<string, unknown>>(teams).map((item) =>
            this.toEntity(item, 'team', now)
          ),
        ];
      })
    );
  }

  getSyncState(): Observable<FootballAdminSyncState> {
    return combineLatest([this.getOverview(), this.adminOps.getJobs({ limit: 100 })]).pipe(
      map(([overview, raw]) => ({
        provider: overview.provider,
        lastSuccessfulSync: overview.lastSuccessfulSync,
        lastFailedSync: overview.lastFailedSync,
        jobs: this.items<Record<string, unknown>>(raw)
          .filter((job) => typeof (job as { type?: unknown })?.type === 'string' && ((job as { type: string }).type.startsWith('football.')))
          .map((job) => this.toJob(job)),
      }))
    );
  }

  getQuality(): Observable<FootballAdminQualityReport> {
    return combineLatest([this.getOverview(), this.getEntities()]).pipe(
      map(([overview, entities]) => ({
        overview,
        staleEntities: entities.filter((entity) => entity.stale),
        unmappedEntities: entities.filter((entity) => !entity.mapped),
      }))
    );
  }

  refreshFootball(): Observable<unknown> {
    return this.adminOps.refreshFootball();
  }

  // ────────────────────────────────────────────────────────────── normalizers

  private items<T>(raw: unknown): T[] {
    const list = raw as ListResponse<T> | null;
    return Array.isArray(list?.items) ? (list!.items as T[]) : [];
  }

  private toOverview(raw: any): FootballAdminOverview {
    const provider: any = raw?.provider ?? {};
    return {
      generatedAt: raw?.generatedAt ?? null,
      provider: {
        configured: provider.configured === true,
        state: this.providerState(provider.state),
        lastError: provider.lastError ?? null,
        eligibility: PROVIDER_ELIGIBILITY_BY_ID[PROVIDER_ID] ?? 'not-measured',
      },
      activeCompetitions: Number(raw?.activeCompetitions ?? 0),
      totalTeams: Number(raw?.totalTeams ?? 0),
      upcomingFixtures: Number(raw?.upcomingFixtures ?? 0),
      fixturesMissingBroadcast: Number(raw?.fixturesMissingBroadcast ?? 0),
      broadcastMappings: Number(raw?.broadcastMappings ?? 0),
      staleCompetitions: Number(raw?.staleCompetitions ?? 0),
      staleTeams: Number(raw?.staleTeams ?? 0),
      unmappedCompetitions: Number(raw?.unmappedCompetitions ?? 0),
      unmappedTeams: Number(raw?.unmappedTeams ?? 0),
      lastSuccessfulSync: raw?.lastSuccessfulSync ?? null,
      lastFailedSync: raw?.lastFailedSync ?? null,
    };
  }

  private providerState(state: unknown): FootballAdminProvider['state'] {
    return state === 'healthy' || state === 'degraded' || state === 'unconfigured'
      ? state
      : 'unconfigured';
  }

  private toCoverage(
    item: Record<string, unknown>,
    approved: boolean,
    context: { providerConfigured: boolean; eligibility: ProviderEligibility }
  ): FootballCompetitionCoverage {
    const providerIds = (item.providerIds ?? {}) as Record<string, string>;
    const lastUpdatedAt = String(item.lastUpdatedAt ?? '');
    return {
      id: String(item._id ?? item.id ?? ''),
      name: String(item.name ?? 'Sin nombre'),
      country: (item.country as string | null) ?? null,
      currentSeason: (item.currentSeason as string | null) ?? null,
      providerIds,
      lastUpdatedAt,
      hasApprovedProvider: approved && Object.keys(providerIds).length > 0,
      state: deriveCoverageState({ providerIds, lastUpdatedAt }, context),
    };
  }

  private toEntity(item: Record<string, unknown>, kind: 'competition' | 'team', now: number): FootballAdminEntity {
    const providerIds = (item.providerIds ?? {}) as Record<string, string>;
    const lastUpdatedAt = String(item.lastUpdatedAt ?? '');
    const updated = Date.parse(lastUpdatedAt);
    return {
      id: String(item._id ?? item.id ?? ''),
      name: String(item.name ?? 'Sin nombre'),
      kind,
      mapped: Object.keys(providerIds).length > 0,
      stale: Number.isFinite(updated) && updated < now - COVERAGE_STALE_MS,
      lastUpdatedAt,
      providerIds,
    };
  }

  private toJob(job: Record<string, unknown>): FootballAdminJob {
    return {
      id: String(job._id ?? job.id ?? ''),
      type: String(job.type ?? 'football'),
      status: String(job.status ?? 'unknown'),
      queuedAt: (job.queuedAt as string | null) ?? null,
      completedAt: (job.completedAt as string | null) ?? null,
      errorSummary: (job.errorSummary as string | null) ?? null,
    };
  }
}
