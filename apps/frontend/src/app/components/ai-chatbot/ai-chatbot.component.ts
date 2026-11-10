import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import {
  AssistantMemorySnapshot,
  ChatMessage,
  ChatbotRecommendation,
  ChatbotRequestState,
  ChatbotSessionState,
  ConversationSummary,
  isChatbotBusyState,
} from '../../interfaces/chatbot.interface';
import { ChatbotService } from '../../services/chatbot.service';
import { UserService } from '../../services/user.service';
import { AnalyticsService } from '../../services/analytics.service';

import { ChatHeaderComponent } from './chat-header/chat-header.component';
import { ChatWelcomeScreenComponent } from './chat-welcome-screen/chat-welcome-screen.component';
import { ChatMessageBubbleComponent } from './chat-message-bubble/chat-message-bubble.component';
import { ChatInputBarComponent } from './chat-input-bar/chat-input-bar.component';
import { ChatSkeletonComponent } from './chat-skeleton/chat-skeleton.component';
import { ChatConversationSidebarComponent } from './chat-conversation-sidebar/chat-conversation-sidebar.component';
import { ChatProfilePanelComponent } from './chat-profile-panel/chat-profile-panel.component';
import { PreferenceAnswer } from '../../interfaces/chat-profile.types';

import { ChatHomeComponent } from './chat-home/chat-home.component';
import { computePersonalizationCompletion } from '../../utils/personalization-completion';

@Component({
  selector: 'app-ai-chatbot',
  standalone: true,
  imports: [
    CommonModule,
    ChatHeaderComponent,
    ChatWelcomeScreenComponent,
    ChatMessageBubbleComponent,
    ChatInputBarComponent,
    ChatSkeletonComponent,
    ChatConversationSidebarComponent,
    ChatProfilePanelComponent,
    ChatHomeComponent,
  ],
  templateUrl: './ai-chatbot.component.html',
  styleUrl: './ai-chatbot.component.scss',
})
export class AIChatbotComponent implements AfterViewInit {
  @Output() close = new EventEmitter<void>();
  @Output() openSocial = new EventEmitter<void>();
  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('inputBar') inputBar?: ChatInputBarComponent;
  @ViewChild('profilePanel') profilePanel?: ChatProfilePanelComponent;

  public messages: ChatMessage[] = [];
  public needsOnboarding = false;
  public sessionState: ChatbotSessionState = 'unknown';
  public chatState: ChatbotRequestState = 'login_required';
  public previewSuggestions: string[] = [];
  public assistantMemory: AssistantMemorySnapshot | null = null;
  public profilePlatforms: string[] = [];
  public profileGenres: string[] = [];
  public profileSaving = false;
  public profileSaveError = '';
  public showScrollFab = false;
  public conversations: ConversationSummary[] = [];
  public activeConversationId: string | null = null;
  public readonly autonomousCommunities = [
    'Andalucía',
    'Aragón',
    'Asturias',
    'Baleares',
    'Canarias',
    'Cantabria',
    'Castilla-La Mancha',
    'Castilla y León',
    'Cataluña',
    'Comunidad Valenciana',
    'Extremadura',
    'Galicia',
    'La Rioja',
    'Madrid',
    'Murcia',
    'Navarra',
    'País Vasco',
  ];

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  // The profile and conversation surfaces are mutually exclusive so neither
  // can obscure the other inside the constrained chat viewport.
  private _activePanel: 'none' | 'profile' | 'sidebar' = 'none';

  get sidebarOpen(): boolean {
    return this._activePanel === 'sidebar';
  }
  set sidebarOpen(value: boolean) {
    this._activePanel = value ? 'sidebar' : this._activePanel === 'sidebar' ? 'none' : this._activePanel;
  }

