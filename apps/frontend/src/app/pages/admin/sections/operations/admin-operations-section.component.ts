import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AdminOperationsService } from '../../../../services/admin-operations.service';
import { AdminEditorialService, EditorialOverview } from '../../../../services/admin-editorial.service';
import { HealthResponse } from '../../../../services/admin-schedules.service';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { AdminStatusBadgeComponent } from '../../components/admin-status-badge/admin-status-badge.component';

type ActionResult = { success: boolean; message: string; time: Date };

@Component({
  selector: 'app-admin-operations-section',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminConfirmDialogComponent, AdminStatusBadgeComponent],
  templateUrl: './admin-operations-section.component.html',
  styleUrls: ['./admin-operations-section.component.scss'],
})
export class AdminOperationsSectionComponent implements OnInit, OnDestroy, OnChanges {
  @Input() activeItem = 'overview';
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  health: HealthResponse | null = null;
  loading = false;
  error: string | null = null;
  cacheNamespace: 'epg' | 'football' | 'catalog' | 'schedules' = 'epg';
  clearLoading = false;
  actionResults: ActionResult[] = [];
  football: any = null;
  jobs: any[] = [];
  scheduled: any[] = [];
  editorial: EditorialOverview | null = null;
  jobBusy = '';
  events: any[] = [];
  alerts: any[] = [];
  cache: any = null;
  rows: any[] = [];
  footballView: 'competitions' | 'teams' | 'fixtures' = 'competitions';
  footballLoading = false;
  confirmCacheInvalidateOpen = false;

  readonly cacheNamespaceLabels: Record<string, string> = {
    epg: 'EPG',
    football: 'Football',
    catalog: 'Catalog',
    schedules: 'Schedules',
  };

  private subs = new Subscription();

  constructor(private opsService: AdminOperationsService, private editorialService: AdminEditorialService) {}

  ngOnInit(): void {
    this.load();
  }
  ngOnChanges(changes: SimpleChanges): void { if (changes['activeItem'] && !changes['activeItem'].firstChange) this.load(); }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  loadHealth(): void {
    this.loading = true;
    this.error = null;
    this.subs.add(
      this.opsService.getHealth().subscribe({
        next: (h) => {
          this.health = h;
          this.loading = false;
          this.lastUpdatedChange.emit(new Date());
        },
        error: (e) => {
          this.error = e?.error?.message || 'Failed to load health';
          this.loading = false;
        },
      })
    );
  }
  load(): void {
    this.loadHealth();
    const request = this.activeItem === 'football' ? this.opsService.getFootballOverview()
      : this.activeItem === 'jobs' ? this.opsService.getJobs()
      : this.activeItem === 'events' ? this.opsService.getEvents()
      : this.activeItem === 'alerts' ? this.opsService.getAlerts()
      : this.activeItem === 'cache' ? this.opsService.getCacheDiagnostics() : null;
    if (this.activeItem === 'jobs') {
      // The Background jobs view is the one place for every job: scheduled system jobs and the editorial (AI) pipeline.
      this.subs.add(this.opsService.getScheduledJobs().subscribe({ next: (data) => { this.scheduled = Array.isArray(data) ? data : []; }, error: () => { this.error = 'Failed to load scheduled jobs'; } }));
      this.subs.add(this.editorialService.getOverview().subscribe({ next: (data) => { this.editorial = data; }, error: () => { this.editorial = null; } }));
    }
    if (request) this.subs.add(request.subscribe({ next: (data) => { if (this.activeItem === 'football') { this.football = data; this.loadFootballRows(); } else if (this.activeItem === 'jobs') this.jobs = data.items || []; else if (this.activeItem === 'events') this.events = data.items || []; else if (this.activeItem === 'alerts') this.alerts = data.items || []; else this.cache = data; this.lastUpdatedChange.emit(new Date()); }, error: () => this.error = 'Failed to load operational data' }));
  }
  runScheduled(name: string): void {
    if (this.jobBusy) return;
    this.jobBusy = name;
    this.subs.add(this.opsService.runScheduledJob(name).subscribe({
      next: () => { this.jobBusy = ''; this.addResult(true, `Job ${name} queued`); this.load(); },
      error: (e) => { this.jobBusy = ''; this.addResult(false, e?.error?.message || `Job ${name} could not be started`); },
    }));
  }
  editorialRunner(action: 'start' | 'stop' | 'restart'): void {
    if (this.jobBusy) return;
    this.jobBusy = `runner-${action}`;
    this.subs.add(this.editorialService.runnerProcess(action).subscribe({
      next: () => { this.jobBusy = ''; this.addResult(true, `Editorial runner: ${action}`); this.load(); },
      error: (e) => { this.jobBusy = ''; this.addResult(false, e?.error?.message || `Editorial runner could not ${action}`); },
    }));
  }
  editorialRequest(id: string, action: 'cancel' | 'retry'): void {
    if (this.jobBusy) return;
    this.jobBusy = id;
    const call = action === 'cancel' ? this.editorialService.cancelRequest(id) : this.editorialService.retryRequest(id);
    this.subs.add(call.subscribe({
      next: () => { this.jobBusy = ''; this.addResult(true, action === 'cancel' ? 'Request cancelled' : 'Request requeued'); this.load(); },
      error: (e) => { this.jobBusy = ''; this.addResult(false, e?.error?.message || 'Request could not be updated'); },
    }));
  }
  editorialDiscover(): void {
    if (this.jobBusy) return;
    this.jobBusy = 'discover';
    this.subs.add(this.editorialService.discover().subscribe({
      next: () => { this.jobBusy = ''; this.addResult(true, 'Topic discovery queued'); this.load(); },
      error: (e) => { this.jobBusy = ''; this.addResult(false, e?.error?.message || 'Discovery could not be queued'); },
    }));
  }
  setFootballView(view: 'competitions' | 'teams' | 'fixtures'): void { this.footballView = view; this.loadFootballRows(); }
  loadFootballRows(): void { if (this.activeItem !== 'football') return; this.footballLoading = true; const request = this.footballView === 'competitions' ? this.opsService.getFootballCompetitions() : this.footballView === 'teams' ? this.opsService.getFootballTeams() : this.opsService.getFootballFixtures(); this.subs.add(request.subscribe({ next: data => { this.rows = data.items || []; this.footballLoading = false; }, error: () => { this.footballLoading = false; this.error = 'Failed to load football diagnostics'; } })); }
  refreshFootball(): void { this.clearLoading = true; this.subs.add(this.opsService.refreshFootball().subscribe({ next: () => { this.addResult(true, 'Football refresh queued'); this.clearLoading = false; this.load(); }, error: () => { this.addResult(false, 'Football refresh could not be queued'); this.clearLoading = false; } })); }

  requestClearCache(): void {
    this.confirmCacheInvalidateOpen = true;
  }

  cancelClearCache(): void {
    this.confirmCacheInvalidateOpen = false;
  }

  clearCache(): void {
    this.clearLoading = true;
    this.subs.add(
      this.opsService.invalidateCache(this.cacheNamespace).subscribe({
        next: () => {
          this.addResult(true, `${this.cacheNamespace} cache invalidated`);
          this.clearLoading = false;
          this.confirmCacheInvalidateOpen = false;
          this.load();
        },
        error: (e) => {
          this.addResult(false, e?.error?.message || 'Cache clear failed');
          this.clearLoading = false;
          this.confirmCacheInvalidateOpen = false;
        },
      })
    );
  }

  private addResult(success: boolean, message: string): void {
    this.actionResults.unshift({ success, message, time: new Date() });
    if (this.actionResults.length > 20) this.actionResults.pop();
  }
}
