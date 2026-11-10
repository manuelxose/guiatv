import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserListItem } from '../../../interfaces/user.interface';
import { ChatbotService } from '../../../services/chatbot.service';
import { UserService } from '../../../services/user.service';
import { smartPrompts } from '../../../utils/taste-profile';

interface Shortcut { icon: string; title: string; hint: string; prompt: string }

/** Start of an empty conversation: a greeting, four big shortcuts and questions built from the user's profile. */
@Component({
  selector: 'app-chat-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="home" aria-labelledby="home-title">
      <span class="home__mark" aria-hidden="true">✦</span>
      <h2 id="home-title">{{ greeting() }}</h2>
      <p>¿Qué te apetece ver? Conozco la programación de hoy, tus plataformas y tus gustos.</p>

      <div class="home__grid">
        @for (s of shortcuts(); track s.title) {
        <button type="button" class="home__card" (click)="ask.emit(s.prompt)">
          <span class="home__icon" aria-hidden="true">{{ s.icon }}</span>
          <strong>{{ s.title }}</strong>
          <small>{{ s.hint }}</small>
        </button>
        }
      </div>

      @if (personal().length) {
      <h3>Para ti</h3>
      <div class="home__asks">
        @for (p of personal(); track p) {<button type="button" (click)="ask.emit(p)">{{ p }}</button>}
      </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .home { display: grid; gap: 10px; padding: 8px 4px 4px; }
    .home__mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: var(--section-accent); color: var(--section-accent-ink); font-size: 1.25rem; font-weight: 800; }
    h2 { margin: 6px 0 0; color: var(--sv2-text); font-size: 1.375rem; line-height: 1.2; }
    p { margin: 0 0 6px; color: var(--sv2-text-muted); font-size: var(--sv2-fs-sm); line-height: 1.5; }
    h3 { margin: 8px 0 0; color: var(--sv2-text-faint); font-size: var(--sv2-fs-xs); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .home__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .home__card { display: grid; align-content: start; gap: 4px; min-height: 92px; padding: 12px; border: 1px solid var(--sv2-border); border-radius: 14px; background: var(--sv2-bg); color: var(--sv2-text); text-align: left; cursor: pointer; transition: border-color var(--sv2-dur) var(--sv2-ease), transform var(--sv2-dur) var(--sv2-ease); }
    .home__card:hover { border-color: var(--section-accent); transform: translateY(-1px); }
    .home__card:focus-visible, .home__asks button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
    .home__icon { font-size: 1.15rem; line-height: 1; }
    .home__card strong { font-size: var(--sv2-fs-sm); }
    .home__card small { color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); line-height: 1.35; }
    .home__asks { display: grid; gap: 6px; }
    .home__asks button { padding: 10px 12px; border: 1px solid var(--sv2-border-strong); border-radius: 12px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); text-align: left; cursor: pointer; }
    .home__asks button::before { content: '↗ '; color: var(--section-accent-text); font-weight: 800; }
    .home__asks button:hover { border-color: var(--section-accent); background: var(--sv2-surface-2); }
    @media (prefers-reduced-motion: reduce) { .home__card { transition: none; } }
  `],
})
export class ChatHomeComponent {
  readonly ask = output<string>();

  private readonly user = inject(UserService);
  private readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  private readonly memory = toSignal(inject(ChatbotService).memory$, { initialValue: null });
  private readonly watchlist = toSignal(this.user.getWatchlist(), { initialValue: [] as UserListItem[] });

  readonly greeting = computed(() => {
    const h = new Date().getHours();
    const hello = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    const name = this.profile().name?.split(' ')[0];
    return name && this.profile().id ? `${hello}, ${name}` : hello;
  });

  readonly shortcuts = computed<Shortcut[]>(() => {
    const platforms = this.profile().preferredPlatforms;
    return [
      { icon: '🌙', title: 'Esta noche', hint: 'Lo mejor de la tele para ti', prompt: '¿Qué echan esta noche en la tele que me pueda gustar?' },
      { icon: '📺', title: 'Ahora en TV', hint: 'Qué están emitiendo ya', prompt: '¿Qué hay ahora mismo en la tele?' },
      { icon: '▶', title: platforms.length ? `En ${platforms[0]}` : 'Streaming', hint: platforms.length > 1 ? `y tus ${platforms.length - 1} plataformas más` : 'Películas y series', prompt: platforms.length ? `Recomiéndame algo para ver hoy en ${platforms.slice(0, 3).join(', ')}` : 'Recomiéndame una película o serie en streaming' },
      { icon: '⚽', title: 'Fútbol hoy', hint: 'Partidos y dónde verlos', prompt: '¿Qué partidos de fútbol dan hoy y en qué canal?' },
    ];
  });

  /** Profile-based questions, minus the generic ones the shortcuts already cover. */
  readonly personal = computed(() =>
    smartPrompts(this.profile().preferredPlatforms, this.memory(), this.watchlist().map((w) => w.title))
      .filter((p) => !p.startsWith('¿Qué partidos') && !p.startsWith('Estrenos'))
      .slice(0, 3)
  );
}