  get profileExpanded(): boolean {
    return this._activePanel === 'profile';
  }
  set profileExpanded(value: boolean) {
    this._activePanel = value ? 'profile' : this._activePanel === 'profile' ? 'none' : this._activePanel;
  }

  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly userService: UserService,
    private readonly router: Router,
    private readonly analytics: AnalyticsService
  ) {}

  ngAfterViewInit(): void {
    this.chatbotService.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((messages) => {
        this.messages = messages;
        this.previewSuggestions = messages[0]?.followUpSuggestions || [];
        this.cdr.detectChanges();
        if (!this.showScrollFab) {
          queueMicrotask(() => this.scrollToBottom());
        }
      });

    this.chatbotService.memory$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((memory) => {
        this.assistantMemory = memory;
        this.cdr.detectChanges();
      });

    this.chatbotService.sessionState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.sessionState = state;
        this.cdr.detectChanges();
        if (state === 'authenticated') {
          this.chatbotService.hydrateConversation().subscribe({
            error: () => undefined,
          });
        }
      });

    this.chatbotService.chatState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.chatState = state;
        this.cdr.detectChanges();
        if (!this.showScrollFab) {
          queueMicrotask(() => this.scrollToBottom());
        }
      });

    combineLatest([
      this.userService.isAuthenticated$,
      this.userService.getProfile(),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([isAuthenticated, profile]) => {
        this.profilePlatforms = [...(profile.preferredPlatforms || [])];
        this.profileGenres = [...(profile.favoriteGenres || [])];
        this.needsOnboarding = Boolean(
          isAuthenticated &&
            (!profile.favoriteGenres?.length || !profile.preferredPlatforms?.length)
        );
      });
  }

  onMessageSent(text: string): void {
    if (
      !text ||
      isChatbotBusyState(this.chatState) ||
      this.sessionState !== 'authenticated'
    ) {
      return;
    }

    this.analytics.trackEvent('assistant_prompt_sent', { promptLength: text.length });
    this.chatbotService.sendMessageStream(text).subscribe({
      error: () => undefined,
    });
  }

  useSuggestion(text: string): void {
    this.sendQuickMessage(text);
  }

  onUseSavedCommunity(message: ChatMessage): void {
    const savedCommunity = this.getSavedCommunity(message);
    if (!savedCommunity) {
      return;
    }

    this.sendQuickMessage(`Sí, usa ${savedCommunity} para las autonómicas`);
  }

  selectCommunity(community: string): void {
    this.sendQuickMessage(`Mi comunidad es ${community}. Incluye autonómicas`);
  }

  declineAutonomics(): void {
    this.sendQuickMessage('No incluyas autonómicas');
  }

  openRecommendation(recommendation: ChatbotRecommendation): void {
    this.analytics.trackEvent('assistant_recommendation_opened', { type: recommendation.type });
    this.chatbotService
      .trackRecommendationAction('open_recommendation', recommendation)
      .subscribe();

    const catalogId = recommendation.catalogId;

    // Only navigate to /contenido/ for real catalog IDs (tmdb:movie:* or tmdb:tv:*).
    // EPG program IDs (program:*) are ephemeral and have no catalog detail page.
    if (catalogId && !catalogId.startsWith('program:')) {
      this.close.emit();
      void this.router.navigate(['/contenido', catalogId]);
      return;
    }

    // Navigate to detailPath if available (any device, any path type including /programas/).
    if (recommendation.detailPath) {
      this.close.emit();
      void this.router.navigateByUrl(recommendation.detailPath);
      return;
    }

    // No detailPath at all: open chatbot search as fallback.
    this.inputBar?.setDraft(`Cuéntame más sobre ${recommendation.title}`);
    queueMicrotask(() => this.inputBar?.focus());
  }

  saveRecommendation(recommendation: ChatbotRecommendation): void {
    this.chatbotService
      .trackRecommendationAction('save_recommendation', recommendation)
      .subscribe();

    this.userService
      .toggleWatchlistItem({
        contentId: String(
          recommendation.catalogId || recommendation.tmdbId || recommendation.title
        ),
        title: recommendation.title,
        type: recommendation.type,
      })
      .subscribe();
  }

  askAboutTitle(recommendation: ChatbotRecommendation): void {
    this.chatbotService
      .trackRecommendationAction('follow_recommendation', recommendation)
      .subscribe();
    this.inputBar?.setDraft(`Quiero algo parecido a ${recommendation.title}`);
    queueMicrotask(() => this.inputBar?.focus());
  }

  ignoreRecommendation(recommendation: ChatbotRecommendation): void {
    this.chatbotService
      .trackRecommendationAction('ignore_recommendation', recommendation)
      .subscribe();
  }

  ratePositiveRecommendation(recommendation: ChatbotRecommendation): void {
    this.chatbotService
      .trackRecommendationAction('rate_positive', recommendation)
      .subscribe();
  }

  rateNegativeRecommendation(recommendation: ChatbotRecommendation): void {
    this.chatbotService
      .trackRecommendationAction('rate_negative', recommendation)
      .subscribe();
  }

  onFeedbackPositive(message: ChatMessage): void {
    this.applyMessageFeedback(message, 'positive');
  }

  onFeedbackNegative(message: ChatMessage): void {
    this.applyMessageFeedback(message, 'negative');
  }

  private applyMessageFeedback(message: ChatMessage, rating: 'positive' | 'negative'): void {
    message.feedback = { rating };
    const conversationId = this.chatbotService.getActiveConversationId();
    if (!conversationId) return;

    const messageIndex = this.messages.indexOf(message);
    if (messageIndex < 0) return;

    this.chatbotService
      .trackMessageFeedback(conversationId, messageIndex, rating)
      .subscribe();
  }

  onRemindProgram(recommendation: ChatbotRecommendation): void {
    this.chatbotService.createProgramReminder(recommendation).subscribe();
  }

  retryHistory(): void {
    this.chatbotService.hydrateConversation(true).subscribe({
      error: () => undefined,
    });
  }

  stopGeneration(): void {
    this.analytics.trackEvent('assistant_generation_stopped');
    this.chatbotService.stopGeneration();
  }

  retryLastPrompt(): void {
    this.analytics.trackEvent('assistant_prompt_retried');
    this.chatbotService.retryLastPrompt().subscribe({ error: () => undefined });
  }

  canRetryLastPrompt(): boolean {
    return this.chatbotService.hasRetryablePrompt() &&
      (this.chatState === 'cancelled' ||
        this.chatState === 'rate_limited' ||
        this.chatState === 'offline' ||
        this.chatState === 'unavailable');
  }

  startNewConversation(): void {
    this.chatbotService.startNewConversation();
    this.activeConversationId = null;
    this.inputBar?.setDraft('');
    queueMicrotask(() => this.inputBar?.focus());
    if (this.sidebarOpen) {
      this.chatbotService.listConversations().subscribe((list) => {
        this.conversations = list;
      });
    }
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
    if (this.sidebarOpen) {
      this.activeConversationId = this.chatbotService.getActiveConversationId();
      this.chatbotService.listConversations().subscribe((list) => {
        this.conversations = list;
      });
    }
  }

  onSelectConversation(conversationId: string): void {
    this.chatbotService.switchConversation(conversationId).subscribe(() => {
      this.activeConversationId = conversationId;
      this.sidebarOpen = false;
    });
  }

  onUpdateConversation(event: { conversationId: string; updates: { sessionTitle?: string; pinned?: boolean; archived?: boolean } }): void {
    this.chatbotService.updateConversation(event.conversationId, event.updates).subscribe(() => {
      this.chatbotService.listConversations().subscribe((list) => {
        this.conversations = list;
      });
    });
  }

  onDeleteConversation(conversationId: string): void {
    this.chatbotService.deleteConversation(conversationId).subscribe(() => {
      if (this.activeConversationId === conversationId) {
        this.activeConversationId = null;
      }
      this.chatbotService.listConversations().subscribe((list) => {
        this.conversations = list;
      });
    });
  }

  onSearchConversations(query: string): void {
    if (!query.trim()) {
      this.chatbotService.listConversations().subscribe((list) => {
        this.conversations = list;
      });
      return;
    }
    this.chatbotService.searchConversations(query).subscribe((list) => {
      this.conversations = list;
    });
  }

  goToLogin(): void {
    this.close.emit();
    void this.router.navigate(['/iniciar-sesion']);
  }

  goToRegister(): void {
    this.close.emit();
    void this.router.navigate(['/registro']);
  }

  /** Empty conversation (only the greeting): show the personalized start instead of a lone bubble. */
  get showHome(): boolean {
    return this.sessionState === 'authenticated' && this.messages.every((m) => m.id === 'welcome');
  }

  /** How well the assistant knows the user (0–100), for the header meter. */
  get knowledge(): number | null {
    if (this.sessionState !== 'authenticated') return null;
    const c = computePersonalizationCompletion({ preferredPlatforms: this.profilePlatforms, favoriteGenres: this.profileGenres }, this.assistantMemory);
    return Math.round((c.done / c.total) * 100);
  }

  openAiProfile(): void {
    void this.router.navigate(['/perfil'], { queryParams: { tab: 'asistente' } });
  }

  goToAccountSettings(): void {
    this.close.emit();
    void this.router.navigate(['/perfil'], { queryParams: { tab: 'asistente' } });
  }

  scrollToBottom(): void {
    if (!this.messagesContainer) {
      return;
    }

    const element = this.messagesContainer.nativeElement;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }

  onMessagesScroll(): void {
    if (!this.messagesContainer) return;
    const el = this.messagesContainer.nativeElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.showScrollFab = distanceFromBottom > 120;
  }

  /** Follow-ups and the regional note belong to the latest answer only; older ones would just repeat. */
  private isLatestAnswer(message: ChatMessage): boolean {
    const answers = this.messages.filter((m) => m.role === 'assistant' && m.id !== 'welcome');
    return answers[answers.length - 1] === message;
  }

  getMessageSuggestions(message: ChatMessage): string[] {
    if (!this.isLatestAnswer(message)) return [];
    const latestUserMessage = this.getLatestUserMessage();
    const seen = new Set<string>();
    const normalizedLast = this.normalize(latestUserMessage);
    const previousAssistantSuggestions = this.getPreviousAssistantSuggestions(message);

    return (message.followUpSuggestions || [])
      .filter((suggestion) => {
        const safe = suggestion.trim();
        if (!safe) {
          return false;
        }
        const normalized = this.normalize(safe);
        if (
          !normalized ||
          normalized === normalizedLast ||
          seen.has(normalized) ||
          previousAssistantSuggestions.has(normalized)
        ) {
          return false;
        }
        seen.add(normalized);
        return true;
      })
      .slice(0, 3);
  }

  /** Ask only when there is no saved choice; with a saved community show the short "Incluyo… · Cambiar" note. */
  shouldShowAutonomicPrompt(message: ChatMessage): boolean {
    const ctx = message.queryContext;
    return Boolean(
      message.role === 'assistant' &&
        this.isLatestAnswer(message) &&
        ctx?.hasAutonomicMatches &&
        (ctx.autonomicPromptRequired || ctx.savedAutonomousCommunity)
    );
  }

  getSavedCommunity(message: ChatMessage): string | null {
    const savedCommunity = String(
      message.queryContext?.savedAutonomousCommunity || ''
    ).trim();
    return savedCommunity || null;
  }

  getAutonomicPromptText(message: ChatMessage): string {
    const savedCommunity = this.getSavedCommunity(message);
    if (savedCommunity) {
      return `También puedo incluir autonómicas. Tengo guardada ${savedCommunity}. ¿Sigo usando esa comunidad?`;
    }

    return 'También puedo incluir autonómicas si me dices tu comunidad autónoma.';
  }

  getResultSummary(message: ChatMessage): string {
    const context = message.queryContext;
    if (!context || !context.totalMatches) {
      return '';
    }

    const noun = this.buildRequestedLabel(context.requestedTypes);
    const scope = context.primaryMatches && context.primaryMatches > 0
      ? `${Math.min(context.shownCount || 0, context.primaryMatches)} de ${context.primaryMatches}`
      : `${context.totalMatches}`;
    return `${scope} ${noun} · ${context.answerWindowLabel}`;
  }

  private getLatestUserMessage(): string {
    const latest = [...this.messages].reverse().find((message) => message.role === 'user');
    return latest?.content || '';
  }

  private buildRequestedLabel(
    requestedTypes: Array<'movie' | 'series' | 'program'> = []
  ): string {
    if (requestedTypes.includes('movie') && !requestedTypes.includes('series')) {
      return 'películas';
    }
    if (requestedTypes.includes('series') && !requestedTypes.includes('movie')) {
      return 'series';
    }
    return 'resultados';
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  public sendQuickMessage(text: string): void {
    const normalized = text.trim();
    if (
      !normalized ||
      isChatbotBusyState(this.chatState) ||
      this.sessionState !== 'authenticated'
    ) {
      return;
    }

    this.chatbotService.sendMessageStream(normalized).subscribe({
      error: () => undefined,
    });
  }

  openProfilePanel(): void {
    this.profileSaveError = '';
    this.profileExpanded = true;
  }

  closeProfilePanel(): void {
    this.profileSaveError = '';
    this.profileSaving = false;
    this.profileExpanded = false;
    queueMicrotask(() => this.inputBar?.focus());
  }

  onPreferenceAnswer(answer: PreferenceAnswer): void {
    if (this.profileSaving) return;
    this.profileSaving = true;
    this.profileSaveError = '';

    // Shared with Mi GuíaTV's assistant-preferences surface so both UIs
    // route an answer to the same store (profile vs. assistant memory) the
    // same way — see ChatbotService.applyPreferenceAnswer.
    this.chatbotService
      .applyPreferenceAnswer(answer, this.profilePlatforms, this.profileGenres)
      .subscribe({
        next: (saved) => (saved ? this.completeProfileSave() : this.failProfileSave()),
        error: () => this.failProfileSave(),
      });
  }

  private completeProfileSave(): void {
    this.profileSaving = false;
    this.profileSaveError = '';
    this.profilePanel?.onSaveComplete();
  }

  private failProfileSave(): void {
    this.profileSaving = false;
    this.profileSaveError = 'No se ha podido guardar. Revisa la conexión y vuelve a intentarlo.';
  }

  trackByMessage(_index: number, message: ChatMessage): string {
    return message.id;
  }

  private getPreviousAssistantSuggestions(message: ChatMessage): Set<string> {
    const index = this.messages.findIndex((entry) => entry.id === message.id);
    if (index <= 0) {
      return new Set();
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = this.messages[cursor];
      if (previous.role !== 'assistant') {
        continue;
      }

      return new Set(
        (previous.followUpSuggestions || [])
          .map((suggestion) => this.normalize(suggestion))
          .filter(Boolean)
      );
    }

    return new Set();
  }
}
