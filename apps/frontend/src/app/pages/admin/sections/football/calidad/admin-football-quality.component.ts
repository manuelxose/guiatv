import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { FootballAdminDataService } from '@app/features/football/admin-data/football-admin-data.service';
import {
  AdminApiError,
  adminApiErrorMessage,
  FootballAuditDTO,
  FootballAuditEntryDTO,
  FootballQualityIssueDTO,
  FootballQualityIssuesDTO,
} from '@app/features/football/admin-data/football-admin.models';
import { AdminStatusBadgeComponent } from '@app/pages/admin/components/admin-status-badge/admin-status-badge.component';

const SEVERITY_OPTIONS: Array<{ value: '' | 'info' | 'warning' | 'critical'; label: string }> = [
  { value: '', label: 'Todas las severidades' },
  { value: 'info', label: 'Informativo' },
  { value: 'warning', label: 'Aviso' },
  { value: 'critical', label: 'Crítico' },
];

/**
 * Calidad y auditoría — quality issues plus the operational audit log. Both
 * lists are server-side paginated; the audit adds server-side severity and
 * subsystem filters whose 400 validation messages surface verbatim.
 */
@Component({
  selector: 'app-admin-football-quality',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-football-quality.component.html',
  styleUrls: ['./admin-football-quality.component.scss'],
})
export class AdminFootballQualityComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  readonly severityOptions = SEVERITY_OPTIONS;

  view: 'quality' | 'audit' = 'quality';

  qualityIssues: FootballQualityIssueDTO[] = [];
  qualityTotal = 0;
  qualityPage = 1;
  qualityLoaded = false;
  qualityLoading = false;
  qualityError: string | null = null;

  auditItems: FootballAuditEntryDTO[] = [];
  auditTotal = 0;
  auditPage = 1;
  auditLoaded = false;
  auditLoading = false;
  auditError: string | null = null;
  auditSeverity: '' | 'info' | 'warning' | 'critical' = '';
  auditSubsystem = '';

  unauthorized = false;

  private sub?: Subscription;

  constructor(private readonly data: FootballAdminDataService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  setView(view: 'quality' | 'audit'): void {
    this.view = view;
    if (view === 'quality' && !this.qualityLoaded) this.loadQuality();
    if (view === 'audit' && !this.auditLoaded) this.loadAudit();
  }

  load(): void {
    if (this.view === 'quality') this.loadQuality();
    else this.loadAudit();
  }

  loadQuality(): void {
    this.qualityLoading = true;
    this.qualityError = null;
    this.unauthorized = false;
    this.sub?.unsubscribe();
    this.sub = this.data.getQualityIssues({ page: this.qualityPage, limit: 25 }).subscribe({
      next: (result) => {
        this.applyQuality(result);
        this.qualityLoading = false;
        this.lastUpdatedChange.emit(new Date());
      },
      error: (err: unknown) => {
        this.qualityLoading = false;
        this.handleError(err, 'quality');
      },
    });
  }

  loadAudit(): void {
    this.auditLoading = true;
    this.auditError = null;
    this.unauthorized = false;
    this.sub?.unsubscribe();
    this.sub = this.data
      .getAudit({
        page: this.auditPage,
        limit: 25,
        severity: this.auditSeverity || undefined,
        subsystem: this.auditSubsystem.trim() || undefined,
      })
      .subscribe({
        next: (result) => {
          this.applyAudit(result);
          this.auditLoading = false;
          this.lastUpdatedChange.emit(new Date());
        },
        error: (err: unknown) => {
          this.auditLoading = false;
          this.handleError(err, 'audit');
        },
      });
  }

  applyAuditFilters(): void {
    this.auditPage = 1;
    this.loadAudit();
  }

  onAuditSeverity(event: Event): void {
    this.auditSeverity = (event.target as HTMLSelectElement).value as '' | 'info' | 'warning' | 'critical';
  }

  onAuditSubsystem(event: Event): void {
    this.auditSubsystem = (event.target as HTMLInputElement).value;
  }

  qualityNextPage(): void {
    if (this.qualityPage * 25 >= this.qualityTotal) return;
    this.qualityPage += 1;
    this.loadQuality();
  }

  qualityPrevPage(): void {
    if (this.qualityPage <= 1) return;
    this.qualityPage -= 1;
    this.loadQuality();
  }

  auditNextPage(): void {
    if (this.auditPage * 25 >= this.auditTotal) return;
    this.auditPage += 1;
    this.loadAudit();
  }

  auditPrevPage(): void {
    if (this.auditPage <= 1) return;
    this.auditPage -= 1;
    this.loadAudit();
  }

  severityStatus(severity: string): string {
    switch (severity) {
      case 'info':
        return 'info';
      case 'warning':
        return 'warning';
      case 'critical':
        return 'critical';
      default:
        return 'unknown';
    }
  }

  private applyQuality(result: FootballQualityIssuesDTO): void {
    this.qualityIssues = result.items;
    this.qualityTotal = result.total;
    this.qualityPage = result.page;
    this.qualityLoaded = true;
  }

  private applyAudit(result: FootballAuditDTO): void {
    this.auditItems = result.items;
    this.auditTotal = result.total;
    this.auditPage = result.page;
    this.auditLoaded = true;
  }

  private handleError(err: unknown, target: 'quality' | 'audit'): void {
    if (err instanceof AdminApiError) {
      this.unauthorized = err.kind === 'unauthorized';
      const message = adminApiErrorMessage(err);
      if (target === 'quality') this.qualityError = message;
      else this.auditError = message;
    } else if (target === 'quality') {
      this.qualityError = 'No se han podido cargar las incidencias de calidad.';
    } else {
      this.auditError = 'No se ha podido cargar la auditoría.';
    }
  }
}
