import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AdminAIAnalyticsService,
  AIAnalyticsOverview,
  AIAnalyticsTimeSeries,
  AIConversationDetail,
  AIConversationListItem,
  AIFailureDiagnostic,
} from '../../../../services/admin-ai-analytics.service';

type AISectionTab = 'metrics' | 'conversations';

@Component({
  selector: 'app-admin-ai-section',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-[var(--portal-text)]">AI Chatbot Analytics</h2>
        <button
          type="button"
          (click)="refresh()"
          class="rounded-lg border border-[var(--portal-border-strong)] bg-[var(--portal-surface-strong)] px-3 py-1.5 text-xs text-[var(--portal-text-soft)] hover:bg-[var(--portal-border-strong)] transition-colors"
        >
          Refresh
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex flex-wrap gap-2 border-b border-[var(--portal-border)]" role="tablist" aria-label="AI section">
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab === 'metrics'"
          class="px-4 py-2 rounded-t-xl border border-b-0 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
          [ngClass]="activeTab === 'metrics'
            ? 'border-[var(--portal-border-strong)] bg-[var(--portal-surface)] text-[var(--portal-text)] font-semibold'
            : 'border-transparent text-[var(--portal-text-muted)] hover:text-[var(--portal-text)]'"
          (click)="setTab('metrics')"
        >
          Métricas
        </button>
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab === 'conversations'"
          class="px-4 py-2 rounded-t-xl border border-b-0 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
          [ngClass]="activeTab === 'conversations'
            ? 'border-[var(--portal-border-strong)] bg-[var(--portal-surface)] text-[var(--portal-text)] font-semibold'
            : 'border-transparent text-[var(--portal-text-muted)] hover:text-[var(--portal-text)]'"
          (click)="setTab('conversations')"
        >
          Conversaciones
        </button>
      </div>

      <ng-container *ngIf="activeTab === 'metrics'">
        <!-- KPI cards -->
        <div *ngIf="overview" class="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <p class="text-xs text-[var(--portal-text-muted)] uppercase tracking-wider">Conversations</p>
            <p class="text-3xl font-semibold text-[var(--portal-text)] mt-2">{{ overview.totalConversations }}</p>
            <p class="text-xs text-[var(--portal-text-muted)] mt-1">Total</p>
          </div>
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <p class="text-xs text-[var(--portal-text-muted)] uppercase tracking-wider">Messages</p>
            <p class="text-3xl font-semibold text-[var(--portal-text)] mt-2">{{ overview.totalMessages }}</p>
            <p class="text-xs text-[var(--portal-text-muted)] mt-1">Avg {{ overview.avgMessagesPerConversation }}/conv</p>
          </div>
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <p class="text-xs text-[var(--portal-text-muted)] uppercase tracking-wider">Active Today</p>
            <p class="text-3xl font-semibold text-[var(--portal-text)] mt-2">{{ overview.activeUsersToday }}</p>
            <p class="text-xs text-[var(--portal-text-muted)] mt-1">Week: {{ overview.activeUsersWeek }}</p>
          </div>
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <p class="text-xs text-[var(--portal-text-muted)] uppercase tracking-wider">Feedback</p>
            <p class="text-2xl font-semibold mt-2">
              <span class="text-[var(--accent-discover)]">+{{ overview.feedbackSummary.positive }}</span>
              <span class="text-[var(--portal-text-faint)] mx-1">/</span>
              <span class="text-[var(--spotify-negative)]">-{{ overview.feedbackSummary.negative }}</span>
            </p>
            <p class="text-xs text-[var(--portal-text-muted)] mt-1">Thumbs up / down</p>
          </div>
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <p class="text-xs text-[var(--portal-text-muted)] uppercase tracking-wider">Subscriptions</p>
            <p class="text-2xl font-semibold mt-2">
              <span class="text-[var(--portal-text)]">{{ overview.subscriptionBreakdown.free }}</span>
              <span class="text-[var(--portal-text-faint)] mx-1">/</span>
              <span class="text-[var(--spotify-warning)]">{{ overview.subscriptionBreakdown.premium }}</span>
            </p>
            <p class="text-xs text-[var(--portal-text-muted)] mt-1">Free / Premium</p>
          </div>
        </div>

        <!-- Top genres & platforms -->
        <div *ngIf="overview" class="grid md:grid-cols-2 gap-6">
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <h3 class="text-sm font-medium text-[var(--portal-text-soft)] mb-3">Top Genres</h3>
            <div class="space-y-2">
              <div
                *ngFor="let g of overview.topGenres; let i = index"
                class="flex items-center justify-between text-sm"
              >
                <span class="text-[var(--portal-text)]">{{ i + 1 }}. {{ g.genre }}</span>
                <span class="text-[var(--portal-text-muted)]">{{ g.count }}</span>
              </div>
              <p *ngIf="!overview.topGenres.length" class="text-xs text-[var(--portal-text-faint)]">No genre data yet</p>
            </div>
          </div>
          <div class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
            <h3 class="text-sm font-medium text-[var(--portal-text-soft)] mb-3">Top Platforms</h3>
            <div class="space-y-2">
              <div
                *ngFor="let p of overview.topPlatforms; let i = index"
                class="flex items-center justify-between text-sm"
              >
                <span class="text-[var(--portal-text)]">{{ i + 1 }}. {{ p.platform }}</span>
                <span class="text-[var(--portal-text-muted)]">{{ p.count }}</span>
              </div>
              <p *ngIf="!overview.topPlatforms.length" class="text-xs text-[var(--portal-text-faint)]">No platform data yet</p>
            </div>
          </div>
        </div>

        <!-- Activity timeline (table) -->
        <div *ngIf="failures.length" class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
          <h3 class="text-sm font-medium text-[var(--portal-text-soft)] mb-3">Recent assistant exceptions</h3>
          <div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-left text-[var(--portal-text-muted)]"><th class="pb-2">Outcome</th><th>Reason</th><th>Grounding</th><th>Latency</th><th>Time</th></tr></thead><tbody><tr *ngFor="let event of failures" class="border-t border-[var(--portal-border)]"><td class="py-2 text-[var(--spotify-warning)]">{{ event.outcome }}</td><td>{{ event.failureReason || '—' }}</td><td>{{ event.grounding.join(', ') || '—' }}</td><td>{{ event.latencyMs }} ms</td><td>{{ event.createdAt | date:'short' }}</td></tr></tbody></table></div>
        </div>

        <div *ngIf="timeSeries.length" class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5">
          <h3 class="text-sm font-medium text-[var(--portal-text-soft)] mb-3">Daily Activity (last 30 days)</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-[var(--portal-text-muted)] border-b border-[var(--portal-border)]">
                  <th class="pb-2 pr-4">Date</th>
                  <th class="pb-2 pr-4 text-right">Conversations</th>
                  <th class="pb-2 text-right">Messages</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let row of timeSeries"
                  class="border-b border-[var(--portal-border)]/40 last:border-0"
                >
                  <td class="py-1.5 pr-4 text-[var(--portal-text-soft)]">{{ row.date }}</td>
                  <td class="py-1.5 pr-4 text-right text-[var(--portal-text-soft)]">{{ row.conversations }}</td>
                  <td class="py-1.5 text-right text-[var(--portal-text-soft)]">{{ row.messages }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Loading / empty -->
        <div *ngIf="!overview" class="flex items-center justify-center py-16">
          <p class="text-sm text-[var(--portal-text-muted)]">Loading AI analytics…</p>
        </div>
      </ng-container>

      <ng-container *ngIf="activeTab === 'conversations'">
        <div *ngIf="!selectedConversation" class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5 space-y-4">
          <div class="flex flex-wrap items-center gap-3">
            <label for="ai-conv-search" class="sr-only">Buscar en conversaciones</label>
            <input
              id="ai-conv-search"
              type="text"
              class="flex-1 min-w-[200px] bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-xl px-4 py-2 text-sm text-[var(--portal-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
              placeholder="Buscar por título o contenido"
              [value]="conversationSearch"
              (input)="onConversationSearchInput($event)"
              (keydown.enter)="applyConversationSearch()"
            />
            <button
              type="button"
              class="px-4 py-2 rounded-xl border border-[var(--portal-border-strong)] text-[var(--portal-text)] text-sm hover:border-[var(--portal-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
              (click)="applyConversationSearch()"
            >
              Buscar
            </button>
          </div>

          <p class="text-xs text-[var(--portal-text-muted)]">
            {{ conversationsTotal }} conversaciones
          </p>

          <div class="overflow-auto max-h-[520px] border border-[var(--portal-border)] rounded-2xl">
            <table class="min-w-[760px] w-full text-sm text-left" aria-label="Conversaciones del asistente">
              <thead class="sticky top-0 bg-[var(--portal-surface)] text-[11px] uppercase text-[var(--portal-text-muted)]">
                <tr>
                  <th class="px-4 py-3">Usuario</th>
                  <th class="px-4 py-3">Conversación</th>
                  <th class="px-4 py-3">Mensajes</th>
                  <th class="px-4 py-3">Feedback</th>
                  <th class="px-4 py-3">Última actividad</th>
                  <th class="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--portal-border)]">
                <tr *ngIf="conversationsLoading">
                  <td colspan="6" class="px-4 py-6 text-center text-[var(--portal-text-soft)]">Cargando conversaciones…</td>
                </tr>
                <tr *ngIf="!conversationsLoading && conversations.length === 0">
                  <td colspan="6" class="px-4 py-6 text-center text-[var(--portal-text-soft)]">No hay conversaciones para esta búsqueda.</td>
                </tr>
                <tr *ngFor="let conv of conversations; trackBy: trackByConversation" class="hover:bg-[var(--portal-surface)]">
                  <td class="px-4 py-3">
                    <p class="text-[var(--portal-text)] font-medium">{{ conv.userName || 'Usuario' }}</p>
                    <p class="text-xs text-[var(--portal-text-muted)]">{{ conv.userEmail || conv.userId }}</p>
                  </td>
                  <td class="px-4 py-3 text-[var(--portal-text-soft)]">
                    {{ conv.sessionTitle || conv.conversationId }}
                    <span *ngIf="conv.pinned" class="ml-1 text-[10px] text-[var(--accent-discover)]">fijada</span>
                    <span *ngIf="conv.archived" class="ml-1 text-[10px] text-[var(--portal-text-muted)]">archivada</span>
                  </td>
                  <td class="px-4 py-3 text-[var(--portal-text-soft)]">{{ conv.messageCount }}</td>
                  <td class="px-4 py-3">
                    <span class="text-[var(--accent-discover)]">+{{ conv.feedbackPositive }}</span>
                    <span class="text-[var(--portal-text-faint)] mx-1">/</span>
                    <span class="text-[var(--spotify-negative)]">-{{ conv.feedbackNegative }}</span>
                  </td>
                  <td class="px-4 py-3 text-[var(--portal-text-soft)]">{{ conv.lastUsedAt | date:'short' }}</td>
                  <td class="px-4 py-3 text-right">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-lg border border-[var(--portal-border-strong)] text-xs text-[var(--portal-text)] hover:border-[var(--portal-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
                      (click)="openConversation(conv)"
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex items-center justify-between text-xs text-[var(--portal-text-muted)]">
            <span>Página {{ conversationPage }} de {{ conversationPages }}</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded-xl border border-[var(--portal-border-strong)] text-[var(--portal-text)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
                [disabled]="conversationPage <= 1 || conversationsLoading"
                (click)="prevConversationPage()"
              >
                Prev
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-xl border border-[var(--portal-border-strong)] text-[var(--portal-text)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
                [disabled]="conversationPage >= conversationPages || conversationsLoading"
                (click)="nextConversationPage()"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div *ngIf="selectedConversation" class="bg-[var(--portal-surface)] border border-[var(--portal-border)] rounded-2xl p-5 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-medium text-[var(--portal-text)]">
                {{ selectedConversation.sessionTitle || selectedConversation.conversationId }}
              </h3>
              <p class="text-xs text-[var(--portal-text-muted)]">
                {{ selectedConversation.userName || 'Usuario' }} · {{ selectedConversation.userEmail || selectedConversation.userId }} ·
                {{ selectedConversation.messageCount }} mensajes
              </p>
            </div>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg border border-[var(--portal-border-strong)] text-xs text-[var(--portal-text)] hover:border-[var(--portal-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
              (click)="closeConversation()"
            >
              Volver a la lista
            </button>
          </div>

          <div *ngIf="conversationDetailLoading" class="text-sm text-[var(--portal-text-muted)] py-6 text-center">Cargando mensajes…</div>

          <div *ngIf="conversationDetail" class="space-y-3 max-h-[560px] overflow-auto pr-1">
            <div
              *ngFor="let message of conversationDetail.messages"
              class="rounded-2xl border p-4"
              [ngClass]="message.role === 'user'
                ? 'border-[var(--portal-border-strong)] bg-[var(--portal-surface)]'
                : 'border-[var(--portal-border)] bg-[var(--portal-bg-elevated)]/30'"
            >
              <div class="flex items-center justify-between gap-3 mb-2">
                <span class="text-[10px] uppercase tracking-wider text-[var(--portal-text-muted)]">
                  {{ message.role === 'user' ? 'Usuario' : 'Asistente' }}
                </span>
                <span class="text-[10px] text-[var(--portal-text-faint)]">
                  {{ message.createdAt | date:'short' }}
                  <span *ngIf="message.feedback === 'positive'" class="ml-2 text-[var(--accent-discover)]">+1</span>
                  <span *ngIf="message.feedback === 'negative'" class="ml-2 text-[var(--spotify-negative)]">-1</span>
                </span>
              </div>
              <p class="text-sm text-[var(--portal-text-soft)] whitespace-pre-wrap">{{ message.content }}</p>
            </div>
            <p *ngIf="!conversationDetail.messages.length" class="text-sm text-[var(--portal-text-muted)] py-6 text-center">
              Esta conversación no tiene mensajes.
            </p>
          </div>
        </div>
      </ng-container>
    </div>
  `,
})
export class AdminAISectionComponent implements OnInit {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  overview: AIAnalyticsOverview | null = null;
  timeSeries: AIAnalyticsTimeSeries[] = [];
  failures: AIFailureDiagnostic[] = [];

  activeTab: AISectionTab = 'metrics';
  conversations: AIConversationListItem[] = [];
  conversationsLoading = false;
  conversationsLoaded = false;
  conversationsTotal = 0;
  conversationPage = 1;
  conversationPages = 1;
  conversationSearch = '';
  selectedConversation: AIConversationListItem | null = null;
  conversationDetail: AIConversationDetail | null = null;
  conversationDetailLoading = false;

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly service = inject(AdminAIAnalyticsService);

  ngOnInit(): void {
    this.loadData();
  }

  refresh(): void {
    if (this.activeTab === 'conversations') {
      this.loadConversations();
      return;
    }
    this.loadData();
  }

  setTab(tab: AISectionTab): void {
    this.activeTab = tab;
    if (tab === 'conversations' && !this.conversationsLoaded) {
      this.loadConversations();
    }
  }

  onConversationSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.conversationSearch = target?.value || '';
  }

  applyConversationSearch(): void {
    this.conversationPage = 1;
    this.loadConversations();
  }

  prevConversationPage(): void {
    if (this.conversationPage <= 1) return;
    this.conversationPage -= 1;
    this.loadConversations();
  }

  nextConversationPage(): void {
    if (this.conversationPage >= this.conversationPages) return;
    this.conversationPage += 1;
    this.loadConversations();
  }

  openConversation(conversation: AIConversationListItem): void {
    this.selectedConversation = conversation;
    this.conversationDetail = null;
    this.conversationDetailLoading = true;
    this.service
      .getConversation(conversation.conversationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((detail) => {
        this.conversationDetail = detail;
        this.conversationDetailLoading = false;
        this.cdr.markForCheck();
      });
  }

  closeConversation(): void {
    this.selectedConversation = null;
    this.conversationDetail = null;
  }

  trackByConversation(_index: number, conversation: AIConversationListItem): string {
    return conversation.conversationId;
  }

  private loadConversations(): void {
    this.conversationsLoading = true;
    this.service
      .getConversations(this.conversationPage, 20, this.conversationSearch)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.conversations = result?.items || [];
        this.conversationsTotal = result?.pagination.total || 0;
        this.conversationPages = result?.pagination.pages || 1;
        this.conversationsLoading = false;
        this.conversationsLoaded = true;
        this.lastUpdatedChange.emit(new Date());
        this.cdr.markForCheck();
      });
  }

  private loadData(): void {
    this.service
      .getOverview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.overview = data;
        this.lastUpdatedChange.emit(new Date());
        this.cdr.markForCheck();
      });

    this.service
      .getTimeSeries(30)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.timeSeries = data;
        this.cdr.markForCheck();
      });

    this.service.getFailures().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      this.failures = data;
      this.cdr.markForCheck();
    });
  }
}
