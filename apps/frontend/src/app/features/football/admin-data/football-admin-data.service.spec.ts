import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { AdminOperationsService } from '@app/services/admin-operations.service';
import { FootballAdminDataService } from './football-admin-data.service';
import {
  broadcastAvailabilityLabel,
  COVERAGE_LABELS,
  deriveCoverageState,
  isProviderApproved,
} from './football-admin.models';

describe('FootballAdminDataService', () => {
  let adminOps: {
    getFootballOverview: jasmine.Spy;
    getFootballCompetitions: jasmine.Spy;
    getFootballTeams: jasmine.Spy;
    getFootballFixtures: jasmine.Spy;
    getJobs: jasmine.Spy;
    refreshFootball: jasmine.Spy;
  };
  let service: FootballAdminDataService;

  const overviewRaw = () => ({
    generatedAt: '2026-11-06T10:00:00.000Z',
    provider: { configured: true, state: 'healthy' },
    activeCompetitions: 3,
    totalTeams: 40,
    upcomingFixtures: 12,
    fixturesMissingBroadcast: 2,
    broadcastMappings: 8,
    staleCompetitions: 1,
    staleTeams: 4,
    unmappedCompetitions: 1,
    unmappedTeams: 9,
    lastSuccessfulSync: '2026-11-06T09:00:00.000Z',
    lastFailedSync: null,
  });

  const fresh = () => new Date().toISOString();
  const stale = () => new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    adminOps = {
      getFootballOverview: jasmine.createSpy().and.returnValue(of(overviewRaw())),
      getFootballCompetitions: jasmine.createSpy().and.returnValue(of({ items: [] })),
      getFootballTeams: jasmine.createSpy().and.returnValue(of({ items: [] })),
      getFootballFixtures: jasmine.createSpy().and.returnValue(of({ items: [] })),
      getJobs: jasmine.createSpy().and.returnValue(of({ items: [] })),
      refreshFootball: jasmine.createSpy().and.returnValue(of({ id: 'job-1' })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AdminOperationsService, useValue: adminOps }],
    });
    service = TestBed.inject(FootballAdminDataService);
  });

  describe('pure derivation', () => {
    it('requires BOTH configured and an approved eligibility — never `configured` alone', () => {
      expect(isProviderApproved({ configured: true, eligibility: 'approved-limited' })).toBeTrue();
      expect(isProviderApproved({ configured: true, eligibility: 'approved-verified' })).toBeTrue();
      expect(isProviderApproved({ configured: true, eligibility: 'blocked' })).toBeFalse();
      expect(isProviderApproved({ configured: true, eligibility: 'legal-review-required' })).toBeFalse();
      expect(isProviderApproved({ configured: true, eligibility: 'not-measured' })).toBeFalse();
      expect(isProviderApproved({ configured: false, eligibility: 'approved-limited' })).toBeFalse();
      expect(isProviderApproved(null)).toBeFalse();
      expect(isProviderApproved(undefined)).toBeFalse();
    });

    it('marks a competition without a provider mapping as "Competicion sin cobertura"', () => {
      const state = deriveCoverageState(
        { providerIds: {}, lastUpdatedAt: fresh() },
        { providerConfigured: true, eligibility: 'approved-limited' }
      );
      expect(state).toBe('not-covered');
      expect(COVERAGE_LABELS['not-covered']).toBe('Competicion sin cobertura');
    });

    it('renders a configured-but-legally-blocked provider as legally-blocked, never available', () => {
      const state = deriveCoverageState(
        { providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() },
        { providerConfigured: true, eligibility: 'blocked' }
      );
      expect(state).toBe('legally-blocked');
      expect(state).not.toBe('available');
    });

    it('renders an unmeasured eligibility as not-yet-measured, never available or covered', () => {
      const state = deriveCoverageState(
        { providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() },
        { providerConfigured: true, eligibility: 'not-measured' }
      );
      expect(state).toBe('not-yet-measured');
      expect(state).not.toBe('available');
      expect(state).not.toBe('not-covered');
    });

    it('distinguishes stale, partial and available for an approved provider', () => {
      expect(
        deriveCoverageState({ providerIds: { ol: 'bl1' }, lastUpdatedAt: stale() }, { providerConfigured: true, eligibility: 'approved-limited' })
      ).toBe('stale');
      expect(
        deriveCoverageState({ providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() }, { providerConfigured: true, eligibility: 'approved-limited' })
      ).toBe('partial');
      expect(
        deriveCoverageState({ providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() }, { providerConfigured: true, eligibility: 'approved-verified' })
      ).toBe('available');
    });

    it('reports a mapped-but-unconfigured provider as temporarily-unavailable', () => {
      const state = deriveCoverageState(
        { providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() },
        { providerConfigured: false, eligibility: 'approved-limited' }
      );
      expect(state).toBe('temporarily-unavailable');
    });

    it('exposes all nine coverage states with distinct Spanish labels', () => {
      expect(Object.keys(COVERAGE_LABELS).length).toBe(9);
      expect(new Set(Object.values(COVERAGE_LABELS)).size).toBe(9);
      expect(COVERAGE_LABELS['not-yet-measured']).toBe('Aún no medido');
      expect(COVERAGE_LABELS['legally-blocked']).toBe('Bloqueado legalmente');
    });

    it('maps every broadcast availability value to a distinct Spanish label', () => {
      expect(broadcastAvailabilityLabel('tv')).toBe('TV');
      expect(broadcastAvailabilityLabel('streaming')).toBe('Streaming');
      expect(broadcastAvailabilityLabel('both')).toBe('TV y streaming');
    });
  });

  describe('getOverview', () => {
    it('normalizes a raw payload into typed numbers and a provider state', async () => {
      const overview = await firstValueFrom(service.getOverview());
      expect(overview.activeCompetitions).toBe(3);
      expect(overview.provider.configured).toBeTrue();
      expect(overview.provider.state).toBe('healthy');
      expect(overview.provider.eligibility).toBe('approved-limited');
    });

    it('falls back to unconfigured when the backend omits the provider', async () => {
      adminOps.getFootballOverview.and.returnValue(of({ activeCompetitions: 2 }));
      const overview = await firstValueFrom(service.getOverview());
      expect(overview.provider.configured).toBeFalse();
      expect(overview.provider.state).toBe('unconfigured');
    });
  });

  describe('getCoverage', () => {
    it('derives hasApprovedProvider and coverage state from eligibility + mapping', async () => {
      adminOps.getFootballCompetitions.and.returnValue(
        of({
          items: [
            { _id: 'c1', name: 'Bundesliga', providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() },
            { _id: 'c2', name: 'Copa sin proveedor', providerIds: {}, lastUpdatedAt: fresh() },
          ],
        })
      );
      const report = await firstValueFrom(service.getCoverage());
      expect(report.competitions[0].hasApprovedProvider).toBeTrue();
      expect(report.competitions[0].state).toBe('partial');
      expect(report.competitions[1].hasApprovedProvider).toBeFalse();
      expect(report.competitions[1].state).toBe('not-covered');
    });

    it('reports a mapped-but-unconfigured provider as temporarily-unavailable', async () => {
      adminOps.getFootballOverview.and.returnValue(
        of({ ...overviewRaw(), provider: { configured: false, state: 'unconfigured' } })
      );
      adminOps.getFootballCompetitions.and.returnValue(
        of({ items: [{ _id: 'c1', name: 'Bundesliga', providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() }] })
      );
      const report = await firstValueFrom(service.getCoverage());
      expect(report.competitions[0].hasApprovedProvider).toBeFalse();
      expect(report.competitions[0].state).toBe('temporarily-unavailable');
    });

    it('always includes the twelve-aspect capability matrix', async () => {
      const report = await firstValueFrom(service.getCoverage());
      expect(report.matrix.length).toBe(12);
      expect(report.matrix.every((cell) => cell.state in COVERAGE_LABELS)).toBeTrue();
      expect(report.matrix.find((cell) => cell.aspect === 'live-minute')?.state).toBe('not-supported');
      expect(report.matrix.find((cell) => cell.aspect === 'fixtures')?.state).toBe('available');
    });
  });

  describe('getEntities', () => {
    it('flags unmapped and stale entities from their real fields', async () => {
      adminOps.getFootballCompetitions.and.returnValue(
        of({ items: [{ _id: 'c1', name: 'Mapped', providerIds: { ol: 'bl1' }, lastUpdatedAt: fresh() }] })
      );
      adminOps.getFootballTeams.and.returnValue(
        of({ items: [{ _id: 't1', name: 'Unmapped', providerIds: {}, lastUpdatedAt: stale() }] })
      );
      const entities = await firstValueFrom(service.getEntities());
      expect(entities.length).toBe(2);
      expect(entities[0].mapped).toBeTrue();
      expect(entities[1].mapped).toBeFalse();
      expect(entities[1].stale).toBeTrue();
    });
  });

  describe('getSyncState', () => {
    it('keeps only football.* jobs and surfaces last sync markers', async () => {
      adminOps.getJobs.and.returnValue(
        of({
          items: [
            { _id: '1', type: 'football.refresh', status: 'completed', queuedAt: '2026-11-06T09:00:00Z', completedAt: '2026-11-06T09:05:00Z' },
            { _id: '2', type: 'epg.sync', status: 'failed', queuedAt: '2026-11-06T08:00:00Z', completedAt: '2026-11-06T08:01:00Z' },
          ],
        })
      );
      const state = await firstValueFrom(service.getSyncState());
      expect(state.jobs.length).toBe(1);
      expect(state.jobs[0].type).toBe('football.refresh');
      expect(state.lastSuccessfulSync).toBe('2026-11-06T09:00:00.000Z');
    });
  });

  describe('getQuality', () => {
    it('splits entities into stale and unmapped buckets', async () => {
      adminOps.getFootballCompetitions.and.returnValue(
        of({
          items: [
            { _id: 'c1', name: 'Stale mapped', providerIds: { ol: 'bl1' }, lastUpdatedAt: stale() },
            { _id: 'c2', name: 'Unmapped fresh', providerIds: {}, lastUpdatedAt: fresh() },
          ],
        })
      );
      const report = await firstValueFrom(service.getQuality());
      expect(report.staleEntities.map((e) => e.id)).toEqual(['c1']);
      expect(report.unmappedEntities.map((e) => e.id)).toEqual(['c2']);
    });
  });
});
