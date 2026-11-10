import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiConfigService } from '../../../../api/api-config.service';
import { TvApiService } from '../../../../api/tv-api.service';
import { TvReadChannelSummaryDTO } from '../../../../api/models';
import { channelCanonicalPath } from '../../../../config/route-map';
import { UserService } from '../../../../services/user.service';
import { normalizePublicImageUrl } from '../../../../utils/media-url';
import { filterChannelDirectory } from '../../../channel-catalog/channel-catalog.component';

type Group = 'all' | 'tdt' | 'autonomico' | 'pay';

/**
 * Favourite channels of the profile: what is on now and next in each one (`glance`), and the picker to add or
 * remove channels from today's directory (`manage`). Nothing else in the app writes `favoriteChannelIds`.
 */
@Component({
  selector: 'app-my-channels',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './my-channels.component.scss',
  template: `
    @if (!loaded()) {
    <div class="mc-skel" aria-busy="true"><div></div><div></div><div></div></div>
    } @else {
    @if (!favorites().length) {
    <div class="mc-empty">
      <strong>Aún no has elegido canales</strong>
      <span>Elige tus canales y aquí verás qué echan ahora y después en cada uno.</span>
      @if (mode() === 'glance') {<a class="mc-btn mc-btn--pri" [routerLink]="'/perfil'" [queryParams]="{ tab: 'canales' }">Elegir mis canales</a>}
    </div>
    } @else {
    <div class="mc-grid">
      @for (e of favorites().slice(0, mode() === 'glance' ? 6 : 99); track e.channel.id) {
      <article class="mc-card">
        <a class="mc-head" [routerLink]="path(e)">
          <span class="mc-logo">@if (logo(e); as src) {<img [src]="src" alt="" loading="lazy" />} @else { {{ e.channel.name.charAt(0) }} }</span>
          <strong>{{ e.channel.name }}</strong>
        </a>
        @if (e.current) {<p><span class="mc-pill">Ahora</span>{{ e.current.program.title }}</p>}
        @if (e.next) {<p class="mc-next"><span>Después</span>{{ e.next.program.title }}</p>}
        @if (!e.current && !e.next) {<p class="mc-next">Sin programación disponible.</p>}
        @if (mode() === 'manage') {<button type="button" class="mc-link" (click)="toggle(e.channel.id)">Quitar de mis canales</button>}
      </article>
      }
    </div>
    }

    @if (mode() === 'manage') {
    <section class="mc-picker" aria-labelledby="mc-pick">
      <h2 id="mc-pick">Añadir canales</h2>
      <div class="mc-tools">
        <input type="search" class="mc-search" placeholder="Buscar canal (La 1, Antena 3, Movistar…)" aria-label="Buscar canal" [value]="query()" (input)="query.set($any($event.target).value)" />
        <div class="mc-chips" role="group" aria-label="Tipo de canal">
          @for (g of groups; track g.key) {<button type="button" [class.on]="group() === g.key" (click)="group.set(g.key)">{{ g.label }}</button>}
        </div>
      </div>
      <div class="mc-pick-grid">
        @for (e of candidates().slice(0, shown()); track e.channel.id) {
        <button type="button" class="mc-pick-item" [class.on]="isFav(e.channel.id)" [attr.aria-pressed]="isFav(e.channel.id)" (click)="toggle(e.channel.id)">
          <span class="mc-logo mc-logo--sm">@if (logo(e); as src) {<img [src]="src" alt="" loading="lazy" />} @else { {{ e.channel.name.charAt(0) }} }</span>
          <span class="mc-pick-name">{{ e.channel.name }}</span>
          <span class="mc-pick-mark" aria-hidden="true">{{ isFav(e.channel.id) ? '✓' : '+' }}</span>
        </button>
        } @empty {<p class="mc-muted">Ningún canal coincide con la búsqueda.</p>}
      </div>
      @if (candidates().length > shown()) {<button type="button" class="mc-btn" (click)="shown.set(shown() + 48)">Ver más canales</button>}
    </section>
    }
    }
  `,
})
export class MyChannelsComponent {
  readonly mode = input<'glance' | 'manage'>('glance');

  private readonly user = inject(UserService);
  private readonly api = inject(TvApiService);
  private readonly assets = inject(ApiConfigService);

  readonly groups: Array<{ key: Group; label: string }> = [
    { key: 'all', label: 'Todos' },
    { key: 'tdt', label: 'TDT' },
    { key: 'autonomico', label: 'Autonómicos' },
    { key: 'pay', label: 'De pago' },
  ];
  readonly query = signal('');
  readonly group = signal<Group>('all');
  readonly shown = signal(48);

  private readonly profile = toSignal(this.user.getProfile());
  private readonly directory = toSignal(
    this.api.getTvReadChannels('today').pipe(
      map((r) => filterChannelDirectory(r?.data?.channels || [], '', 'all')),
      catchError(() => of([] as TvReadChannelSummaryDTO[]))
    ),
    { initialValue: null }
  );

  readonly loaded = computed(() => this.directory() !== null);
  private readonly ids = computed(() => this.profile()?.tvPreferences?.favoriteChannelIds || []);
  readonly favorites = computed(() => {
    const byId = new Map((this.directory() || []).map((e) => [e.channel.id, e]));
    return this.ids().flatMap((id) => byId.get(id) ?? []);
  });
  readonly candidates = computed(() => {
    const q = this.query().trim().toLowerCase();
    const g = this.group();
    return filterChannelDirectory(this.directory() || [], q, 'all').filter((e) =>
      g === 'all' ? true : g === 'pay' ? e.channel.access === 'pay' : e.channel.group === g
    );
  });

  isFav(id: string): boolean {
    return this.ids().includes(id);
  }

  toggle(id: string): void {
    const tv = this.profile()?.tvPreferences;
    if (!tv) return;
    const favoriteChannelIds = this.isFav(id) ? tv.favoriteChannelIds.filter((x) => x !== id) : [...tv.favoriteChannelIds, id];
    this.user.updateTvPreferences({ ...tv, favoriteChannelIds }).subscribe();
  }

  path(e: TvReadChannelSummaryDTO): string {
    return channelCanonicalPath(e.channel, e.channel.id);
  }

  logo(e: TvReadChannelSummaryDTO): string | undefined {
    return e.channel.icon ? normalizePublicImageUrl(e.channel.icon, this.assets.getAssetBaseUrl()) : undefined;
  }
}
