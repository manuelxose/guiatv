import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserNotification, UserNotifications } from '../../../../interfaces/user.interface';
import { ChatService } from '../../../../services/chat.service';
import { UserService } from '../../../../services/user.service';

/** Reminders the assistant creates are stored as notifications tagged `payload.source = 'ai_reminder'`. */
const isReminder = (n: UserNotification) => n.payload?.['source'] === 'ai_reminder';

/** Avisos: programme reminders, the notification inbox and which emails/alerts the user wants. */
@Component({
  selector: 'app-my-notices',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../perfil-ui.scss',
  template: `
    <section class="pf-sec" aria-labelledby="av-rem">
      <div class="pf-head">
        <h2 id="av-rem">Recordatorios</h2>
        <p>Pide al asistente «avísame cuando empiece…» y el aviso aparecerá aquí y en la campana.</p>
      </div>
      @if (reminders().length) {
      <ul class="pf-rows">
        @for (r of reminders(); track r.id) {
        <li class="pf-row" [class.unread]="!r.readAt">
          <span class="pf-row__main">
            <strong>{{ $any(r.payload)?.programTitle || r.title }}</strong>
            <span class="pf-small">{{ where(r) }}@if ($any(r.payload)?.startTime) { · {{ $any(r.payload).startTime | date: 'EEE d MMM, HH:mm' }}}</span>
          </span>
        </li>
        }
      </ul>
      } @else {
      <div class="pf-empty"><strong>No tienes recordatorios</strong><span>Prueba a decirle al asistente: «Avísame cuando empiece el partido del Madrid».</span><button type="button" class="pf-btn pf-btn--pri" (click)="openAssistant()">Abrir el asistente</button></div>
      }
    </section>

    <section class="pf-sec" aria-labelledby="av-inbox">
      <div class="pf-head">
        <h2 id="av-inbox">Notificaciones</h2>
        @if (unread() > 0) {<button type="button" class="pf-link" (click)="markAll()">Marcar todo como leído</button>}
      </div>
      @if (inbox().length) {
      <ul class="pf-rows">
        @for (n of inbox(); track n.id) {
        <li class="pf-row" [class.unread]="!n.readAt">
          <span class="pf-row__main">
            <strong>{{ n.title }}</strong>
            @if (n.description) {<span class="pf-small">{{ n.description }}</span>}
          </span>
          <span class="pf-small">{{ n.createdAt | date: 'd MMM' }}</span>
          @if (!n.readAt) {<button type="button" class="pf-btn pf-btn--sm" (click)="markRead(n)">Leído</button>}
        </li>
        }
      </ul>
      } @else {
      <p class="pf-muted">No hay notificaciones.</p>
      }
    </section>

    <section class="pf-sec" aria-labelledby="av-prefs">
      <div class="pf-head"><h2 id="av-prefs">Qué quieres recibir</h2></div>
      <div class="pf-card">
        <label class="pf-switch">
          <span>Recomendaciones para ti<small>Estrenos y emisiones que encajan con tus gustos y plataformas.</small></span>
          <input type="checkbox" [checked]="prefs().recommendations" (change)="setPref('recommendations', $any($event.target).checked)" />
        </label>
        <label class="pf-switch">
          <span>Resumen semanal<small>Lo mejor de la semana en tus canales y plataformas, una vez por semana.</small></span>
          <input type="checkbox" [checked]="prefs().weeklySummary" (change)="setPref('weeklySummary', $any($event.target).checked)" />
        </label>
      </div>
    </section>
  `,
})
export class MyNoticesComponent {
  private readonly user = inject(UserService);
  private readonly chat = inject(ChatService);

  private readonly all = toSignal(this.user.getNotifications(), { initialValue: [] as UserNotification[] });
  private readonly profile = toSignal(this.user.getProfile(), { requireSync: true });
  readonly reminders = computed(() => this.all().filter(isReminder));
  readonly inbox = computed(() => this.all().filter((n) => !isReminder(n)));
  readonly unread = computed(() => this.all().filter((n) => !n.readAt).length);
  readonly prefs = computed(() => this.profile().notifications);

  constructor() {
    this.user.fetchNotifications().subscribe();
  }

  where(r: UserNotification): string {
    const p = r.payload as { channel?: string; platform?: string } | undefined;
    return p?.channel || p?.platform || 'Programa';
  }

  markRead(n: UserNotification): void {
    this.user.markNotificationsRead([n.id]).subscribe(() => this.user.fetchNotifications().subscribe());
  }

  markAll(): void {
    this.user.markNotificationsRead([], true).subscribe(() => this.user.fetchNotifications().subscribe());
  }

  setPref(key: keyof UserNotifications, value: boolean): void {
    this.user.updateNotifications({ [key]: value }).subscribe();
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }
}
