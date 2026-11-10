import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { UserContentInteraction, UserList, UserListItem } from '../../../../interfaces/user.interface';
import { UserService } from '../../../../services/user.service';

type View = 'guardado' | 'vistos' | 'favoritos' | 'listas';

/**
 * Mi lista: what the user saved to watch (the default list the site's "Guardar" buttons fill), what they watched
 * and rated, their favourite channels/programmes and their own lists. Views are links (`?vista=`).
 */
@Component({
  selector: 'app-my-library',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../perfil-ui.scss', './my-library.component.scss'],
  template: `
    <nav class="pf-tabs" aria-label="Mi lista">
      @for (v of views; track v.key) {
      <a class="pf-chip" [routerLink]="'/perfil'" [queryParams]="{ tab: 'lista', vista: v.key === 'guardado' ? null : v.key }" [attr.aria-current]="view() === v.key ? 'page' : null">{{ v.label }} · {{ v.count() }}</a>
      }
    </nav>

    @switch (view()) {
    @case ('guardado') {
    <section class="pf-sec" aria-labelledby="ml-saved">
      <div class="pf-head">
        <h2 id="ml-saved">Para ver</h2>
        <a routerLink="/programacion-tv/que-ver-hoy">Buscar qué ver ›</a>
        <p>Lo que has guardado con el botón «Guardar» de cada película, serie o programa.</p>
      </div>
      @if (watchlist().length) {
      <ul class="pf-rows">
        @for (item of watchlist(); track item.id) {
        <li class="pf-row">
          @if (item.poster) {<img class="pf-thumb" [src]="item.poster" alt="" loading="lazy" />} @else {<span class="pf-thumb"></span>}
          <span class="pf-row__main">
            @if (link(item.contentId); as href) {<a [routerLink]="href"><strong>{{ item.title }}</strong></a>} @else {<strong>{{ item.title }}</strong>}
            <span class="pf-small">{{ typeLabel(item.type) }} · {{ stateLabel(item.state) }}</span>
          </span>
          <span class="pf-actions">
            <button type="button" class="pf-btn pf-btn--sm" (click)="markSeen(item)">Ya la vi</button>
            <button type="button" class="pf-btn pf-btn--sm" (click)="unsave(item)" [attr.aria-label]="'Quitar ' + item.title">Quitar</button>
          </span>
        </li>
        }
      </ul>
      } @else {
      <div class="pf-empty"><strong>No tienes nada guardado</strong><span>Pulsa «Guardar» en cualquier película, serie o programa y aparecerá aquí para verlo más tarde.</span><a class="pf-btn pf-btn--pri" routerLink="/programacion-tv/que-ver-hoy">Ver qué echan hoy</a></div>
      }
    </section>
    }

    @case ('vistos') {
    <section class="pf-sec" aria-labelledby="ml-seen">
      <div class="pf-head">
        <h2 id="ml-seen">Vistos y valorados</h2>
        <p>Valora lo que has visto: el asistente y «Para ti» lo usan para acertar más.</p>
      </div>
      @if (history().length) {
      <ul class="pf-rows">
        @for (item of history(); track item.id) {
        <li class="pf-row">
          <span class="pf-row__main">
            @if (link(item.contentId); as href) {<a [routerLink]="href"><strong>{{ item.contentTitle }}</strong></a>} @else {<strong>{{ item.contentTitle }}</strong>}
            <span class="pf-small">{{ typeLabel(item.contentType) }}@if (item.platform) { · {{ item.platform }}} · {{ statusLabel(item.status) }}</span>
          </span>
          <span class="pf-stars" role="group" [attr.aria-label]="'Valorar ' + item.contentTitle">
            @for (n of [1, 2, 3, 4, 5]; track n) {
            <button type="button" [class.on]="(item.rating || 0) >= n" [attr.aria-label]="n + ' estrellas'" [attr.aria-pressed]="item.rating === n" (click)="rate(item, n)">★</button>
            }
          </span>
        </li>
        }
      </ul>
      } @else {
      <div class="pf-empty"><strong>Aún no has marcado nada como visto</strong><span>Usa «Visto» o las estrellas en la ficha de cualquier título.</span></div>
      }
    </section>
    }

    @case ('favoritos') {
    <section class="pf-sec" aria-labelledby="ml-fav">
      <div class="pf-head"><h2 id="ml-fav">Favoritos</h2></div>
      @if (favorites().length) {
      <ul class="pf-rows">
        @for (f of favorites(); track f.id) {
        <li class="pf-row">
          @if (f.image) {<img class="pf-thumb" [src]="f.image" alt="" loading="lazy" />}
          <span class="pf-row__main"><strong>{{ f.title }}</strong>@if (f.subtitle) {<span class="pf-small">{{ f.subtitle }}</span>}</span>
          <button type="button" class="pf-btn pf-btn--sm" (click)="removeFavorite(f.id)" [attr.aria-label]="'Quitar ' + f.title">Quitar</button>
        </li>
        }
      </ul>
      } @else {
      <div class="pf-empty"><strong>Sin favoritos</strong><span>Marca con el corazón los programas que no te quieres perder.</span></div>
      }
    </section>
    }

    @case ('listas') {
    <section class="pf-sec" aria-labelledby="ml-lists">
      <div class="pf-head">
        <h2 id="ml-lists">Mis listas</h2>
        @if (!creating()) {<button type="button" class="pf-link" (click)="creating.set(true)">+ Nueva lista</button>}
        <p>Agrupa títulos a tu manera: «Para el finde», «Con los niños», «Pendientes de Netflix»…</p>
      </div>

      @if (creating()) {
      <form class="pf-card ml-form" (submit)="$event.preventDefault(); createList(nTitle.value, nDesc.value, nVis.value)">
        <h3>Nueva lista</h3>
        <label class="pf-field">Nombre<input #nTitle class="pf-input" maxlength="80" required placeholder="Ej.: Para el finde" /></label>
        <label class="pf-field">Descripción <small>(opcional)</small><input #nDesc class="pf-input" maxlength="200" placeholder="De qué va esta lista" /></label>
        <label class="pf-field">Quién la ve
          <select #nVis class="pf-input pf-select"><option value="private">Solo yo</option><option value="public">Cualquiera (en tu perfil público)</option></select>
        </label>
        <div class="pf-actions"><button type="submit" class="pf-btn pf-btn--pri">Crear lista</button><button type="button" class="pf-btn" (click)="creating.set(false)">Cancelar</button></div>
      </form>
      }

      @for (list of lists(); track list.id) {
      <div class="pf-card">
        @if (editingId() === list.id) {
        <form class="ml-form" (submit)="$event.preventDefault(); saveList(list, eTitle.value, eDesc.value, eVis.value)">
          <label class="pf-field">Nombre<input #eTitle class="pf-input" maxlength="80" required [value]="list.title" /></label>
          <label class="pf-field">Descripción<input #eDesc class="pf-input" maxlength="200" [value]="list.description || ''" /></label>
          <label class="pf-field">Quién la ve
            <select #eVis class="pf-input pf-select" [value]="list.visibility === 'public' ? 'public' : 'private'"><option value="private">Solo yo</option><option value="public">Cualquiera (en tu perfil público)</option></select>
          </label>
          <div class="pf-actions">
            <button type="submit" class="pf-btn pf-btn--pri">Guardar</button>
            <button type="button" class="pf-btn" (click)="editingId.set(null)">Cancelar</button>
            <button type="button" class="pf-btn pf-btn--danger ml-del" (click)="deleteList(list)">Borrar lista</button>
          </div>
        </form>
        } @else {
        <div class="ml-list">
          <div class="ml-list__text">
            <h3>{{ list.title }}</h3>
            <span class="pf-small">{{ list.itemsCount }} {{ list.itemsCount === 1 ? 'título' : 'títulos' }} · {{ list.visibility === 'public' ? 'Pública' : 'Privada' }}</span>
            @if (list.description) {<p class="pf-muted">{{ list.description }}</p>}
          </div>
          <span class="pf-actions">
            <button type="button" class="pf-btn pf-btn--sm" (click)="toggleOpen(list)" [attr.aria-expanded]="openId() === list.id">{{ openId() === list.id ? 'Cerrar' : 'Ver títulos' }}</button>
            <button type="button" class="pf-btn pf-btn--sm" (click)="editingId.set(list.id)">Editar</button>
          </span>
        </div>
        }
        @if (openId() === list.id && editingId() !== list.id) {
          @if (openItems().length) {
          <ul class="pf-rows">
            @for (item of openItems(); track item.id) {
            <li class="pf-row">
              <span class="pf-row__main">@if (link(item.contentId); as href) {<a [routerLink]="href">{{ item.title }}</a>} @else { {{ item.title }} }</span>
              <button type="button" class="pf-btn pf-btn--sm" (click)="removeFromList(list, item)">Quitar</button>
            </li>
            }
          </ul>
          } @else {<p class="pf-muted">Lista vacía. Añade títulos desde su ficha con «Guardar en lista».</p>}
        }
      </div>
      } @empty {
      @if (!creating()) {<div class="pf-empty"><strong>Todavía no tienes listas</strong><span>Crea la primera y agrupa títulos como quieras.</span><button type="button" class="pf-btn pf-btn--pri" (click)="creating.set(true)">Crear una lista</button></div>}
      }
      @if (note()) {<p class="pf-note" [class.pf-note--err]="noteError()" role="status">{{ note() }}</p>}
    </section>
    }
    }
  `,
})
export class MyLibraryComponent {
  private readonly user = inject(UserService);

