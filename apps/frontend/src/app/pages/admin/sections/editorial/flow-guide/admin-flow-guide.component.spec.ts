import { of, throwError } from 'rxjs';
import { AdminFlowGuideComponent } from './admin-flow-guide.component';
import { EditorialFlowHttpError } from '../../../../../services/admin-editorial-flow.service';
import { FUNNEL, GUIDE, TOPIC, guideResponse } from './flow-guide.fixtures.spec-fixture';

type Overrides = Partial<Record<'getGuide' | 'getFunnel' | 'getTopic' | 'recover' | 'recoverBulk' | 'getReconciliation', unknown>>;

function build(overrides: Overrides = {}, initialView = '') {
  const calls = { guide: 0, funnel: [] as string[], topic: [] as string[], recovery: [] as unknown[], bulk: [] as unknown[] };
  const base = {
    getGuide: () => {
      calls.guide += 1;
      return of(guideResponse());
    },
    getFunnel: (scope: Record<string, string> = {}) => {
      calls.funnel.push(JSON.stringify(scope));
      return of(FUNNEL);
    },
    getTopic: (id: string) => {
      calls.topic.push(id);
      return of({ ...TOPIC, topicId: id });
    },
    recover: (input: { topicId: string; action: string }) => {
      calls.recovery.push(input);
      return of({ topicId: input.topicId, action: input.action, applied: true, gateway: 'ledger-retry', requestId: 'job-1', detail: 'Revisión relanzada.', fingerprint: 'fp' });
    },
    recoverBulk: (input: unknown) => {
      calls.bulk.push(input);
      return of({
        action: 'retry-review',
        succeeded: 1,
        failed: 1,
        note: 'Cada ítem se valida.',
        results: [
          { topicId: 'tema-a', ok: true, gateway: 'ledger-retry', requestId: 'job-1', detail: 'Relanzada' },
          { topicId: 'tema-b', ok: false, gateway: null, requestId: null, detail: 'No aplica al estado real del tema', code: 'not-applicable' },
        ],
      });
    },
    getReconciliation: () =>
      of({
        generatedAt: '2026-11-06T10:00:00.000Z',
        rule: 'legacy',
        count: 0,
        records: [],
        mass: { total: 0, published: 0, notPublished: 0, unknown: 0, note: 'La suma es el total analizado.' },
        dataGaps: [],
      }),
    getScheduler: () => of({}),
  };
  // Los dobles por defecto son asignables al servicio tipado; solo se sobreescribe lo que pide cada prueba.
  const service: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) service[key] = value;
  const router = { navigate: (commands: unknown[], extras: unknown) => Promise.resolve(String(commands.length) + String(Boolean(extras))) };
  const navigateSpy = spyOn(router, 'navigate').and.callThrough();
  const component = new AdminFlowGuideComponent(
    service as never,
    { snapshot: { queryParamMap: { get: () => null } } } as never,
    router as never,
    { nativeElement: document.createElement('div') } as never
  );
  component.initialView = initialView;
  return { component, calls, navigateSpy };
}

