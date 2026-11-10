import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * What a visitor without a session sees in the assistant: what it can do for them and how to start.
 * Same look as the rest of the app (section colour, portal tokens in light and dark).
 */
@Component({
  selector: 'app-chat-welcome-screen',
  standalone: true,
  template: `
    <div class="welcome">
      <span class="welcome__mark" aria-hidden="true">✦</span>
      <p class="welcome__title">Tu asistente de TV</p>
      <p class="welcome__lead">Dile qué te apetece y te dice qué echan, dónde verlo y cuándo empieza.</p>

      <ul class="welcome__caps">
        @for (cap of capabilities; track cap.title) {
        <li><span aria-hidden="true">{{ cap.icon }}</span><span><strong>{{ cap.title }}</strong><small>{{ cap.detail }}</small></span></li>
        }
      </ul>

      @if (previewSuggestions.length) {
      <p class="welcome__try">Prueba a preguntar</p>
      <div class="welcome__chips">
        @for (suggestion of previewSuggestions; track suggestion) {
        <button type="button" (click)="login.emit()">{{ suggestion }}</button>
        }
      </div>
      }

      <div class="welcome__actions">
        <button type="button" class="welcome__primary" (click)="register.emit()">Crear cuenta gratis</button>
        <button type="button" class="welcome__secondary" (click)="login.emit()">Iniciar sesión</button>
      </div>
      <p class="welcome__note">La cuenta guarda tus plataformas y gustos para recomendarte mejor.</p>
    </div>
  `,
  styles: [`
    :host { display: flex; width: 100%; min-width: 0; height: 100%; overflow-y: auto; }
    .welcome { display: flex; flex-direction: column; align-items: center; gap: .75rem; width: 100%; margin: auto; padding: 1.5rem 1.25rem; text-align: center; color: var(--portal-text); }
    .welcome__mark { display: grid; place-items: center; width: 3.25rem; height: 3.25rem; border-radius: 50%; background: var(--section-accent); color: var(--section-accent-ink); font-size: 1.5rem; box-shadow: 0 0 0 6px color-mix(in srgb, var(--section-accent) 22%, transparent); }
    .welcome__title { margin: .25rem 0 0; font-size: var(--text-lg); font-weight: 800; }
    .welcome__lead { margin: 0; max-width: 26rem; color: var(--portal-text-muted); font-size: var(--text-sm); }
    .welcome__caps { display: grid; gap: .4rem; width: 100%; max-width: 24rem; margin: .5rem 0 0; padding: 0; list-style: none; text-align: left; }
    .welcome__caps li { display: flex; align-items: center; gap: .7rem; padding: .6rem .75rem; border-radius: .9rem; border: 1px solid var(--portal-border); background: var(--portal-surface-strong); }
    .welcome__caps li > span:first-child { display: grid; place-items: center; width: 2rem; height: 2rem; flex: none; border-radius: .6rem; background: color-mix(in srgb, var(--section-accent) 18%, transparent); font-size: 1rem; }
    .welcome__caps strong { display: block; font-size: var(--text-sm); }
    .welcome__caps small { display: block; color: var(--portal-text-muted); font-size: var(--text-xs); }
    .welcome__try { margin: .5rem 0 0; color: var(--portal-text-muted); font-size: var(--text-2xs); font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .welcome__chips { display: flex; flex-wrap: wrap; justify-content: center; gap: .4rem; max-width: 24rem; }
    .welcome__chips button { min-height: 34px; padding: 0 .85rem; border: 1px solid var(--portal-border-strong); border-radius: 999px; background: transparent; color: var(--portal-text); font: inherit; font-size: var(--text-xs); font-weight: 600; cursor: pointer; }
    .welcome__chips button:hover { border-color: var(--section-accent-text); }
    .welcome__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem; margin-top: .5rem; }
    .welcome__actions button { min-height: 44px; padding: 0 1.25rem; border-radius: 999px; font: inherit; font-size: var(--text-sm); font-weight: 800; cursor: pointer; }
    .welcome__primary { border: 0; background: var(--section-accent); color: var(--section-accent-ink); }
    .welcome__secondary { border: 1px solid var(--portal-border-strong); background: transparent; color: var(--portal-text); }
    .welcome__note { margin: 0; color: var(--portal-text-muted); font-size: var(--text-xs); }
    button:focus-visible { outline: 2px solid var(--portal-text); outline-offset: 2px; }
  `],
})
export class ChatWelcomeScreenComponent {
  @Input() previewSuggestions: string[] = [];
  @Output() login = new EventEmitter<void>();
  @Output() register = new EventEmitter<void>();

  readonly capabilities = [
    { icon: '📺', title: 'Qué echan ahora y esta noche', detail: 'En todos los canales de TDT, autonómicos y de pago' },
    { icon: '🎬', title: 'Películas y series para ti', detail: 'En tus plataformas o gratis en la tele' },
    { icon: '⚽', title: 'Partidos y dónde verlos', detail: 'Hora, competición y canal de cada partido' },
    { icon: '🔔', title: 'Avisos de tus programas', detail: 'Te recuerda cuándo empieza lo que quieres ver' },
  ];
}
