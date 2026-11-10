import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APP_PATHS } from '../../config/route-map';
import {
  broadcastDisplay,
  broadcastTiming,
  EntityBroadcast,
  EntityBroadcasts,
} from '../../pages/entity-detail/entity-detail.model';

/**
 * Upcoming television broadcasts of one work, as the API joined them on identity evidence. Shows the channel (linked),
 * the day and wall-clock time in Madrid, the duration and the time until it starts; says plainly when nothing is
 * scheduled or the schedule could not be read. Pure presentation: the list is whatever the API sent.
 */
@Component({
  selector: 'app-entity-broadcast-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; min-width: 0; }'],
  template: `
    <section [attr.aria-labelledby]="headingId">
      <h2 [id]="headingId" class="text-lg font-bold tracking-tight text-[var(--portal-text)]">Próximas emisiones</h2>

      @switch (view()) {
        @case ('list') {
          <p class="mt-1 text-xs text-[var(--portal-text-muted)]">Horario peninsular (Madrid).</p>
          <ul class="mt-4 grid gap-3 md:grid-cols-2">
            @for (row of rows(); track row.item.airingId) {
              <li>
                <article
                  class="tnum flex items-center gap-3 rounded-[var(--radius-md)] border p-3"
                  [class.border-[var(--accent-live)]]="row.timing.state === 'live'"
                  [class.bg-[var(--accent-live-soft)]]="row.timing.state === 'live'"
                  [class.border-[var(--portal-border)]]="row.timing.state !== 'live'"
                  [class.bg-[var(--portal-surface)]]="row.timing.state !== 'live'"
                >
                  <!-- Channel logos are drawn for dark backgrounds (many are white), in both themes. -->
                  <span class="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#12151a]">
                    @if (row.item.channel.icon) {
                      <img [src]="row.item.channel.icon" alt="" width="48" height="48" loading="lazy" decoding="async" class="h-full w-full object-contain p-1.5" />
                    }
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-baseline gap-x-2">
                      <a [routerLink]="row.item.channel.path" class="truncate text-sm font-semibold text-[var(--portal-text)] underline-offset-4 hover:underline focus-visible:underline">{{ row.item.channel.name }}</a>
                      <span class="text-xs font-semibold" [class.text-[var(--portal-text)]]="row.timing.state === 'live'" [class.text-[var(--portal-text-muted)]]="row.timing.state !== 'live'">{{ row.timing.text }}</span>
                    </p>
                    <p class="mt-1 text-sm text-[var(--portal-text-soft)]">
                      <time [attr.datetime]="row.item.startLocal" [attr.aria-label]="row.display.full">{{ row.display.day }} · {{ row.display.time }}</time>
                      @if (row.display.duration) { <span class="text-[var(--portal-text-muted)]"> · {{ row.display.duration }}</span> }
                    </p>
                    @if (row.asTitle) {
                      <p class="mt-1 text-xs text-[var(--portal-text-muted)]">Emitida como «{{ row.asTitle }}»</p>
                    }
                    @if (row.item.subtitle) {
                      <p class="mt-1 text-xs text-[var(--portal-text-muted)]">{{ row.item.subtitle }}</p>
                    }
                  </div>
                </article>
              </li>
            }
          </ul>
        }
        @case ('unavailable') {
          <p class="mt-4 rounded-[var(--radius-md)] border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 text-sm text-[var(--portal-text-soft)]" role="status">
            No hemos podido comprobar la programación ahora mismo. Inténtalo de nuevo en unos minutos.
          </p>
        }
        @default {
          <p class="mt-4 rounded-[var(--radius-md)] border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 text-sm text-[var(--portal-text-soft)]">
            No hay emisiones programadas en la programación disponible.
            <a [routerLink]="paths.explore" class="font-semibold text-[var(--portal-text)] underline underline-offset-4">Qué ver hoy en TV</a>
          </p>
        }
      }
    </section>
  `,
})
export class EntityBroadcastListComponent {
  readonly broadcasts = input<EntityBroadcasts | undefined>();
  /** The clock the relative times are measured against: the server's `generatedAt` while rendering, the browser's after. */
  readonly now = input<Date>(new Date());
  /** The entity's title, to say "Emitida como …" only when the guide names the film differently. */
  readonly entityTitle = input<string>('');
  readonly headingId = 'entity-broadcasts-title';
  readonly paths = APP_PATHS;

  /** `list` only when something upcoming remains after dropping what ended since the page was built. */
  readonly view = computed(() => (this.broadcasts()?.status === 'unavailable' ? 'unavailable' : this.rows().length ? 'list' : 'empty'));

  readonly rows = computed(() => {
    const now = this.now();
    return (this.broadcasts()?.items ?? [])
      .map((item: EntityBroadcast) => ({ item, timing: broadcastTiming(item, now), display: broadcastDisplay(item, now), asTitle: item.programmeTitle !== this.entityTitle() ? item.programmeTitle : '' }))
      .filter((row) => row.timing.state !== 'ended');
  });
}
