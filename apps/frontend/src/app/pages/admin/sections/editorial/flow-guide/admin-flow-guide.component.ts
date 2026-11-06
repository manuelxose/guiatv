import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  AdminEditorialFlowService,
  AvailableAction,
  BulkRecoveryItem,
  BulkRecoveryResult,
  EditorialFlowHttpError,
  FlowDimension,
  FlowScopeQuery,
  FlowStateGuide,
  FunnelReport,
  FunnelStage,
  ReconciliationRecord,
  ReconciliationReport,
  RecoveryActionKey,
  SchedulerStatus,
  TopicView,
} from '../../../../../services/admin-editorial-flow.service';
import { AdminStatusBadgeComponent } from '../../../components/admin-status-badge/admin-status-badge.component';
import {
  ABSENCE_MARKERS,
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  DIMENSION_QUESTIONS,
  FLOW_DISTINCTIONS,
  FLOW_EXAMPLES,
  FLOW_STAGES,
  ORIGIN_LABELS,
  PUBLICATION_STATUS_LABELS,
  SCOPE_LABELS,
  TOPIC_CATEGORIES,
  metaOf,
  stateExists,
  stateLabel,
  statesOf,
} from './flow-guide.content';

type ViewId = 'how' | 'diagnostics';
type DiagnosticsTab = 'funnel' | 'legacy';

/** Máximo que admite la recuperación en lote del backend (`MAX_BULK_RECOVERY`). */
const MAX_BULK = 50;

/** Etapas que NO son un recuento del embudo y por eso se muestran como ficha aparte. */
const SEPARATE_STAGE_KEYS = ['candidate.discovered', 'publication.failed'];

const SCOPE_FILTER_KEYS = [
  'from', 'to', 'cycleId', 'category', 'stage', 'state',
  'failureReason', 'model', 'provider', 'origin', 'publicationStatus',
] as const;

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const isConflict = (error: unknown): boolean => error instanceof EditorialFlowHttpError && error.status === 409;

