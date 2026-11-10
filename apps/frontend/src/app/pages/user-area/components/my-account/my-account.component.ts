import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { UserPrivacy } from '../../../../interfaces/user.interface';
import { AuthService, AuthSessionView } from '../../../../services/auth.service';
import { UserService } from '../../../../services/user.service';
import { AvatarEditorComponent } from '../avatar-editor/avatar-editor.component';

interface Draft { name: string; username: string; location: string; bio: string }

/** Cuenta: profile (photo upload + data), privacy, security (password, devices) and personal data. */
@Component({
  selector: 'app-my-account',
  standalone: true,
  imports: [DatePipe, RouterLink, AvatarEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../perfil-ui.scss', './my-account.component.scss'],
  template: `
    <!-- ── Perfil ── -->
    <section class="ac-card" aria-labelledby="ac-profile">
      <header class="ac-card__head"><h2 id="ac-profile">Tu perfil</h2><a [routerLink]="['/perfil', profile().id]">Ver perfil público ›</a></header>

      <div class="ac-profile">
        <app-avatar-editor [size]="112"></app-avatar-editor>
      <form class="ac-form" (submit)="$event.preventDefault(); saveProfile()">
        <label class="pf-field">Nombre
          <input class="pf-input" [value]="draft().name" (input)="edit('name', $event)" maxlength="60" required autocomplete="name" />
        </label>
        <label class="pf-field">Usuario
          <input class="pf-input" [value]="draft().username" (input)="edit('username', $event)" maxlength="30" required autocomplete="username" pattern="[A-Za-z0-9_.]+" />
          <small>Letras, números, punto o guion bajo.</small>
        </label>
        <label class="pf-field">Ciudad
          <input class="pf-input" [value]="draft().location" (input)="edit('location', $event)" maxlength="60" autocomplete="address-level2" />
        </label>
        <div class="pf-field">Correo
          <span class="ac-readonly">{{ profile().email }}</span>
        </div>
        <label class="pf-field ac-form__wide">Sobre ti
          <textarea class="pf-input" [value]="draft().bio" (input)="edit('bio', $event)" maxlength="240" rows="3"></textarea>
          <small>{{ draft().bio.length }}/240</small>
        </label>
        <div class="ac-form__wide ac-form__foot">
          <button type="submit" class="pf-btn pf-btn--pri" [disabled]="!dirty() || busy()">Guardar cambios</button>
          @if (dirty()) {<button type="button" class="pf-btn" (click)="resetDraft()">Descartar</button>}
          <p class="ac-status" [class.err]="profileError()" role="status">{{ profileNote() }}</p>
        </div>
      </form>
      </div>
    </section>

    <!-- ── Privacidad ── -->
    <section class="ac-card" aria-labelledby="ac-privacy">
      <header class="ac-card__head"><h2 id="ac-privacy">Privacidad</h2></header>
      <label class="pf-switch">
        <span>Perfil público<small>Cualquiera con el enlace ve tu nombre, tu foto, tu bio y tus gustos.</small></span>
        <input type="checkbox" [checked]="profile().privacy.profilePublic" (change)="setPrivacy('profilePublic', $event)" />
      </label>
      <label class="pf-switch">
        <span>Listas públicas<small>Tus listas aparecen en tu perfil público.</small></span>
        <input type="checkbox" [checked]="profile().privacy.publicLists" (change)="setPrivacy('publicLists', $event)" />
      </label>
      <label class="pf-switch">
        <span>Compartir lo que veo<small>Muestra en tu perfil público lo que has visto y valorado.</small></span>
        <input type="checkbox" [checked]="profile().privacy.shareActivity" (change)="setPrivacy('shareActivity', $event)" />
      </label>
    </section>

    <!-- ── Seguridad ── -->
    <section class="ac-card" aria-labelledby="ac-security">
      <header class="ac-card__head"><h2 id="ac-security">Seguridad</h2></header>
      <h3>Cambiar contraseña</h3>
      <form class="ac-form" (submit)="$event.preventDefault(); changePassword(cur.value, nw.value, rep.value); cur.value = ''; nw.value = ''; rep.value = ''">
        <label class="pf-field">Actual<input #cur class="pf-input" type="password" autocomplete="current-password" required /></label>
        <label class="pf-field">Nueva<input #nw class="pf-input" type="password" autocomplete="new-password" minlength="8" required /></label>
        <label class="pf-field">Repite la nueva<input #rep class="pf-input" type="password" autocomplete="new-password" minlength="8" required /></label>
        <div class="ac-form__wide ac-form__foot">
          <button type="submit" class="pf-btn" [disabled]="busy()">Cambiar contraseña</button>
          <p class="ac-status" [class.err]="!passOk()" role="status">{{ passNote() }}</p>
        </div>
      </form>

      <h3>Dispositivos con sesión abierta</h3>
      <ul class="pf-rows">
        @for (s of sessions(); track s.id) {
        <li class="pf-row">
          <span class="pf-row__main">
            <strong>{{ s.deviceName || device(s.userAgent) }}@if (s.current) { <span class="ac-badge">Este dispositivo</span>}</strong>
            <span class="pf-small">Último uso {{ (s.lastUsedAt || s.createdAt) | date: "d MMM y, HH:mm" }}</span>
          </span>
          @if (!s.current) {<button type="button" class="pf-btn pf-btn--sm" (click)="revoke(s)">Cerrar sesión</button>}
        </li>
        } @empty {<li class="pf-muted">No hay otras sesiones abiertas.</li>}
      </ul>
    </section>

    <!-- ── Tus datos ── -->
    <section class="ac-card" aria-labelledby="ac-data">
      <header class="ac-card__head"><h2 id="ac-data">Tus datos</h2></header>
      <div class="ac-line">
        <span><strong>Descargar mis datos</strong><small>Todo lo que guardamos de ti, en un archivo JSON.</small></span>
        <button type="button" class="pf-btn pf-btn--sm" [disabled]="busy()" (click)="exportData()">Descargar</button>
      </div>
      <div class="ac-line">
        <span><strong>Cerrar sesión</strong><small>En este dispositivo.</small></span>
        <button type="button" class="pf-btn pf-btn--sm" (click)="logout()">Cerrar sesión</button>
      </div>
      <details class="ac-danger">
        <summary>Eliminar mi cuenta</summary>
        <p class="pf-muted">Se borran tu perfil, tus listas, tus valoraciones y la memoria del asistente. No se puede deshacer.</p>
        <form class="pf-inline" (submit)="$event.preventDefault(); deleteAccount(pw.value)">
          <input #pw class="pf-input" type="password" autocomplete="current-password" placeholder="Tu contraseña" aria-label="Tu contraseña para confirmar" required />
          <button type="submit" class="pf-btn pf-btn--danger" [disabled]="busy()">Eliminar definitivamente</button>
        </form>
        <p class="ac-status err" role="alert">{{ deleteNote() }}</p>
      </details>
    </section>
  `,
})
export class MyAccountComponent {
  private readonly user = inject(UserService);
  private readonly auth = inject(AuthService);

  readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  readonly sessions = signal<AuthSessionView[]>([]);
  readonly busy = signal(false);

  readonly draft = signal<Draft>({ name: '', username: '', location: '', bio: '' });
  private readonly saved = signal<Draft>({ name: '', username: '', location: '', bio: '' });
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  readonly profileNote = signal('');
  readonly profileError = signal(false);

  readonly passNote = signal('');
  readonly passOk = signal(true);
  readonly deleteNote = signal('');

  constructor() {
    // Copy the profile into the form when it loads or changes elsewhere, but never over what the user is typing.
    effect(() => {
      const p = this.profile();
      const fresh: Draft = { name: p.name || '', username: p.username || '', location: p.location === '-' ? '' : p.location || '', bio: p.bio || '' };
      untracked(() => {
        if (!this.dirty()) this.draft.set(fresh);
        this.saved.set(fresh);
      });
    });
    this.loadSessions();
  }

  edit(field: keyof Draft, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((d) => ({ ...d, [field]: value }));
    this.profileNote.set('');
  }

  resetDraft(): void {
    this.draft.set(this.saved());
    this.profileNote.set('');
  }

  saveProfile(): void {
    const d = this.draft();
    this.busy.set(true);
    this.user.updateProfile({ name: d.name.trim(), username: d.username.trim(), location: d.location.trim(), bio: d.bio.trim() }).subscribe((p) => {
      this.busy.set(false);
      this.profileError.set(!p);
      this.profileNote.set(p ? 'Cambios guardados.' : 'No se pudieron guardar (¿el usuario ya existe?).');
      if (p) this.draft.set(this.saved());
    });
  }

  setPrivacy(key: keyof UserPrivacy, event: Event): void {
    this.user.updatePrivacy({ [key]: (event.target as HTMLInputElement).checked }).subscribe();
  }

  changePassword(current: string, next: string, repeat: string): void {
    if (next !== repeat) {
      this.passOk.set(false);
      this.passNote.set('Las contraseñas nuevas no coinciden.');
      return;
    }
    this.busy.set(true);
    this.user.changePassword(current, next).subscribe((ok) => {
      this.busy.set(false);
      this.passOk.set(ok);
      this.passNote.set(ok ? 'Contraseña cambiada.' : 'No se pudo cambiar. Revisa tu contraseña actual.');
    });
  }

  device(ua?: string): string {
    if (!ua) return 'Dispositivo';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? `${browser} en ${os}` : os;
  }

  revoke(s: AuthSessionView): void {
    this.auth.revokeSession(s.id).subscribe(() => this.loadSessions());
  }

  exportData(): void {
    this.busy.set(true);
    this.user.exportUserData().subscribe((data) => {
      this.busy.set(false);
      if (!data) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mis-datos-guiatv.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  logout(): void {
    this.user.logout();
  }

  deleteAccount(password: string): void {
    if (!confirm('Última confirmación: ¿eliminar tu cuenta para siempre?')) return;
    this.busy.set(true);
    this.user.deleteAccount(password).subscribe((ok) => {
      this.busy.set(false);
      if (ok) this.user.logout();
      else this.deleteNote.set('No se pudo eliminar. Revisa tu contraseña.');
    });
  }

  private loadSessions(): void {
    this.auth.getSessions().subscribe((list) => this.sessions.set(list));
  }
}