  readonly view = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((p) => {
      const v = p.get('vista') as View;
      return (['vistos', 'favoritos', 'listas'] as View[]).includes(v) ? v : 'guardado';
    })),
    { initialValue: 'guardado' as View }
  );

  readonly watchlist = toSignal(this.user.getWatchlist(), { initialValue: [] as UserListItem[] });
  readonly history = toSignal(this.user.getInteractionHistory().pipe(map((items) => items.filter((i) => i.status !== 'pending'))), { initialValue: [] as UserContentInteraction[] });
  readonly favorites = toSignal(this.user.getFavorites(), { initialValue: [] });
  readonly lists = toSignal(this.user.getLists().pipe(map((lists) => lists.filter((l) => !l.isDefault))), { initialValue: [] as UserList[] });

  readonly views: Array<{ key: View; label: string; count: () => number }> = [
    { key: 'guardado', label: 'Para ver', count: () => this.watchlist().length },
    { key: 'vistos', label: 'Vistos', count: () => this.history().length },
    { key: 'favoritos', label: 'Favoritos', count: () => this.favorites().length },
    { key: 'listas', label: 'Mis listas', count: () => this.lists().length },
  ];

  readonly openId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly creating = signal(false);
  readonly note = signal('');
  readonly noteError = signal(false);
  readonly openItems = signal<UserListItem[]>([]);

  constructor() {
    this.user.fetchWatchlist().subscribe();
    this.user.fetchLists().subscribe();
    this.user.fetchFavorites().subscribe();
    this.user.fetchInteractionHistory().subscribe();
  }

  /** Only catalogue ids (`tmdb:…`, `program:…`) have a page; anything else stays plain text. */
  link(contentId?: string): string | null {
    return contentId && contentId.includes(':') ? `/contenido/${contentId}` : null;
  }

  typeLabel(type: string): string {
    return ({ movie: 'Película', series: 'Serie', program: 'Programa' } as Record<string, string>)[type] || 'Título';
  }

  stateLabel(state: UserListItem['state']): string {
    return ({ pending: 'Pendiente', watching: 'Viendo', finished: 'Terminado' } as const)[state] || 'Pendiente';
  }

  statusLabel(status: UserContentInteraction['status']): string {
    return ({ seen: 'Visto', watching: 'Viendo', pending: 'Pendiente', dropped: 'Abandonado' } as const)[status];
  }

  markSeen(item: UserListItem): void {
    if (!item.contentId) return;
    this.user.addContentInteraction({ contentId: item.contentId, contentTitle: item.title, contentType: item.type, status: 'seen' }).subscribe();
    this.unsave(item);
  }

  unsave(item: UserListItem): void {
    if (item.contentId) this.user.toggleWatchlistItem({ contentId: item.contentId, title: item.title, type: item.type }).subscribe();
  }

  rate(item: UserContentInteraction, stars: number): void {
    this.user.addContentInteraction({
      contentId: item.contentId,
      contentTitle: item.contentTitle,
      contentType: item.contentType,
      rating: stars,
      status: item.status === 'pending' ? 'seen' : item.status,
    }).subscribe(() => this.user.fetchInteractionHistory().subscribe());
  }

  removeFavorite(id: string): void {
    this.user.removeFavorite(id).subscribe();
  }

  createList(title: string, description: string, visibility: string): void {
    const clean = title.trim();
    if (!clean) return;
    this.user.createList({ title: clean, description: description.trim(), visibility: visibility === 'public' ? 'public' : 'private' }).subscribe((list) => {
      this.flash(list ? `Lista «${clean}» creada.` : 'No se pudo crear la lista.', !list);
      if (list) this.creating.set(false);
    });
  }

  saveList(list: UserList, title: string, description: string, visibility: string): void {
    const clean = title.trim();
    if (!clean) return;
    this.user.updateList(list.id, { title: clean, description: description.trim(), visibility: visibility === 'public' ? 'public' : 'private' }).subscribe((saved) => {
      this.flash(saved ? 'Lista guardada.' : 'No se pudo guardar la lista.', !saved);
      if (saved) this.editingId.set(null);
    });
  }

  private flash(message: string, error: boolean): void {
    this.note.set(message);
    this.noteError.set(error);
    setTimeout(() => this.note.set(''), 3000);
  }

  deleteList(list: UserList): void {
    if (!confirm(`¿Borrar la lista «${list.title}»? No se puede deshacer.`)) return;
    this.user.deleteList(list.id).subscribe((ok) => this.flash(ok ? 'Lista borrada.' : 'No se pudo borrar la lista.', !ok));
    if (this.openId() === list.id) this.openId.set(null);
    this.editingId.set(null);
  }

  toggleOpen(list: UserList): void {
    if (this.openId() === list.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(list.id);
    this.openItems.set([]);
    this.user.fetchListItems(list.id).subscribe((items) => this.openItems.set(items));
  }

  removeFromList(list: UserList, item: UserListItem): void {
    this.user.removeListItem(list.id, item.id).subscribe((ok) => {
      if (ok) this.openItems.update((items) => items.filter((i) => i.id !== item.id));
    });
  }
}
