import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { FootballAdminDataService } from './football-admin-data.service';
import {
  AdminApiError,
  AVAILABILITY_LABELS,
  broadcastAvailabilityLabel,
  COVERAGE_STATE_LABELS,
  INGESTION_OUTCOME_LABELS,
  SYNC_STATUS_LABELS,
} from './football-admin.models';

describe('FootballAdminDataService (t7 typed client)', () => {
  let service: FootballAdminDataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(FootballAdminDataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('decodes the dashboard envelope into the typed DTO', async () => {
    const promise = firstValueFrom(service.getDashboard());
    const req = http.expectOne('/v2/sports/football/admin/dashboard');
    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      data: {
        generatedAt: '2026-11-06T10:00:00.000Z',
        competitions: 3,
        teams: 40,
        snapshots: 120,
        providers: 1,
        broadcastMappings: 8,
        staleSnapshots: 2,
        openQualityIssues: 0,
        countsState: 'observed',
        lastSyncState: 'observed',
      },
    });
    const dashboard = await promise;
    expect(dashboard.competitions).toBe(3);
    expect(dashboard.countsState).toBe('observed');
  });

  it('passes match list filters as query params', async () => {
    const promise = firstValueFrom(service.getMatches({ page: 2, limit: 10, status: 'live', q: 'barca' }));
    const req = http.expectOne((r) => r.url === '/v2/sports/football/admin/matches');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('status')).toBe('live');
    expect(req.request.params.get('q')).toBe('barca');
    req.flush({ success: true, data: { page: 2, limit: 10, total: 0, items: [] } });
    const result = await promise;
    expect(result.items).toEqual([]);
  });

  it('POSTs the sync control with the idempotency key and decodes the queued operation', async () => {
    const promise = firstValueFrom(service.sync('manual.123'));
    const req = http.expectOne('/v2/sports/football/admin/ingestion/sync');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ idempotencyKey: 'manual.123' });
    req.flush({ success: true, data: { id: 'op-1', status: 'queued', correlationId: 'manual.123' } });
    const result = await promise;
    expect(result.id).toBe('op-1');
    expect(result.status).toBe('queued');
  });

  it('normalizes a 401 into an unauthorized AdminApiError', async () => {
    const promise = firstValueFrom(service.getDashboard());
    const req = http.expectOne('/v2/sports/football/admin/dashboard');
    req.flush(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization token missing' } },
      { status: 401, statusText: 'Unauthorized' }
    );
    try {
      await promise;
      fail('expected an error');
    } catch (err) {
      expect(err instanceof AdminApiError).toBeTrue();
      expect((err as AdminApiError).kind).toBe('unauthorized');
      expect((err as AdminApiError).status).toBe(401);
    }
  });

  it('exposes Spanish labels for every availability, coverage, outcome and sync status', () => {
    expect(AVAILABILITY_LABELS['unavailable']).toBe('No disponible');
    expect(AVAILABILITY_LABELS['not_measured']).toBe('Aún no medido');
    expect(COVERAGE_STATE_LABELS['competition_not_covered']).toBe('Competición sin cobertura');
    expect(COVERAGE_STATE_LABELS['provider_supported_no_fixtures']).toBe('Cubierta sin partidos');
    expect(INGESTION_OUTCOME_LABELS['empty']).toBe('Sin datos');
    expect(SYNC_STATUS_LABELS['queued']).toBe('Encolada');
    expect(broadcastAvailabilityLabel('both')).toBe('TV y streaming');
  });
});
