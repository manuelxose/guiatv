import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FooterComponent } from '../footer/footer.component';
import { UnifiedTopNavComponent } from '../unified-top-nav/unified-top-nav.component';

/**
 * Frame for login and registration: the site header, one centred card with the form
 * (projected) and a panel with what the account unlocks, then the footer.
 * Form styles live in ./_auth-form.scss, shared by both pages.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [UnifiedTopNavComponent, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-shell">
      <div class="auth-top"><app-unified-top-nav [fixed]="false" [showAssistant]="false" /></div>
      <main class="auth">
        <section class="auth__card" [attr.aria-labelledby]="'auth-title'">
          <span class="auth__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><rect class="logo-bg" width="32" height="32" rx="10"></rect><rect class="logo-screen" x="5" y="8" width="22" height="13" rx="3"></rect><path class="logo-play" d="M14 12v6.5c0 .5.55.8.96.53l5.4-3.25a.62.62 0 0 0 0-1.06l-5.4-3.25A.62.62 0 0 0 14 12Z"></path></svg>
          </span>
          <h1 id="auth-title">{{ heading() }}</h1>
          <p class="auth__lead">{{ lead() }}</p>
          <ng-content></ng-content>
        </section>

        <aside class="auth__perks" aria-label="Qué incluye tu cuenta">
          <p class="auth__perks-title">Con tu cuenta, el asistente trabaja para ti</p>
          <ul>
            @for (perk of perks; track perk.title) {
            <li><span aria-hidden="true">{{ perk.icon }}</span><span><strong>{{ perk.title }}</strong><small>{{ perk.detail }}</small></span></li>
            }
          </ul>
          <p class="auth__perks-note">Gratis. Sin publicidad invasiva. Puedes borrar tu cuenta cuando quieras.</p>
        </aside>
      </main>
      <app-footer />
    </div>
  `,
  styleUrl: './auth-layout.component.scss',
})
export class AuthLayoutComponent {
  readonly heading = input.required<string>();
  readonly lead = input('');

  readonly perks = [
    { icon: '✦', title: 'Recomendaciones del asistente', detail: 'Según tus plataformas, gustos y la programación real' },
    { icon: '🔔', title: 'Avisos', detail: 'Te recuerda cuándo empieza un programa o un partido' },
    { icon: '☆', title: 'Mi lista y Mi fútbol', detail: 'Guarda títulos, equipos y competiciones en todos tus dispositivos' },
    { icon: '💬', title: 'Comunidad', detail: 'Reseñas, listas compartidas y qué ven tus amigos' },
  ];
}
