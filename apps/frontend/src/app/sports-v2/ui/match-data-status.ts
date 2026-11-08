import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DataAvailability } from '../data/availability';

interface StatusCopy {
  readonly title: string;
  readonly hint: string;
}

const COPY: Record<DataAvailability, (noun: string) => StatusCopy> = {
  loading: () => ({ title: 'Cargando datos', hint: 'Actualizando la información del partido.' }),
  fresh: () => ({ title: 'Datos actualizados', hint: 'La información está al día.' }),
  stale: () => ({ title: 'Datos desactualizados', hint: 'No se han podido actualizar; se muestran los últimos datos recibidos.' }),
  provider_unavailable: () => ({ title: 'Proveedor no disponible', hint: 'No se ha podido contactar con el proveedor de datos. Inténtalo de nuevo más tarde.' }),
  unavailable: (noun) => ({ title: `No hay ${noun} disponibles`, hint: `El proveedor no ofrece ${noun} para este partido.` }),
  competition_not_covered: () => ({ title: 'Competición sin cobertura', hint: 'No hay un proveedor de datos aprobado para esta competición.' }),
};

/** Explicit, accessible status message for one availability state. Never renders absent data as numbers. */
@Component({
  selector: 'app-sv2-match-data-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="status" [class.warn]="availability() === 'stale'" [class.err]="isUnavailable()" role="status">
      <strong>{{ copy().title }}</strong>
      @if (copy().hint) { <span>{{ copy().hint }}</span> }
    </div>
  `,
  styles: `
    :host { display: block; }
    .status { display: grid; gap: 4px; padding: 14px 16px; border: 1px dashed var(--sv2-border-strong); border-radius: var(--sv2-r-md); background: var(--sv2-surface-2); font-size: var(--sv2-fs-sm); }
    .status.warn { border-color: color-mix(in srgb, var(--sv2-scheduled) 45%, transparent); }
    .status.err { border-color: color-mix(in srgb, var(--sv2-live) 45%, transparent); }
    .status strong { font-weight: 600; }
    .status span { color: var(--sv2-text-muted); }
  `,
})
export class Sv2MatchDataStatusComponent {
  readonly availability = input.required<DataAvailability>();
  /** Noun for the field, e.g. "eventos", "estadísticas", "alineaciones". */
  readonly noun = input('datos');

  protected readonly copy = computed<StatusCopy>(() => COPY[this.availability()](this.noun()));

  protected isUnavailable(): boolean {
    const a = this.availability();
    return a === 'provider_unavailable' || a === 'unavailable' || a === 'competition_not_covered';
  }
}
