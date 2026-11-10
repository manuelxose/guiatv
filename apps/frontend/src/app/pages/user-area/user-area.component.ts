import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { PERFIL_LINKS, PerfilTab } from '../../config/perfil-nav';
import { APP_PATHS } from '../../config/route-map';
import { UserListItem, UserNotification } from '../../interfaces/user.interface';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { ChatbotService } from '../../services/chatbot.service';
import { MetaService } from '../../services/meta.service';
import { UserService } from '../../services/user.service';
import { computePersonalizationCompletion } from '../../utils/personalization-completion';
import { avatarSrc } from '../../utils/avatar-src';
import { MyAccountComponent } from './components/my-account/my-account.component';
import { MyAssistantComponent } from './components/my-assistant/my-assistant.component';
import { MyFootballComponent } from './components/my-football/my-football.component';
import { MyChannelsComponent } from './components/my-channels/my-channels.component';
import { MyLibraryComponent } from './components/my-library/my-library.component';
import { MyNoticesComponent } from './components/my-notices/my-notices.component';
import { MyTastesComponent } from './components/my-tastes/my-tastes.component';

/** Old `?tab=` values (bookmarks, links from other pages, the chatbot) and the tab each now lives in. */
const LEGACY_TABS: Record<string, PerfilTab> = {
  tv: 'canales',
  sports: 'futbol', football: 'futbol',
  library: 'lista', lists: 'lista', favorites: 'lista', history: 'lista',
  assistant: 'asistente', chat: 'asistente', recommendations: 'asistente',
  streaming: 'gustos',
  notifications: 'avisos',
  settings: 'cuenta', account: 'cuenta',
};
const TABS: readonly PerfilTab[] = ['overview', 'canales', 'futbol', 'lista', 'asistente', 'gustos', 'avisos', 'cuenta'];

const HINTS: Record<PerfilTab, string> = {
  overview: 'Qué echan en tus canales, lo que tienes pendiente y qué ver esta noche.',
  canales: 'Elige tus canales y mira qué echan ahora y después en cada uno.',
  futbol: 'Los partidos de tus equipos y dónde verlos, y lo que sigues.',
  lista: 'Lo que has guardado para ver, lo que ya has visto y tus listas.',
  asistente: 'Todo lo que el asistente sabe de ti y usa para recomendarte, y tus conversaciones.',
  gustos: 'Tus plataformas y lo que te gusta: con esto afinamos Para ti y el asistente.',
  avisos: 'Recordatorios de programas, notificaciones y qué quieres recibir.',
  cuenta: 'Tus datos, contraseña, privacidad y dispositivos.',
};

@Component({
  selector: 'app-user-area',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    PanelShellComponent,
    PanelNavComponent,
    PanelTileComponent,
    MyChannelsComponent,
    MyFootballComponent,
    MyLibraryComponent,
    MyAssistantComponent,
    MyTastesComponent,
    MyNoticesComponent,
    MyAccountComponent,
  ],
  templateUrl: './user-area.component.html',
  styleUrls: ['./perfil-ui.scss', './user-area.component.scss'],
})
export class UserAreaComponent {
  private readonly user = inject(UserService);
  private readonly chat = inject(ChatService);
  private readonly chatbot = inject(ChatbotService);
  private readonly catalog = inject(CatalogService);

  readonly perfilLinks = PERFIL_LINKS;
  readonly appPaths = APP_PATHS;
  readonly contextOpen = signal(false);
  readonly assistantAsks = ['¿Qué hay esta noche en mis canales?', 'Recomiéndame algo de lo que tengo pendiente', 'Avísame cuando empiece el partido'];

  readonly isAuthenticated$ = this.user.isAuthenticated$;
  readonly error$ = this.user.error$;
  readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  readonly isAdmin = computed(() => this.profile().role === 'admin');
  readonly photo = computed(() => avatarSrc(this.profile().avatar));
  readonly watchlist = toSignal(this.user.getWatchlist(), { initialValue: [] as UserListItem[] });
  readonly seenCount = toSignal(this.user.getInteractionHistory().pipe(map((items) => items.filter((i) => i.status === 'seen').length)), { initialValue: 0 });
  private readonly notifications = toSignal(this.user.getNotifications(), { initialValue: [] as UserNotification[] });
  private readonly memory = toSignal(this.chatbot.memory$, { initialValue: null });

  /** Next programme reminder the assistant set (stored as a notification). */
  readonly nextReminder = computed(() =>
    this.notifications()
      .filter((n) => n.payload?.['source'] === 'ai_reminder' && Date.parse(String(n.payload?.['startTime'] ?? '')) > Date.now())
      .sort((a, b) => Date.parse(String(a.payload?.['startTime'])) - Date.parse(String(b.payload?.['startTime'])))[0]
  );
  readonly completion = computed(() => computePersonalizationCompletion(this.profile(), this.memory()));

  readonly activeTab = toSignal(
    combineTab(inject(ActivatedRoute)),
    { initialValue: 'overview' as PerfilTab }
  );
  readonly activeLabel = computed(() => this.perfilLinks.find((l) => l.tab === this.activeTab())?.label || 'Mi perfil');
  readonly activeHint = computed(() => HINTS[this.activeTab()]);

  /** "Para ti" titles for Hoy (the /discovery/for-you endpoint /para-ti uses); empty shows the Gustos call to action. */
  readonly forYou = signal<CatalogItem[]>([]);

  constructor() {
    // Private page: never indexed. Re-set on every tab: query-only navigations reset the document title.
    const meta = inject(MetaService);
    effect(() => {
      const label = this.activeTab() === 'overview' ? 'Mi perfil' : `${this.activeLabel()} · Mi perfil`;
      meta.setMetaTags({ title: `${label} | Guía TV`, description: 'Tus canales, tu lista, tu asistente y tus preferencias en Guía TV.', canonicalUrl: APP_PATHS.profile, robots: 'noindex, nofollow' });
    });
    this.user.fetchWatchlist().subscribe();
    this.user.fetchInteractionHistory().subscribe();
    this.user.fetchNotifications().subscribe();
    this.chatbot.fetchAssistantMemory().subscribe();
    this.catalog.getForYou(6).subscribe({
      next: (recs) => this.forYou.set((recs || []).map((r) => r?.item).filter((i): i is CatalogItem => Boolean(i?.catalogId && i?.title))),
      error: () => this.forYou.set([]),
    });
  }

  firstName(): string {
    return this.profile().name.split(' ')[0] || this.profile().username;
  }

  initials(): string {
    return this.profile().name.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || 'GT';
  }

  /** Only catalogue ids (`tmdb:…`, `program:…`) have a page. */
  link(contentId?: string): string | null {
    return contentId && contentId.includes(':') ? `/contenido/${contentId}` : null;
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  retry(): void {
    this.user.loadUserAreaData().subscribe();
  }
}

function combineTab(route: ActivatedRoute) {
  return route.queryParamMap.pipe(
    map((params) => {
      const raw = String(params.get('tab') || '').trim().toLowerCase();
      const tab = (LEGACY_TABS[raw] ?? raw) as PerfilTab;
      return TABS.includes(tab) ? tab : 'overview';
    })
  );
}
