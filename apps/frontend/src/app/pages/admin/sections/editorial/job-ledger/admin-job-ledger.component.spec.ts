import { AdminJobLedgerComponent } from './admin-job-ledger.component';
import { EditorialLedgerJob } from '../../../../../services/admin-editorial.service';

const job = (over: Partial<EditorialLedgerJob> = {}): EditorialLedgerJob => ({
  jobId: 'job-1', slug: 'guia-de-prueba', kind: 'article', state: 'running', currentStage: 'article-drafting', attempt: 1, maxAttempts: 3,
  worker: { id: 'w', host: 'vmi', pid: 1 }, lease: { token: 't', generation: 1, acquiredAt: '2026-11-05T18:00:00Z', expiresAt: '2026-11-05T18:02:00Z', heartbeatAt: '2026-11-05T18:00:00Z' },
  createdAt: '2026-11-05T18:00:00Z', updatedAt: '2026-11-05T18:00:00Z', startedAt: '2026-11-05T18:00:00Z', endedAt: null,
  articleDeadlineAt: '2026-11-05T19:00:00Z', lastProgressAt: '2026-11-05T18:00:00Z', progress: null,
  cancelRequested: false, pauseRequested: false, archivedAt: null, error: null,
  usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, stages: [], checkpoints: [],
  publication: null, revision: 1, deadlines: { stageMs: 600000, articleMs: 3600000 }, ...over,
});

describe('AdminJobLedgerComponent', () => {
  let component: AdminJobLedgerComponent;

  beforeEach(() => {
    component = new AdminJobLedgerComponent({} as never);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-05T18:00:30Z'));
  });
  afterEach(() => jasmine.clock().uninstall());

  it('offers only actions the current state supports', () => {
    expect(component.can('pause', job())).toBeTrue();
    expect(component.can('cancel', job())).toBeTrue();
    expect(component.can('retry', job())).toBeFalse();
    expect(component.can('archive', job({ state: 'completed' }))).toBeTrue();
    expect(component.can('delete', job({ state: 'completed' }))).toBeFalse();
    expect(component.can('delete', job({ state: 'completed', archivedAt: '2026-11-05T18:00:00Z' }))).toBeTrue();
  });

  it('shows a live lease in seconds and an expired one explicitly', () => {
    expect(component.leaseText(job())).toBe('90s');
    expect(component.leaseText(job({ lease: { token: 't', generation: 1, acquiredAt: '', expiresAt: '2026-11-05T17:00:00Z', heartbeatAt: '' } }))).toBe('Expirado');
    expect(component.leaseText(job({ lease: null }))).toBe('-');
  });

  it('escape closes the topmost layer without trapping focus', () => {
    component.pending = { action: 'cancel', ids: ['job-1'], title: 'Cancelar', needsReason: true };
    component.onEscape();
    expect(component.pending).toBeNull();
    component.detail = job();
    component.detailOpen = true;
    component.onEscape();
    expect(component.detailOpen).toBeFalse();
  });
});