describe('AdminFlowGuideComponent', () => {
  it('renders the shared contract: version, every state with its definition and what it does not imply', () => {
    const { component } = build();
    component.ngOnInit();
    expect(component.guideLoading).toBeFalse();
    expect(component.contractVersion).toBe('m14-r7.1');
    expect(component.guide).toBe(GUIDE);
    for (const dimension of component.dimensionOrder) {
      const entries = component.statesFor(dimension);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.meta.definition).toBe(GUIDE[dimension][entry.key].definition);
        expect(entry.meta.notImplies).toBe(GUIDE[dimension][entry.key].notImplies);
      }
    }
    expect(component.definitionFor('publication', 'published')).toBe('Está publicado en el sitio.');
    expect(component.notImpliesFor('publication', 'published')).toEqual(['No implica indexado en Google.']);
  });

  it('exposes the six required distinctions and only cites states that exist in the loaded contract', () => {
    const { component } = build();
    component.ngOnInit();
    expect(component.distinctions.length).toBe(6);
    for (const distinction of component.distinctions) {
      expect(component.citesState(distinction.example.leftDimension, distinction.example.leftState)).withContext(distinction.id).toBeTrue();
      expect(component.citesState(distinction.example.rightDimension, distinction.example.rightState)).withContext(distinction.id).toBeTrue();
    }
    expect(component.examples.length).toBeGreaterThan(0);
    for (const example of component.examples) {
      for (const cite of example.cites) expect(component.citesState(cite.dimension, cite.state)).withContext(example.id).toBeTrue();
    }
  });

  it('declares a state that a future contract version drops instead of inventing its label', () => {
    const { component } = build();
    component.ngOnInit();
    expect(component.citesState('candidate', 'retained')).toBeTrue();
    const withoutRetained = { ...GUIDE.candidate };
    delete (withoutRetained as Record<string, unknown>)['retained'];
    component.guide = { ...GUIDE, candidate: withoutRetained } as never;
    expect(component.citesState('candidate', 'retained')).toBeFalse();
    expect(component.labelOf('candidate', 'retained')).toBe('retained');
  });

  it('shows a loading state and then an announced error when the contract cannot be loaded', () => {
    const { component } = build({ getGuide: () => throwError(() => new EditorialFlowHttpError(500, null, 'Servidor no disponible', null)) });
    component.loadGuide();
    expect(component.guideLoading).toBeFalse();
    expect(component.guideError).toBe('Servidor no disponible');
    expect(component.guide).toBeNull();
  });

  it('navigates between views by keyboard and records the view in the URL', () => {
    const { component, navigateSpy, calls } = build({}, 'how');
    component.ngOnInit();
    expect(component.activeView).toBe('how');
    expect(calls.funnel.length).toBe(0);
    component.onViewKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(component.activeView).toBe('diagnostics');
    expect(navigateSpy).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { view: 'diagnostics' } }));
    expect(calls.funnel.length).toBe(1);
    component.onViewKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(component.activeView).toBe('how');
  });

  it('opens the diagnostics view directly when the URL asks for it', () => {
    const { component, calls } = build({}, 'diagnostics');
    component.ngOnInit();
    expect(component.activeView).toBe('diagnostics');
    expect(calls.funnel.length).toBe(1);
  });

  it('keeps unavailable stages without a number and links every measured counter to its records', () => {
    const { component } = build({}, 'diagnostics');
    component.ngOnInit();
    const discovered = component.stageViews['candidate.discovered'];
    expect(discovered.stage.count).toBeNull();
    expect(discovered.drillable).toBeFalse();
    const eligible = component.stageViews['candidate.eligible'];
    expect(eligible.stage.count).toBe(4);
    expect(eligible.drillable).toBeTrue();
    expect(eligible.conversionText).toBeNull();
    expect(eligible.conversionBroken).toContain('no disponible');
    expect(component.stageViews['seo.pending-inspection'].stage.state).toBe('measured');
    expect(component.stageViews['seo.pending-inspection'].stage.count).toBe(0);
    expect(component.isEmptyFunnel).toBeFalse();
    expect(component.isPartialFunnel).toBeTrue();
    expect(component.unavailableStages.map((item) => item.key)).toEqual(['candidate.discovered', 'publication.failed']);
    expect(component.waits.length).toBe(4);
    expect(component.waits.some((wait) => wait.crossDimension)).toBeTrue();
  });

  it('applies the filters as the API scope and omits empty keys', () => {
    const { component, calls } = build({}, 'diagnostics');
    component.ngOnInit();
    component.filters['origin'] = 'manual';
    component.filters['from'] = '2026-11-01';
    component.filters['state'] = '';
    component.applyFilters();
    const last = JSON.parse(calls.funnel[calls.funnel.length - 1]) as Record<string, string>;
    expect(last['origin']).toBe('manual');
    expect(last['from']).toBe(new Date('2026-11-01').toISOString());
    expect(last['state']).toBeUndefined();
    component.clearFilters();
    expect(JSON.parse(calls.funnel[calls.funnel.length - 1])).toEqual({});
  });

  it('opens the real record list of a stage and the topic dossier from a record', () => {
    const { component, calls } = build({}, 'diagnostics');
    component.ngOnInit();
    component.openList(component.stageViews['editorial.approved'] as never, { currentTarget: document.createElement('button') } as unknown as Event);
    expect(component.listOpen).toBeTrue();
    expect(component.listIds).toEqual(['tema-a', 'tema-b']);
    component.openTopicFromList('tema-a');
    expect(component.topicOpen).toBeTrue();
    expect(calls.topic).toContain('tema-a');
    expect(component.topic?.blockingReason?.reason).toContain('agotados los ciclos');
    expect(component.dimensionRows().length).toBe(5);
    expect(component.topicStateLabel(component.topic!, 'candidate')).toBe('Retenido');
    expect(component.definitionFor('execution', 'blocked')).toBe('No puede continuar.');
    component.onEscape();
    expect(component.topicOpen).toBeFalse();
    component.onEscape();
    expect(component.listOpen).toBeFalse();
  });

  it('proposes the recovery actions of the real state and explains their meaning from the contract', () => {
    const { component } = build({}, 'diagnostics');
    component.ngOnInit();
    component.askRecovery('retry-review', ['tema-a']);
    expect(component.recoveryDialog?.action).toBe('retry-review');
    expect(component.recoveryDialog?.label).toBe('Reintentar revisión');
    expect(component.recoveryDialog?.definition).toBe('Vuelve a ejecutar la revisión.');
    expect(component.recoveryNeedsInput).toBeFalse();
    expect(component.bulkActions.length).toBe(10);
  });

  it('explains in Spanish why a 409 blocks the same request and refuses to resend it', () => {
    const { component, calls } = build({}, 'diagnostics');
    component.ngOnInit();
    component.askRecovery('add-evidence', ['tema-a']);
    // 409 del servidor: la acción no aplica al estado real o la causa no ha cambiado.
    component.handleRecoveryError(new EditorialFlowHttpError(409, 'CONFLICT', 'La causa del rechazo no ha cambiado desde el intento anterior.', null));
    expect(component.recoveryConflict).toBeTrue();
    expect(component.recoveryError).toContain('no ha cambiado');
    component.confirmRecovery();
    expect(calls.recovery.length).toBe(0);
    expect(component.recoveryError).toContain('Cambia las fuentes');
  });
  it('requires new sources for evidence actions instead of resending the same cause', () => {
    const { component, calls } = build({}, 'diagnostics');
    component.ngOnInit();
    component.askRecovery('add-evidence', ['tema-a']);
    expect(component.recoveryNeedsInput).toBeTrue();
    component.confirmRecovery();
    expect(calls.recovery.length).toBe(0);
    expect(component.recoveryError).toContain('al menos una URL');
  });

  it('marks an empty funnel without painting placeholder numbers', () => {
    const empty = {
      ...FUNNEL,
      stages: FUNNEL.stages.map((item) => ({
        ...item,
        state: 'unavailable' as const,
        count: null,
        unavailableReason: 'Sin conexión',
        drillDown: { ids: [], total: 0, returned: 0, truncated: false, endpoint: '' },
      })),
      availability: { connected: false, note: 'Sin conexión a la base de datos.' },
    };
    const { component } = build({ getFunnel: () => of(empty) }, 'diagnostics');
    component.ngOnInit();
    expect(component.isEmptyFunnel).toBeTrue();
    expect(component.isPartialFunnel).toBeFalse();
    expect(component.measuredStages.length).toBe(0);
    expect(component.stageViews['candidate.eligible'].stage.count).toBeNull();
  });

  it('shows the error state of the funnel and allows retrying', () => {
    const { component } = build(
      { getFunnel: () => throwError(() => new EditorialFlowHttpError(400, 'VALIDATION_ERROR', 'El periodo es inválido: «desde» es posterior a «hasta»', null)) },
      'diagnostics'
    );
    component.ngOnInit();
    expect(component.funnelError).toContain('El periodo es inválido');
    expect(component.funnel).toBeNull();
    expect(component.funnelLoading).toBeFalse();
  });

  it('refuses to select more records than the safe bulk cap', () => {
    const many = Array.from({ length: 60 }, (_, index) => `tema-${index}`);
    const big = {
      ...FUNNEL,
      stages: FUNNEL.stages.map((item) =>
        item.key === 'candidate.eligible' ? { ...item, drillDown: { ids: many, total: 60, returned: 60, truncated: false, endpoint: '' } } : item
      ),
    };
    const { component } = build({ getFunnel: () => of(big) }, 'diagnostics');
    component.ngOnInit();
    component.selectAllVisible();
    expect(component.selected.size).toBe(0);
    expect(component.recoveryResultError).toContain('50');
  });
});