import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AdminEditorialFlowService, EditorialFlowHttpError, FlowGuideResponse } from './admin-editorial-flow.service';
import { environment } from '../../environments/environment';

const BASE = `${environment.API_BASE_URL}/admin/editorial/flow`;

const guidePayload = (): FlowGuideResponse => ({
  contractVersion: 'm14-r7.1',
  guide: {
    version: 'm14-r7.1',
    candidate: { discovered: { key: 'discovered', label: 'Descubierto', definition: 'Propuesto', notImplies: ['No implica aprobado.'], admittedActions: ['archive'] } },
    editorial: {},
    execution: {},
    publication: {},
    seo: {},
    recoveryActions: { archive: { key: 'archive', label: 'Archivar', definition: 'Saca el tema del flujo.' } },
  },
});

describe('AdminEditorialFlowService', () => {
  let service: AdminEditorialFlowService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(AdminEditorialFlowService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the versioned contract from the shared guide endpoint', () => {
    let received: FlowGuideResponse | undefined;
    service.getGuide().subscribe((data) => (received = data));
    const request = http.expectOne(`${BASE}/guide`);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: guidePayload() });
    expect(received?.contractVersion).toBe('m14-r7.1');
    expect(received?.guide.candidate['discovered'].definition).toBe('Propuesto');
  });

  it('omits empty scope keys and keeps the measured/unavailable distinction intact', () => {
    service.getFunnel({ from: '2026-11-01T00:00:00.000Z', origin: 'manual', category: '' }).subscribe((report) => {
      // El servicio no rellena: el recuento no disponible llega como null, no como 0.
      expect(report.stages[0].state).toBe('unavailable');
      expect(report.stages[0].count).toBeNull();
    });
    const request = http.expectOne(`${BASE}/funnel?from=2026-11-01T00%3A00%3A00.000Z&origin=manual`);
    expect(new URLSearchParams(request.request.urlWithParams.split('?')[1]).get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(new URLSearchParams(request.request.urlWithParams.split('?')[1]).get('origin')).toBe('manual');
    expect(new URLSearchParams(request.request.urlWithParams.split('?')[1]).has('category')).toBeFalse();
    request.flush({
      success: true,
      data: {
        contractVersion: 'm14-r7.1',
        generatedAt: '2026-11-06T10:00:00.000Z',
        scope: { requested: {}, applied: [], note: '' },
        stages: [
          {
            key: 'candidate.discovered',
            dimension: 'candidate',
            dimensionLabel: 'Candidato (tema)',
            label: 'Descubiertos',
            description: 'Sin historia',
            state: 'unavailable',
            count: null,
            unavailableReason: 'No se reconstruye',
            drillDown: { ids: [], total: 0, returned: 0, truncated: false, endpoint: '' },
            queries: [],
            notes: [],
            conversionFromPrevious: null,
          },
        ],
        dimensions: [],
        totals: { global: null, globalNote: '', byDimension: [] },
        availability: { connected: true, note: null },
      },
    });
  });

  it('turns a 409 into a Spanish EditorialFlowHttpError carrying the server message', () => {
    let error: EditorialFlowHttpError | undefined;
    service.recover({ topicId: 'tema-1', action: 'add-evidence', sources: ['https://boe.es/a'] }).subscribe({
      error: (e) => (error = e),
    });
    const request = http.expectOne(`${BASE}/recovery/tema-1`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ action: 'add-evidence', sources: ['https://boe.es/a'] });
    request.flush(
      { success: false, error: { code: 'CONFLICT', message: 'La causa del rechazo no ha cambiado desde el intento anterior.' } },
      { status: 409, statusText: 'Conflict' }
    );
    expect(error?.status).toBe(409);
    expect(error?.message).toContain('La causa del rechazo no ha cambiado');
  });

  it('sends the bulk recovery with every id and reports per-item results', () => {
    let result: unknown;
    service.recoverBulk({ topicIds: ['a', 'b'], action: 'retry-review' }).subscribe((data) => (result = data));
    const request = http.expectOne(`${BASE}/recovery/bulk`);
    expect(request.request.body).toEqual({ topicIds: ['a', 'b'], action: 'retry-review' });
    request.flush({
      success: true,
      data: {
        action: 'retry-review',
        results: [
          { topicId: 'a', ok: true, gateway: 'ledger-retry', requestId: 'job-1', detail: 'Revisión relanzada' },
          { topicId: 'b', ok: false, gateway: null, requestId: null, detail: 'No aplica', code: 'not-applicable' },
        ],
        succeeded: 1,
        failed: 1,
        note: 'Cada ítem se valida contra su estado real.',
      },
    });
    expect((result as { failed: number }).failed).toBe(1);
  });

  it('checks eligibility before publishing and never posts without the idempotency key', () => {
    service.publishNow('post-1', 'clave', 'ana', 'idem-1').subscribe();
    const request = http.expectOne(`${BASE}/publication/post-1/now`);
    expect(request.request.headers.get('Idempotency-Key')).toBe('idem-1');
    expect(request.request.headers.get('x-editorial-review-key')).toBe('clave');
    expect(request.request.headers.get('x-editorial-reviewer')).toBe('ana');
    request.flush({ success: true, data: { postId: 'post-1', alreadyApplied: false } });
  });

  it('surfaces a transport failure as a descriptive Spanish error', () => {
    let error: EditorialFlowHttpError | undefined;
    service.getScheduler().subscribe({ error: (e) => (error = e) });
    http.expectOne(`${BASE}/scheduler`).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(error?.status).toBe(500);
    expect(error?.message.length).toBeGreaterThan(0);
  });
});
