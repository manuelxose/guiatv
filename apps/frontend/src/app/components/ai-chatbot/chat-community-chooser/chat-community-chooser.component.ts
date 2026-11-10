import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Regional TV under an answer. With a saved community it is a one-line note with "Cambiar" (the assistant
 * already includes those channels); without one, a compact picker: community + Añadir, or No, gracias.
 */
@Component({
  selector: 'app-chat-community-chooser',
  standalone: true,
  template: `
    @if (savedCommunity && !changing) {
    <p class="cc cc--note">
      <span aria-hidden="true">📍</span>
      <span>Incluyo la tele autonómica de <strong>{{ savedCommunity }}</strong></span>
      <button type="button" (click)="changing = true">Cambiar</button>
      <button type="button" (click)="declined.emit()">Quitar</button>
    </p>
    } @else {
    <form class="cc" (submit)="$event.preventDefault(); choose(select.value)">
      <span class="cc__text"><span aria-hidden="true">📍</span> {{ savedCommunity ? '¿Qué comunidad uso?' : '¿Añado los canales de tu comunidad?' }}</span>
      <div class="cc__row">
        <select #select class="cc__select" aria-label="Tu comunidad autónoma" [value]="savedCommunity || ''">
          <option value="" disabled>Elige tu comunidad</option>
          @for (c of communities; track c) {<option [value]="c">{{ c }}</option>}
        </select>
        <button type="submit" class="cc__add">Añadir</button>
      </div>
      <button type="button" class="cc__no" (click)="changing ? (changing = false) : declined.emit()">{{ changing ? 'Cancelar' : 'No, gracias' }}</button>
    </form>
    }
  `,
  styles: [`
    :host { display: block; }
    .cc { display: grid; gap: 8px; margin: 0; padding: 10px 12px; border: 1px solid var(--sv2-border); border-radius: 12px; background: var(--sv2-bg); font-size: var(--sv2-fs-sm); }
    .cc--note { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    .cc--note strong { color: var(--sv2-text); }
    .cc--note button, .cc__no { padding: 0; border: 0; background: none; color: var(--section-accent-text); font: inherit; font-weight: 700; cursor: pointer; }
    .cc--note button:hover, .cc__no:hover { text-decoration: underline; }
    .cc__no { justify-self: start; color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    .cc__text { color: var(--sv2-text); font-weight: 600; }
    .cc__row { display: flex; gap: 6px; }
    .cc__select { flex: 1; min-width: 0; min-height: 36px; padding: 0 10px; border: 1px solid var(--sv2-border-strong); border-radius: 10px; background: var(--sv2-surface-1); color: var(--sv2-text); font: inherit; }
    .cc__add { flex: none; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--section-accent); color: var(--section-accent-ink); font: inherit; font-weight: 800; cursor: pointer; }
    .cc__select:focus-visible, .cc__add:focus-visible, .cc button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
  `],
})
export class ChatCommunityChooserComponent {
  @Input() savedCommunity: string | null = null;
  /** Kept for the host's binding; the chooser writes its own short copy. */
  @Input() promptText = '';
  @Input() communities: string[] = [];
  @Output() useSaved = new EventEmitter<void>();
  @Output() communitySelected = new EventEmitter<string>();
  @Output() declined = new EventEmitter<void>();

  changing = false;

  choose(community: string): void {
    if (!community) return;
    this.changing = false;
    if (community === this.savedCommunity) this.useSaved.emit();
    else this.communitySelected.emit(community);
  }
}
