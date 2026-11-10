import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { PanelTileComponent } from '../../../../components/panel-tile/panel-tile.component';
import { ConversationSummary } from '../../../../interfaces/chatbot.interface';
import { PREFERENCE_QUESTIONS, PreferenceOption } from '../../../../interfaces/chat-profile.types';
import { UserContentInteraction, UserListItem } from '../../../../interfaces/user.interface';
import { CatalogItem, CatalogService } from '../../../../services/catalog.service';
import { ChatService } from '../../../../services/chat.service';
import { AssistantMemorySnapshot, ChatbotService } from '../../../../services/chatbot.service';
import { UserService } from '../../../../services/user.service';
import { TvDataFacade } from '../../../../state/tv-data.facade';
import { resolvePlatformLogoUrl } from '../../../../utils/platform-logos';
import { computePersonalizationCompletion } from '../../../../utils/personalization-completion';
import { GENRE_OPTIONS, genreAffinity, rankTonight, sameValue, smartPrompts, tasteSummary } from '../../../../utils/taste-profile';

type MemoryList = 'preferredViewingContexts' | 'preferredDurations' | 'negativeSignals' | 'dislikedGenres' | 'avoidedPlatforms' | 'favoriteFranchisesOrTitles';

const options = (key: string): PreferenceOption[] => PREFERENCE_QUESTIONS.find((q) => q.key === key)?.options ?? [];
const MAX = 10; // the API keeps at most 10 values per field

/** Where each completion item is edited: profile fields live in Gustos, the rest in a section of this tab. */
const COMPLETION_TARGET: Record<string, { tab: string; fragment?: string }> = {
  preferredPlatforms: { tab: 'gustos' },
  favoriteGenres: { tab: 'gustos' },
  preferredViewingContexts: { tab: 'asistente', fragment: 'as-plan' },
  preferredDurations: { tab: 'asistente', fragment: 'as-plan' },
  favoriteFranchisesOrTitles: { tab: 'asistente', fragment: 'as-refs' },
  preferredAutonomousCommunity: { tab: 'asistente', fragment: 'as-region' },
  negativeSignals: { tab: 'asistente', fragment: 'as-avoid' },
};

interface ForYouRec { item: CatalogItem; reason?: string }

/**
 * The AI profile: what the assistant knows (portrait, completion), what that means (genre affinity, activity),
 * what it would suggest right now from the site's own data (tonight on TV, streaming picks), one-tap personal
 * questions, every memory field editable on the spot, the conversations, and privacy controls.
 */
@Component({
  selector: 'app-my-assistant',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, PanelTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../perfil-ui.scss', './my-assistant.component.scss'],
  templateUrl: './my-assistant.component.html',
})
export class MyAssistantComponent {
  private readonly chatbot = inject(ChatbotService);
  private readonly chat = inject(ChatService);
  private readonly user = inject(UserService);

  readonly max = MAX;
  readonly contexts = options('preferredViewingContexts');
  readonly durations = options('preferredDurations');
  readonly avoidContent = options('negativeSignals');
  readonly genres = GENRE_OPTIONS;
  readonly platforms = options('preferredPlatforms');
  readonly communities = options('preferredAutonomousCommunity');

  readonly memory = toSignal(this.chatbot.memory$, { initialValue: null as AssistantMemorySnapshot | null });
  readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  private readonly history = toSignal(this.user.getInteractionHistory(), { initialValue: [] as UserContentInteraction[] });
  private readonly watchlist = toSignal(this.user.getWatchlist(), { initialValue: [] as UserListItem[] });

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal('');
  readonly question = signal('');
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly searching = signal(false);
  private readonly all = signal<ConversationSummary[]>([]);

  // ── What the assistant knows ──
  readonly completion = computed(() => computePersonalizationCompletion(this.profile(), this.memory()));
  readonly percent = computed(() => Math.round((this.completion().done / this.completion().total) * 100));
  readonly portrait = computed(() => tasteSummary(this.profile().preferredPlatforms, this.profile().favoriteGenres, this.memory()));
  readonly affinity = computed(() => genreAffinity(this.profile().favoriteGenres, this.memory(), this.history()));
  readonly prompts = computed(() => smartPrompts(this.profile().preferredPlatforms, this.memory(), this.watchlist().map((w) => w.title)));
  readonly stats = computed(() => {
    const rated = this.history().filter((h) => h.rating);
    return {
      seen: this.history().filter((h) => h.status === 'seen').length,
      rated: rated.length,
      avg: rated.length ? rated.reduce((s, h) => s + (h.rating || 0), 0) / rated.length : 0,
      pending: this.watchlist().length,
    };
  });

