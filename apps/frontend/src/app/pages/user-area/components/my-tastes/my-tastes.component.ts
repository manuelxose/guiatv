import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { PREFERENCE_QUESTIONS, PreferenceOption } from '../../../../interfaces/chat-profile.types';
import { UserService } from '../../../../services/user.service';
import { resolvePlatformLogoUrl } from '../../../../utils/platform-logos';
import { GENRE_OPTIONS } from '../../../../utils/taste-profile';

const options = (key: string): PreferenceOption[] => PREFERENCE_QUESTIONS.find((q) => q.key === key)?.options ?? [];

/**
 * Gustos: the platforms the user has and the genres they like. These two profile fields drive Para ti,
 * Qué ver's personal order and the assistant, so they save on every tap.
 */
@Component({
  selector: 'app-my-tastes',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../perfil-ui.scss',
  template: `
    <section class="pf-sec" aria-labelledby="gu-plat">
      <div class="pf-head">
        <h2 id="gu-plat">Tus plataformas</h2>
        <a routerLink="/plataformas">Comparar plataformas ›</a>
        <p>Marca las que tienes: solo te recomendaremos lo que puedes ver de verdad, y te avisaremos si algo está gratis en otra.</p>
      </div>
      <div class="pf-card">
        <div class="pf-chips">
          @for (o of platforms; track o.value) {<button type="button" class="pf-chip" [attr.aria-pressed]="profile().preferredPlatforms.includes(o.value)" [disabled]="saving()" (click)="toggle('platforms', o.value)">@if (logo(o.value); as src) {<img [src]="src" alt="" width="22" height="22" />}{{ o.label }}</button>}
        </div>
        @if (!profile().preferredPlatforms.length) {<p class="pf-muted">Sin plataformas marcadas te mostramos sobre todo TV en abierto.</p>}
      </div>
    </section>

    <section class="pf-sec" aria-labelledby="gu-gen">
      <div class="pf-head">
        <h2 id="gu-gen">Lo que te gusta ver</h2>
        <a routerLink="/para-ti">Ver Para ti ›</a>
        <p>Elige varios. Para lo que no quieres ver, usa los filtros del asistente.</p>
      </div>
      <div class="pf-card">
        <div class="pf-chips">
          @for (g of genres; track g.value) {<button type="button" class="pf-chip" [attr.aria-pressed]="profile().favoriteGenres.includes(g.value)" [disabled]="saving()" (click)="toggle('genres', g.value)">{{ g.label }}</button>}
        </div>
      </div>
    </section>

    @if (note()) {<p class="pf-note" [class.pf-note--err]="failed()" role="status">{{ note() }}</p>}
  `,
})
export class MyTastesComponent {
  private readonly user = inject(UserService);

  readonly platforms = options('preferredPlatforms');
  readonly genres = GENRE_OPTIONS;
  readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  readonly saving = signal(false);
  readonly note = signal('');
  readonly failed = signal(false);

  logo(name: string): string {
    return resolvePlatformLogoUrl(name);
  }

  toggle(kind: 'platforms' | 'genres', value: string): void {
    const p = this.profile();
    const flip = (list: string[]) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    const genres = kind === 'genres' ? flip(p.favoriteGenres) : p.favoriteGenres;
    const platforms = kind === 'platforms' ? flip(p.preferredPlatforms) : p.preferredPlatforms;
    this.saving.set(true);
    this.user.saveGenrePreferences(genres, platforms).subscribe((ok) => {
      this.saving.set(false);
      this.failed.set(!ok);
      this.note.set(ok ? 'Guardado. Tus recomendaciones ya lo tienen en cuenta.' : 'No se pudo guardar. Inténtalo de nuevo.');
    });
  }
}