@Component({
  selector: 'app-admin-flow-guide',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule, AdminStatusBadgeComponent],
  templateUrl: './admin-flow-guide.component.html',
  styleUrl: './admin-flow-guide.component.scss',
})
export class AdminFlowGuideComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  /** Pestaña inicial: permite un enlace directo a «Cómo funciona» o a «Diagnóstico». */
  @Input() initialView = '';

  readonly views: Array<{ id: ViewId; label: string; hint: string }> = [
    { id: 'how', label: 'Cómo funciona', hint: 'Documentación operativa del flujo' },
    { id: 'diagnostics', label: 'Diagnóstico', hint: 'Embudo en vivo, recuperación y registros legacy' },
  ];
  readonly diagnosticsTabs: Array<{ id: DiagnosticsTab; label: string }> = [
    { id: 'funnel', label: 'Embudo en vivo' },
    { id: 'legacy', label: 'Registros legacy' },
  ];
  readonly dimensionOrder = DIMENSION_ORDER;
  readonly dimensionLabels = DIMENSION_LABELS;
  readonly dimensionQuestions = DIMENSION_QUESTIONS;
  readonly distinctions = FLOW_DISTINCTIONS;
  readonly flowStages = FLOW_STAGES;
  readonly examples = FLOW_EXAMPLES;
  readonly absenceMarkers = ABSENCE_MARKERS;
  readonly categories = TOPIC_CATEGORIES;
  readonly originLabels = ORIGIN_LABELS;
  readonly publicationStatusLabels = PUBLICATION_STATUS_LABELS;
  readonly scopeLabels = SCOPE_LABELS;
  readonly maxBulk = MAX_BULK;

  activeView: ViewId = 'how';
  diagnosticsTab: DiagnosticsTab = 'funnel';

  /* Contrato de estados (Vista A) */
  guide: FlowStateGuide | null = null;
  contractVersion = '';
  guideLoading = false;
  guideError = '';

  /* Embudo (Vista B) */
  funnel: FunnelReport | null = null;
  funnelLoading = false;
  funnelError = '';
  stageViews: Record<string, StageView> = {};
  waits: WaitView[] = [];
  funnelLoaded = false;

  filters: Record<(typeof SCOPE_FILTER_KEYS)[number], string> = {
    from: '', to: '', cycleId: '', category: '', stage: '', state: '',
    failureReason: '', model: '', provider: '', origin: '', publicationStatus: '',
  };

  /* Drill-down */
  listOpen = false;
  listStage: FunnelStage | null = null;
  listIds: string[] = [];
  listTotal = 0;
  listTruncated = false;

  /* Ficha de tema */
  topic: TopicView | null = null;
  topicOpen = false;
  topicLoading = false;
  topicError = '';
  topicReturnId = '';

  /* Publicación manual inmediata (clave humana + clave de idempotencia) */
  publishPostId = '';
  publishReviewer = '';
  publishKey = '';
  publishBusy = false;
  publishError = '';
  publishNotice = '';

  /* Recuperación */
  recoveryDialog: RecoveryDialogState | null = null;
  recoverySources = '';
  recoveryNote = '';
  recoveryBusy = false;
  recoveryError = '';
  recoveryConflict = false;
  recoveryNotice = '';
  recoveryResultError = '';
  bulkItems: BulkRecoveryItem[] = [];

  /* Registros legacy y planificador */
  reconciliation: ReconciliationReport | null = null;
  reconciliationLoading = false;
  reconciliationError = '';
  scheduler: SchedulerStatus | null = null;
  schedulerError = '';

  liveMessage = '';
  selected = new Set<string>();
  /** Acción común elegida para la recuperación en lote. */
  bulkAction: RecoveryActionKey = 'add-evidence';

  private subs = new Subscription();
  private returnFocus: HTMLElement | null = null;

  constructor(
    private readonly service: AdminEditorialFlowService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    if (this.initialView === 'diagnostics' || this.initialView === 'how') this.activeView = this.initialView;
    this.loadGuide();
    if (this.activeView === 'diagnostics') this.loadFunnel();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    document.body.style.overflow = '';
  }

  /* ── Navegación entre vistas (pestañas con teclado) ───────────────────── */

  selectView(view: ViewId, moveFocus = false): void {
    if (this.activeView === view) return;
    this.activeView = view;
    this.writeViewToUrl();
    if (view === 'diagnostics' && !this.funnelLoaded) this.loadFunnel();
    if (moveFocus) setTimeout(() => document.getElementById(`flow-view-tab-${view}`)?.focus());
  }

  onViewKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = this.views.findIndex((view) => view.id === this.activeView);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.views.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + this.views.length) % this.views.length;
    this.selectView(this.views[next].id, true);
  }

  selectDiagnosticsTab(tab: DiagnosticsTab, moveFocus = false): void {
    if (this.diagnosticsTab === tab) return;
    this.diagnosticsTab = tab;
    if (tab === 'legacy' && !this.reconciliation && !this.reconciliationLoading) this.loadReconciliation();
    if (moveFocus) setTimeout(() => document.getElementById(`flow-diag-tab-${tab}`)?.focus());
  }

  onDiagnosticsKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = this.diagnosticsTabs.findIndex((tab) => tab.id === this.diagnosticsTab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.diagnosticsTabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + this.diagnosticsTabs.length) % this.diagnosticsTabs.length;
    this.selectDiagnosticsTab(this.diagnosticsTabs[next].id, true);
  }

  /** La vista vive en la URL (`view`), nunca solo en el componente. */
  private writeViewToUrl(): void {
    if (!this.router) return;
    this.router
      .navigate([], { queryParams: { view: this.activeView }, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }

  /* ── Carga del contrato ───────────────────────────────────────────────── */

  loadGuide(): void {
    this.guideLoading = true;
    this.guideError = '';
    this.subs.add(
      this.service.getGuide().subscribe({
        next: (data) => {
          this.guide = data.guide;
          this.contractVersion = data.contractVersion || data.guide?.version || '';
          this.guideLoading = false;
          this.lastUpdatedChange.emit(new Date());
        },
        error: (error) => {
          this.guideLoading = false;
          this.guideError = messageOf(error, 'No se pudo cargar el contrato de estados');
        },
      })
    );
  }

  /* ── Embudo ───────────────────────────────────────────────────────────── */

  /** Ámbito que se envía a la API: solo claves con valor; las fechas, en ISO 8601. */
  currentScope(): FlowScopeQuery {
    const scope: FlowScopeQuery = {};
    for (const key of SCOPE_FILTER_KEYS) {
      const value = this.filters[key];
      if (!value) continue;
      scope[key] = value;
    }
    for (const key of ['from', 'to'] as const) {
      const value = scope[key];
      if (value) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) scope[key] = parsed.toISOString();
      }
    }
    return scope;
  }

  loadFunnel(): void {
    this.funnelLoading = true;
    this.funnelError = '';
    this.subs.add(
      this.service.getFunnel(this.currentScope()).subscribe({
        next: (report) => {
          this.funnel = report;
          this.stageViews = this.buildStageViews(report);
          this.waits = this.buildWaits(report);
          this.funnelLoading = false;
          this.funnelLoaded = true;
          this.lastUpdatedChange.emit(new Date());
        },
        error: (error) => {
          this.funnelLoading = false;
          this.funnelLoaded = true;
          this.funnel = null;
          this.stageViews = {};
          this.waits = [];
          this.funnelError = messageOf(error, 'No se pudo cargar el embudo del flujo editorial');
        },
      })
    );
  }

  /** Barra proporcional SOLO entre etapas medidas; las no disponibles conservan `null`. */
  buildStageViews(report: FunnelReport): Record<string, StageView> {
    const measured = report.stages.filter((stage) => stage.count !== null).map((stage) => stage.count as number);
    const max = measured.length ? Math.max(...measured) : 0;
    const views: Record<string, StageView> = {};
    for (const stage of report.stages) {
      const conversion = stage.conversionFromPrevious;
      const ratioText = conversion && conversion.ratio !== null ? `${(conversion.ratio * 100).toFixed(1)} %` : null;
      views[stage.key] = {
        stage,
        barPercent: stage.count !== null && max > 0 ? Math.round(((stage.count as number) / max) * 100) : 0,
        conversionText:
          conversion && ratioText && conversion.lost !== null
            ? `${ratioText} de «${this.stageLabelOf(conversion.from)}» · se pierden ${conversion.lost}`
            : null,
        conversionBroken: conversion ? conversion.unavailableReason : null,
        drillable: stage.state === 'measured',
      };
    }
    return views;
  }

  buildWaits(report: FunnelReport): WaitView[] {
    return report.stages
      .filter((stage) => stage.conversionFromPrevious !== null)
      .map((stage) => {
        const conversion = stage.conversionFromPrevious!;
        return {
          from: this.stageLabelOf(conversion.from),
          to: stage.label,
          lost: conversion.lost !== null ? conversion.lost : 0,
          ratioLabel: conversion.ratio !== null ? `${(conversion.ratio * 100).toFixed(1)} %` : null,
          reason: conversion.unavailableReason,
          crossDimension: conversion.crossDimension,
        };
      })
      .filter((wait) => wait.reason !== null || wait.crossDimension);
  }

  stageLabelOf(key: string): string {
    return this.funnel?.stages.find((stage) => stage.key === key)?.label ?? key;
  }

  /** Etapas del embudo agrupadas por dimensión, en el orden del contrato. */
  get stageGroups(): Array<{ dimension: FlowDimension; label: string; stages: StageView[]; note: string }> {
    if (!this.funnel) return [];
    return this.funnel.dimensions.map((group) => ({
      dimension: group.dimension,
      label: group.label,
      note: group.totalNote,
      stages: group.stages.map((key) => this.stageViews[key]).filter((view): view is StageView => Boolean(view)),
    }));
  }

  isSeparate(stage: FunnelStage): boolean {
    return SEPARATE_STAGE_KEYS.includes(stage.key);
  }

  applyFilters(event?: Event): void {
    event?.preventDefault();
    this.selected = new Set();
    this.listOpen = false;
    this.listStage = null;
    this.loadFunnel();
  }

  clearFilters(): void {
    this.filters = {
      from: '', to: '', cycleId: '', category: '', stage: '', state: '',
      failureReason: '', model: '', provider: '', origin: '', publicationStatus: '',
    };
    this.selected = new Set();
    this.listOpen = false;
    this.listStage = null;
    this.loadFunnel();
  }

  get hasFilters(): boolean {
    return Object.values(this.filters).some((value) => value !== '');
  }

  get appliedScope(): Array<{ key: string; label: string; value: string }> {
    if (!this.funnel) return [];
    return this.funnel.scope.applied.map((entry) => ({
      key: entry.key,
      label: SCOPE_LABELS[entry.key] ?? entry.key,
      value:
        entry.key === 'origin'
          ? ORIGIN_LABELS[entry.value] ?? entry.value
          : entry.key === 'publicationStatus'
            ? PUBLICATION_STATUS_LABELS[entry.value] ?? entry.value
            : entry.value,
    }));
  }

  /** Opciones de «etapa»: las claves reales del embudo, nunca una lista inventada. */
  get stageOptions(): Array<{ key: string; label: string }> {
    return (this.funnel?.stages ?? []).map((stage) => ({ key: stage.key, label: `${stage.label} · ${stage.dimensionLabel}` }));
  }

  get unavailableStages(): FunnelStage[] {
    return (this.funnel?.stages ?? []).filter((stage) => stage.state === 'unavailable');
  }

  get measuredStages(): FunnelStage[] {
    return (this.funnel?.stages ?? []).filter((stage) => stage.state === 'measured');
  }

  get isEmptyFunnel(): boolean {
    return Boolean(this.funnel) && this.measuredStages.length === 0;
  }

  get isPartialFunnel(): boolean {
    return Boolean(this.funnel) && this.measuredStages.length > 0 && this.unavailableStages.length > 0;
  }

  get allMeasuredEmpty(): boolean {
    return this.measuredStages.length > 0 && this.measuredStages.every((stage) => stage.count === 0);
  }

  /* ── Drill-down: lista de registros reales ────────────────────────────── */

  openList(stage: FunnelStage | StageView, opener?: Event): void {
    const target = (stage as StageView).stage ?? (stage as FunnelStage);
    if (!target || target.state !== 'measured') return;
    if (opener) this.rememberFocus(opener);
    this.listStage = target;
    this.listIds = [...target.drillDown.ids];
    this.listTotal = target.drillDown.total;
    this.listTruncated = target.drillDown.truncated;
    this.listOpen = true;
  }

  closeList(restoreFocus = true): void {
    this.listOpen = false;
    this.listStage = null;
    this.listIds = [];
    this.listTotal = 0;
    if (restoreFocus) this.restoreFocus();
  }

  openTopicFromList(id: string, opener?: Event): void {
    if (opener) this.rememberFocus(opener);
    this.openTopic(id);
  }

  isSelected(id: string): boolean {
    return this.selected.has(id);
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected = next;
  }

  get listAllSelected(): boolean {
    return this.listIds.length > 0 && this.listIds.every((id) => this.selected.has(id));
  }

  toggleAllInList(): void {
    const next = new Set(this.selected);
    if (this.listAllSelected) this.listIds.forEach((id) => next.delete(id));
    else this.listIds.forEach((id) => next.add(id));
    this.selected = next;
  }

  selectAllVisible(): void {
    const unique = [...new Set(this.measuredStages.flatMap((stage) => stage.drillDown.ids))];
    if (unique.length > MAX_BULK) {
      this.recoveryResultError = `No se pueden seleccionar más de ${MAX_BULK} registros a la vez (hay ${unique.length}). Abre la lista de una etapa concreta o refina los filtros.`;
      return;
    }
    this.selected = new Set(unique);
    this.liveMessage = `${unique.length} registro(s) seleccionados para recuperación en lote.`;
  }

  clearSelection(): void {
    this.selected = new Set();
    this.liveMessage = '';
  }
  /* ── Ficha del tema ───────────────────────────────────────────────────── */

  openTopic(id: string): void {
    this.topicReturnId = id;
    this.topicOpen = true;
    this.topicLoading = true;
    this.topicError = '';
    this.topic = null;
    this.recoveryNotice = '';
    this.bulkItems = [];
    this.publishPostId = '';
    this.publishReviewer = '';
    this.publishKey = '';
    this.publishError = '';
    this.publishNotice = '';
    this.subs.add(
      this.service.getTopic(id).subscribe({
        next: (topic) => {
          this.topic = topic;
          this.topicLoading = false;
        },
        error: (error) => {
          this.topicLoading = false;
          this.topicError = messageOf(error, 'No se pudo cargar la ficha del tema');
        },
      })
    );
  }

  closeTopic(restoreFocus = true): void {
    const id = this.topicReturnId;
    this.topicOpen = false;
    this.topic = null;
    this.topicError = '';
    this.topicLoading = false;
    if (restoreFocus) {
      this.restoreFocus();
      setTimeout(() => {
        this.host?.nativeElement?.querySelector<HTMLElement>(`[data-topic-id="${id}"]`)?.focus?.();
      });
    }
  }

  dimensionRows(): Array<{ dimension: FlowDimension; label: string; question: string }> {
    return DIMENSION_ORDER.map((dimension) => ({
      dimension,
      label: DIMENSION_LABELS[dimension],
      question: DIMENSION_QUESTIONS[dimension],
    }));
  }

  /** Definición del estado que muestra la ficha, tomada del contrato cargado. */
  definitionFor(dimension: FlowDimension, state: string): string | null {
    return (this.guide && metaOf(this.guide, dimension, state)?.definition) || null;
  }

  notImpliesFor(dimension: FlowDimension, state: string): string[] {
    return (this.guide && metaOf(this.guide, dimension, state)?.notImplies) || [];
  }

  topicStateLabel(topic: TopicView, dimension: FlowDimension): string {
    const view = topic.dimensions[dimension];
    return view?.label || stateLabel(this.guide, dimension, view?.state ?? '');
  }

  /* ── Recuperación individual y en lote ────────────────────────────────── */

  askRecovery(action: AvailableAction | RecoveryActionKey, topicIds: string[]): void {
    const ids = [...new Set(topicIds)].filter(Boolean);
    if (!ids.length) return;
    const key = typeof action === 'string' ? action : action.key;
    const meta = this.guide?.recoveryActions[key];
    this.recoveryConflict = false;
    this.recoveryError = '';
    this.recoverySources = '';
    this.recoveryNote = '';
    this.recoveryResultError = '';
    this.recoveryNotice = '';
    this.recoveryDialog = {
      action: key,
      label: meta?.label ?? key,
      definition: meta?.definition ?? '',
      topicIds: ids,
      reason: null,
    };
    this.rememberFocus();
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('flow-rec-sources')?.focus());
  }

  cancelRecovery(): void {
    if (this.recoveryBusy) return;
    this.recoveryDialog = null;
    this.recoveryConflict = false;
    this.recoveryError = '';
    document.body.style.overflow = '';
    this.restoreFocus();
  }

  get recoveryNeedsInput(): boolean {
    return this.recoveryDialog ? ['revise-brief', 'replace-source', 'add-evidence'].includes(this.recoveryDialog.action) : false;
  }

  get recoverySourcesList(): string[] {
    return this.recoverySources
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  confirmRecovery(): void {
    const dialog = this.recoveryDialog;
    if (!dialog || this.recoveryBusy) return;
    if (this.recoveryConflict) {
      this.recoveryError =
        'La causa no ha cambiado desde el intento anterior. Cambia las fuentes o el encargo antes de reintentar: el servidor rechazará la misma petición.';
      return;
    }
    const sources = this.recoverySourcesList;
    if (this.recoveryNeedsInput && sources.length === 0) {
      this.recoveryError = 'Indica al menos una URL https con la que cambie la causa antes de relanzar la petición.';
      return;
    }
    this.recoveryBusy = true;
    this.recoveryError = '';
    this.recoveryNotice = '';
    const note = this.recoveryNote.trim() || undefined;

    if (dialog.topicIds.length === 1) {
      this.subs.add(
        this.service
          .recover({ topicId: dialog.topicIds[0], action: dialog.action, sources: sources.length ? sources : undefined, note })
          .subscribe({
            next: (result) => {
              this.recoveryBusy = false;
              this.recoveryDialog = null;
              document.body.style.overflow = '';
              this.bulkItems = [];
              this.recoveryNotice = `Recuperación aplicada (${result.gateway ?? 'sin gateway'}${result.requestId ? `, solicitud ${result.requestId}` : ''}): ${result.detail}`;
              this.liveMessage = this.recoveryNotice;
              this.reloadAfterRecovery();
            },
            error: (error) => this.handleRecoveryError(error),
          })
      );
      return;
    }

    this.subs.add(
      this.service.recoverBulk({ topicIds: dialog.topicIds, action: dialog.action, note }).subscribe({
        next: (result) => {
          this.recoveryBusy = false;
          this.recoveryDialog = null;
          document.body.style.overflow = '';
          this.presentBulkResult(result);
          this.reloadAfterRecovery();
        },
        error: (error) => this.handleRecoveryError(error),
      })
    );
  }

  handleRecoveryError(error: unknown): void {
    this.recoveryBusy = false;
    if (isConflict(error)) {
      // 409: la acción no aplica al estado real o la causa no ha cambiado. El servidor lo explica en español.
      this.recoveryConflict = true;
      this.recoveryError = messageOf(error, 'La acción no aplica al estado real del tema.');
      return;
    }
    this.recoveryError = messageOf(error, 'No se pudo ejecutar la recuperación');
  }

  /**
   * Publicación manual inmediata por la ruta real. El servidor repite todos los
   * gates, el límite diario y la parada de emergencia; aquí solo se transporta
   * la clave humana y una clave de idempotencia estable para este intento.
   */
  confirmPublish(): void {
    const postId = (this.topic?.identity.postId ?? '').trim();
    const reviewer = this.publishReviewer.trim();
    const key = this.publishKey;
    if (!postId || !reviewer || !key || this.publishBusy) return;
    const idempotencyKey = `flow-${postId}-${key.length}-${reviewer}`;
    this.publishBusy = true;
    this.publishError = '';
    this.publishNotice = '';
    this.subs.add(
      this.service.publishNow(postId, key, reviewer, idempotencyKey).subscribe({
        next: () => {
          this.publishBusy = false;
          this.publishKey = '';
          this.publishNotice = 'Publicación ejecutada por la ruta real de publicación: todos los gates, el límite diario y la parada de emergencia se han vuelto a comprobar.';
          this.liveMessage = this.publishNotice;
          this.reloadAfterRecovery();
        },
        error: (error) => {
          this.publishBusy = false;
          this.publishError = messageOf(error, 'No se pudo publicar el artículo');
        },
      })
    );
  }

  presentBulkResult(result: BulkRecoveryResult): void {
    this.bulkItems = result.results;
    const failed = result.results.filter((item) => !item.ok);
    this.recoveryNotice = `${result.succeeded} de ${result.results.length} recuperaciones aplicadas. ${result.note}`;
    this.liveMessage = this.recoveryNotice;
    this.recoveryResultError = failed.length ? `${failed.length} no se pudieron aplicar; cada una explica su motivo.` : '';
    // Solo quedan seleccionados los que fallaron, para poder corregirlos y reintentarlos.
    this.selected = new Set(failed.map((item) => item.topicId));
  }

  reloadAfterRecovery(): void {
    if (this.topicOpen && this.topicReturnId) this.openTopic(this.topicReturnId);
    if (this.funnelLoaded) this.loadFunnel();
    if (this.diagnosticsTab === 'legacy' && this.reconciliation) this.loadReconciliation();
  }

  /** Motivo en español del resultado de cada ítem del lote. */
  bulkCodeLabel(item: BulkRecoveryItem): string {
    switch (item.code) {
      case 'not-applicable':
        return 'No aplica al estado real';
      case 'unchanged-condition':
        return 'La causa no ha cambiado';
      case 'not-found':
        return 'No existe';
      case 'error':
        return 'Error';
      default:
        return item.ok ? 'Aplicada' : 'Fallida';
    }
  }

  gateStatusLabel(status: 'ok' | 'missing' | 'unknown'): string {
    return status === 'ok' ? 'Cumple' : status === 'missing' ? 'Falta' : 'No consta';
  }

  verdictBadge(verdict: ReconciliationRecord['verdict']): { status: string; label: string } {
    if (verdict === 'publicado') return { status: 'completed', label: 'Publicado' };
    if (verdict === 'no publicado') return { status: 'queued', label: 'No publicado' };
    return { status: 'unknown', label: 'Desconocido' };
  }

  /* ── Registros legacy y planificador ──────────────────────────────────── */

  loadReconciliation(): void {
    this.reconciliationLoading = true;
    this.reconciliationError = '';
    this.subs.add(
      this.service.getReconciliation({ category: this.filters['category'] || undefined }).subscribe({
        next: (report) => {
          this.reconciliation = report;
          this.reconciliationLoading = false;
        },
        error: (error) => {
          this.reconciliationLoading = false;
          this.reconciliation = null;
          this.reconciliationError = messageOf(error, 'No se pudo cargar la reconciliación de registros');
        },
      })
    );
  }

  loadScheduler(): void {
    this.schedulerError = '';
    this.subs.add(
      this.service.getScheduler().subscribe({
        next: (status) => {
          this.scheduler = status;
        },
        error: (error) => {
          this.scheduler = null;
          this.schedulerError = messageOf(error, 'No se pudo cargar el estado del planificador');
        },
      })
    );
  }

  /* ── Utilidades de plantilla ──────────────────────────────────────────── */

  citesState(dimension: FlowDimension, state: string): boolean {
    return stateExists(this.guide, dimension, state);
  }

  statesFor(dimension: FlowDimension) {
    return statesOf(this.guide, dimension);
  }

  labelOf(dimension: FlowDimension, state: string): string {
    return stateLabel(this.guide, dimension, state);
  }

  /** Tono del badge: nunca solo color, siempre con la etiqueta del contrato al lado. */
  badgeStatusOf(dimension: FlowDimension, state: string): string {
    if (state === 'desconocido' || state === 'sin-datos') return 'unknown';
    switch (dimension) {
      case 'seo':
        return state === 'indexada' ? 'completed' : 'warning';
      case 'publication':
        return state === 'published' ? 'completed' : state === 'unpublished-after-publication' ? 'failed' : 'queued';
      case 'editorial':
        return state === 'approved' ? 'completed' : state === 'rejected' ? 'failed' : 'reviewing';
      case 'execution':
        return state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'blocked' || state === 'paused' ? 'warning' : 'running';
      default:
        return state === 'rejected' || state === 'invalid' || state === 'duplicate' ? 'failed' : state === 'retained' ? 'warning' : 'running';
    }
  }

  trackKey(_index: number, item: { key: string }): string {
    return item.key;
  }

  trackId(_index: number, id: string): string {
    return id;
  }

  trackStage(_index: number, item: { id?: string; key?: string }): string {
    return item.id ?? item.key ?? String(_index);
  }

  trackDistinction(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackExample(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackCite(_index: number, item: { dimension: string; state: string }): string {
    return `${item.dimension}:${item.state}`;
  }

  trackWait(_index: number, item: { from: string; to: string }): string {
    return `${item.from}→${item.to}`;
  }

  trackBulkItem(_index: number, item: { topicId: string }): string {
    return item.topicId;
  }

  trackRecord(_index: number, item: { postId: string }): string {
    return item.postId;
  }

  trackEntry(_index: number, item: { at: string; what: string }): string {
    return `${item.at}|${item.what}`;
  }

  trackRow(_index: number, item: { dimension: string }): string {
    return item.dimension;
  }

  trackScopeKey(_index: number, item: { key: string }): string {
    return item.key;
  }

  trackStageView(_index: number, item: StageView): string {
    return item.stage.key;
  }

  /** Selección actual como lista, para el diálogo de recuperación en lote. */
  get selectedList(): string[] {
    return [...this.selected];
  }

  /** Botón de métrica activado con Enter o Espacio (el elemento ya es un <button> nativo). */
  onMetricKeydown(_event: KeyboardEvent, _view: StageView): void {
    // El elemento es un <button>: Enter/Espacio ya disparan `click`. No se duplica el manejador.
  }

  /** Acciones comunes disponibles para la selección, leídas del catálogo del contrato. */
  get bulkActions(): Array<{ key: RecoveryActionKey; label: string }> {
    const catalog = this.guide?.recoveryActions;
    if (!catalog) return [];
    return Object.entries(catalog).map(([key, meta]) => ({ key: key as RecoveryActionKey, label: meta.label }));
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return 'No consta';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  rememberFocus(opener?: Event): void {
    const target = opener?.currentTarget ?? (typeof document !== 'undefined' ? document.activeElement : null);
    this.returnFocus = target instanceof HTMLElement ? target : null;
  }

  restoreFocus(): void {
    const target = this.returnFocus;
    this.returnFocus = null;
    target?.focus?.();
  }

  /** Escape cierra la capa superior sin atrapar el foco. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.recoveryDialog) this.cancelRecovery();
    else if (this.topicOpen) this.closeTopic();
    else if (this.listOpen) this.closeList();
  }
}

/* ── Tipos de vista de la plantilla ───────────────────────────────────── */

export interface StageView {
  stage: FunnelStage;
  /** Porcentaje entero de la barra respecto al mayor recuento medido (0–100). */
  barPercent: number;
  conversionText: string | null;
  conversionBroken: string | null;
  drillable: boolean;
}

export interface WaitView {
  from: string;
  to: string;
  lost: number;
  ratioLabel: string | null;
  reason: string | null;
  crossDimension: boolean;
}

export interface RecoveryDialogState {
  action: RecoveryActionKey;
  label: string;
  definition: string;
  topicIds: string[];
  reason: string | null;
}