  // ── What it would suggest now, from the site's data ──
  private readonly tonightRaw = toSignal(inject(TvDataFacade).getTonightPrograms({ limit: 200 }).pipe(catchError(() => of([]))), { initialValue: [] });
  readonly tonight = computed(() => {
    const m = this.memory();
    return rankTonight(this.tonightRaw(), {
      likedGenres: [...this.profile().favoriteGenres, ...(m?.likedGenres ?? [])],
      avoid: [...(m?.dislikedGenres ?? []), ...(m?.negativeSignals ?? [])],
      favoriteChannelIds: this.profile().tvPreferences.favoriteChannelIds,
      community: m?.preferredAutonomousCommunity,
    });
  });
  readonly forYou = toSignal(
    inject(CatalogService).getForYou(8).pipe(
      map((recs: ForYouRec[]) => (recs || []).filter((r) => r?.item?.catalogId && r.item.title).slice(0, 6)),
      catchError(() => of([] as ForYouRec[]))
    ),
    { initialValue: [] as ForYouRec[] }
  );

  constructor() {
    this.chatbot.fetchAssistantMemory().subscribe();
    this.user.fetchInteractionHistory().subscribe();
    this.user.fetchWatchlist().subscribe();
    this.loadConversations();
  }

  target(key: string) {
    return COMPLETION_TARGET[key] ?? { tab: 'asistente' };
  }

  logo(name: string): string {
    return resolvePlatformLogoUrl(name);
  }

  // ── Memory editing ──
  list(field: MemoryList): string[] {
    return (this.memory()?.[field] as string[] | undefined) ?? [];
  }

  /** Selected when the field holds this option, in the UI's form or the chat extractor's short form. */
  has(field: MemoryList, value: string): boolean {
    return this.list(field).some((v) => sameValue(v, value));
  }

  /** Values the assistant learnt in conversation that are none of the offered options (shown so they can be removed). */
  learnt(field: MemoryList, offered: PreferenceOption[]): string[] {
    return this.list(field).filter((v) => !offered.some((o) => sameValue(v, o.value)));
  }

  toggle(field: MemoryList, value: string): void {
    const current = this.list(field);
    const next = this.has(field, value) ? current.filter((v) => !sameValue(v, value)) : [...current, value].slice(-MAX);
    this.save({ [field]: next });
  }

  removeValue(field: MemoryList, value: string): void {
    this.save({ [field]: this.list(field).filter((v) => v !== value) });
  }

  addTitle(raw: string): void {
    const title = raw.trim();
    if (title && !this.list('favoriteFranchisesOrTitles').some((t) => t.toLowerCase() === title.toLowerCase())) {
      this.save({ favoriteFranchisesOrTitles: [...this.list('favoriteFranchisesOrTitles'), title].slice(-MAX) });
    }
  }

  setCommunity(value: string): void {
    this.save({}, value || null);
  }

  // ── Asking ──
  /** Opens the assistant in a new conversation and sends the question. */
  ask(text: string): void {
    const q = text.trim();
    if (!q) return;
    this.chatbot.startNewConversation();
    this.chat.requestOpenChat('portal-assistant');
    this.chatbot.sendMessageStream(q).subscribe({ error: () => undefined });
    this.question.set('');
  }

  // ── Conversations ──
  open(c: ConversationSummary): void {
    this.chatbot.switchConversation(c.conversationId).subscribe();
    this.chat.requestOpenChat('portal-assistant');
  }

  newConversation(): void {
    this.chatbot.startNewConversation();
    this.chat.requestOpenChat('portal-assistant');
  }

  pin(c: ConversationSummary): void {
    this.chatbot.updateConversation(c.conversationId, { pinned: !c.pinned }).subscribe(() => this.loadConversations());
  }

  remove(c: ConversationSummary): void {
    if (!confirm(`¿Borrar «${c.sessionTitle || 'esta conversación'}»?`)) return;
    this.chatbot.deleteConversation(c.conversationId).subscribe(() => this.loadConversations());
  }

  search(q: string): void {
    const query = q.trim();
    this.searching.set(!!query);
    if (!query) {
      this.conversations.set(this.all());
      return;
    }
    this.chatbot.searchConversations(query).subscribe((list) => this.conversations.set(list));
  }

  // ── Privacy ──
  clearChats(): void {
    if (!confirm('¿Borrar el historial del chat actual? Tus preferencias se mantienen.')) return;
    this.chatbot.clearHistory().subscribe(() => this.loadConversations());
  }

  reset(): void {
    if (!confirm('¿Borrar todo lo que el asistente ha aprendido de ti? No se puede deshacer.')) return;
    this.saving.set(true);
    this.chatbot.resetAssistantMemory().subscribe(() => this.saving.set(false));
  }

  private loadConversations(): void {
    this.chatbot.listConversations().subscribe((list) => {
      const sorted = list.filter((c) => !c.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned));
      this.all.set(sorted);
      this.conversations.set(sorted);
    });
  }

  private save(prefs: Record<string, string[]>, community?: string | null): void {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set('');
    this.chatbot.updateAssistantMemory(prefs, community).subscribe((memory) => {
      this.saving.set(false);
      if (memory) {
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2500);
      } else {
        this.error.set('No se pudo guardar. Inténtalo de nuevo.');
      }
    });
  }
}
