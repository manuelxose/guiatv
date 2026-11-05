import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConsentService } from '../../services/analytics/consent.service';

/**
 * Cookie/analytics consent banner.
 *
 * Paint timing matters (it is the largest text block on a phone): it is part of the SSR HTML so it paints with the
 * first contentful paint instead of becoming a late LCP after hydration (measured: +1.4 s mobile LCP when it was
 * rendered post-hydration). The SSR HTML is identical for every visitor (nginx caches it per URL): visitors who
 * already chose are hidden before first paint by the inline `<head>` script in index.html (`data-consent-known`),
 * and the server and the hydrating client render the same DOM (the real state applies after the first render), so
 * hydration never mismatches. position: fixed (no CLS); "Rechazar" is as prominent as "Aceptar". Reopened from the
 * footer and the cookies page via `ConsentService.openPreferences()`.
 */
@Component({
  selector: 'app-consent-banner',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="consent" [class.consent--live]="hydrated()" role="region" aria-labelledby="consent-title" tabindex="-1">
        <h2 id="consent-title" class="consent__title">Tu privacidad</h2>
        <p class="consent__text">
          Usamos cookies técnicas necesarias para que la web funcione. Con tu permiso, también usamos cookies de
          análisis (propias y de Google Analytics) para medir de forma agregada qué páginas se visitan y mejorar la guía.
          No usamos cookies publicitarias. Puedes cambiar tu elección cuando quieras desde «Configurar cookies».
          <a routerLink="/cookies" class="consent__link">Política de cookies</a>
        </p>
        @if (hydrated() && consent.analytics() !== 'unset') {
          <p class="consent__state" aria-live="polite">Estado actual de las cookies de análisis: <strong>{{ consent.analytics() === 'granted' ? 'aceptadas' : 'rechazadas' }}</strong>.</p>
        }
        <div class="consent__actions">
          <button type="button" class="consent__btn" data-consent="deny" (click)="consent.deny()">Rechazar análisis</button>
          <button type="button" class="consent__btn" data-consent="grant" (click)="consent.grant()">Aceptar análisis</button>
          @if (hydrated() && consent.preferencesOpen()) {
            <button type="button" class="consent__btn consent__btn--ghost" (click)="consent.closePreferences()">Cerrar</button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .consent { position: fixed; z-index: 1000; left: 16px; right: 16px; bottom: 16px; max-width: 640px; margin: 0 auto;
      padding: 16px 18px; border-radius: 14px; border: 1px solid var(--portal-border-strong, #ccc);
      background: var(--portal-bg-elevated, #fff); color: var(--portal-text, #121212);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .18); font-size: 14px; line-height: 1.45; }
    .consent:focus { outline: none; }
    /* Before hydration the SSR copy is hidden for visitors who already chose (set by the index.html head script). */
    :host-context(html[data-consent-known]) .consent:not(.consent--live) { display: none; }
    .consent__title { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
    .consent__text, .consent__state { margin: 0 0 12px; color: var(--portal-text-soft, #3a3a3a); }
    .consent__link { color: inherit; text-decoration: underline; margin-left: 4px; }
    .consent__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .consent__btn { flex: 1 1 160px; min-height: 44px; padding: 10px 14px; border-radius: 10px; font: inherit; font-weight: 600;
      cursor: pointer; border: 1px solid var(--portal-text, #121212); background: var(--portal-text, #121212); color: var(--portal-bg-elevated, #fff); }
    .consent__btn--ghost { background: transparent; color: var(--portal-text, #121212); border-color: var(--portal-border-strong, #ccc); }
    .consent__btn:focus-visible { outline: 3px solid var(--guide-accent, #1db954); outline-offset: 2px; }
  `],
})
export class ConsentBannerComponent {
  readonly consent = inject(ConsentService);
  readonly hydrated = signal(false);
  /** Never shown on its own: first-party counting needs no consent. Only opened from "Configurar cookies" (optional GA4). */
  readonly visible = computed(() => this.hydrated() && this.consent.preferencesOpen());

  constructor() {
    afterNextRender(() => this.hydrated.set(true));
  }
}
