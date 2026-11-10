import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssistantMemorySnapshot } from '../../../interfaces/chatbot.interface';
import {
  PreferenceAnswer,
  PreferenceQuestion,
  PreferenceQuestionKey,
  PREFERENCE_QUESTIONS,
} from '../../../interfaces/chat-profile.types';

@Component({
  selector: 'app-chat-profile-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="profile-panel" aria-labelledby="profile-panel-title">
      <header class="profile-panel__header">
        <button type="button" class="profile-panel__back" (click)="closed.emit()" [attr.aria-label]="backLabel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"></path>
          </svg>
        </button>
        <div class="profile-panel__title">
          <h2 id="profile-panel-title">Perfil IA</h2>
          <p>{{ completedCount }} de {{ questions.length }} preferencias completadas</p>
        </div>
        <span class="profile-panel__counter" aria-hidden="true">{{ currentIndex + 1 }}/{{ questions.length }}</span>
      </header>

      <div class="profile-panel__progress" aria-hidden="true">
        <span [style.transform]="'scaleX(' + progressRatio + ')' "></span>
      </div>

      <div class="profile-panel__body">
        <nav class="profile-panel__steps" aria-label="Preguntas del perfil IA">
          <button
            *ngFor="let question of questions; let index = index; trackBy: trackByQuestion"
            type="button"
            (click)="openQuestion(index)"
            [class.is-active]="index === currentIndex"
            [class.is-complete]="isComplete(question)"
            [attr.aria-current]="index === currentIndex ? 'step' : null"
            [attr.aria-label]="question.title + (isComplete(question) ? ', completada' : ', pendiente')"
          >
            <span>{{ index + 1 }}</span>
          </button>
        </nav>

        <article class="profile-panel__question">
          <div class="profile-panel__copy">
            <h3>{{ currentQuestion.title }}</h3>
            <p>{{ currentQuestion.description }}</p>
          </div>

          <div
            *ngIf="currentQuestion.kind !== 'text-list'"
            class="profile-panel__choices"
            [attr.aria-label]="currentQuestion.title"
          >
            <button
              *ngFor="let option of currentQuestion.options; trackBy: trackByOption"
              type="button"
              class="profile-chip"
              [class.is-selected]="isSelected(option.value)"
              [attr.aria-pressed]="isSelected(option.value)"
              [attr.aria-label]="option.label"
              (click)="toggleOption(option.value)"
            >
              <span>{{ option.label }}</span>
              <svg *ngIf="isSelected(option.value)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="m5 12 4 4L19 6"></path>
              </svg>
            </button>
          </div>

          <div *ngIf="currentQuestion.kind === 'text-list'" class="profile-panel__text-list">
            <label for="profile-reference">Añade títulos o sagas</label>
            <div class="profile-panel__text-entry">
              <input
                id="profile-reference"
                name="profile-reference"
                type="text"
                autocomplete="off"
                [(ngModel)]="textDraft"
                placeholder="Por ejemplo, The Bear…"
                (keydown.enter)="addTextValue($event)"
              />
              <button type="button" (click)="addTextValue()" [disabled]="!textDraft.trim()">Añadir</button>
            </div>
            <div *ngIf="currentValues.length" class="profile-panel__saved-values" aria-label="Referencias añadidas">
              <span *ngFor="let value of currentValues; trackBy: trackByValue" class="profile-value" [attr.aria-label]="value">
                <span>{{ value }}</span>
                <button type="button" (click)="removeValue(value)" [attr.aria-label]="'Eliminar ' + value">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </span>
            </div>
          </div>

          <p *ngIf="saveError" class="profile-panel__error" role="alert">{{ saveError }}</p>
        </article>
      </div>

      <footer class="profile-panel__footer">
        <button type="button" class="profile-panel__secondary" (click)="previousQuestion()" [disabled]="currentIndex === 0">
          Anterior
        </button>
        <button
          type="button"
          class="profile-panel__primary"
          (click)="saveCurrentAnswer()"
          [disabled]="saving || !canSave"
        >
          {{ saving ? 'Guardando…' : currentIndex === questions.length - 1 ? 'Guardar y terminar' : 'Guardar y continuar' }}
        </button>
      </footer>
    </section>
  `,
  styles: [`
    :host { position: absolute; inset: 0; z-index: var(--z-drawer); display: block; min-width: 0; min-height: 0; }
    .profile-panel { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--portal-bg); color: var(--portal-text); }
    .profile-panel__header { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; flex: 0 0 auto; align-items: center; gap: .6rem; border-bottom: 1px solid var(--portal-border); background: var(--portal-surface-strong); padding: .5rem .75rem; }
    .profile-panel__back { display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center; border: 0; border-radius: .85rem; background: transparent; color: var(--portal-text); cursor: pointer; touch-action: manipulation; }
    .profile-panel__back:hover, .profile-panel__back:active { background: var(--portal-bg-elevated); }
    .profile-panel__back svg { width: 1.2rem; height: 1.2rem; }
    .profile-panel__title { min-width: 0; text-align: center; }
    .profile-panel__title h2, .profile-panel__title p { margin: 0; }
    .profile-panel__title h2 { font-size: var(--text-base); font-weight: 800; text-wrap: balance; }
    .profile-panel__title p { margin-top: .1rem; overflow: hidden; color: var(--portal-text-muted); font-size: var(--text-2xs); text-overflow: ellipsis; white-space: nowrap; }
    .profile-panel__counter { color: var(--portal-text-soft); font-size: var(--text-xs); font-variant-numeric: tabular-nums; font-weight: 750; text-align: center; }
    .profile-panel__progress { flex: 0 0 3px; background: var(--portal-divider); }
    .profile-panel__progress span { display: block; width: 100%; height: 100%; transform-origin: left center; background: var(--guide-accent); transition: transform 180ms ease; }
    .profile-panel__body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 1rem clamp(1rem, 4vw, 1.5rem) 2rem; }
    .profile-panel__steps { display: flex; justify-content: center; gap: .45rem; margin-bottom: clamp(1.5rem, 7vh, 3rem); }
    .profile-panel__steps button { display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center; border: 1px solid var(--portal-border); border-radius: 999px; background: var(--portal-bg-elevated); color: var(--portal-text-soft); font-size: var(--text-xs); font-weight: 750; cursor: pointer; touch-action: manipulation; }
    .profile-panel__steps button.is-active { border-color: var(--guide-accent); color: var(--guide-accent); box-shadow: inset 0 0 0 1px var(--guide-accent); }
    .profile-panel__steps button.is-complete:not(.is-active) { border-color: var(--assistant-chip-selected-border); background: var(--assistant-chip-selected-bg); color: var(--assistant-chip-selected-text); }
    .profile-panel__question { width: min(100%, 34rem); margin: 0 auto; }
    .profile-panel__copy h3, .profile-panel__copy p { margin: 0; }
    .profile-panel__copy h3 { font-size: clamp(1.2rem, 5vw, 1.6rem); font-weight: 800; line-height: 1.2; text-wrap: balance; }
    .profile-panel__copy p { margin-top: .55rem; color: var(--portal-text-soft); font-size: var(--text-sm); line-height: 1.55; text-wrap: pretty; }
    .profile-panel__choices { display: flex; flex-wrap: wrap; gap: .65rem; margin-top: 1.5rem; }
    .profile-chip { display: inline-flex; min-width: 0; min-height: 44px; max-width: min(100%, 13rem); align-items: center; justify-content: center; gap: .4rem; border: 1px solid var(--assistant-chip-border); border-radius: 999px; background: var(--assistant-chip-bg); color: var(--assistant-chip-text); padding: .55rem .9rem; font-size: var(--text-xs); font-weight: 700; cursor: pointer; touch-action: manipulation; transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease; }
    .profile-chip > span { min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .profile-chip svg { width: 1rem; height: 1rem; flex: 0 0 auto; }
    .profile-chip:hover, .profile-chip:active { border-color: var(--assistant-chip-hover-border); background: var(--assistant-chip-hover-bg); color: var(--portal-text); }
    .profile-chip.is-selected { border-color: var(--assistant-chip-selected-border); background: var(--assistant-chip-selected-bg); color: var(--assistant-chip-selected-text); }
    .profile-panel__text-list { margin-top: 1.5rem; }
    .profile-panel__text-list > label { display: block; margin-bottom: .45rem; color: var(--portal-text); font-size: var(--text-xs); font-weight: 750; }
    .profile-panel__text-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; }
    .profile-panel__text-entry input { min-width: 0; min-height: 48px; border: 1px solid var(--portal-border); border-radius: .9rem; background: var(--portal-bg-elevated); color: var(--portal-text); padding: .7rem .85rem; font: inherit; font-size: 1rem; }
    .profile-panel__text-entry input::placeholder { color: var(--portal-text-muted); }
    .profile-panel__text-entry button { min-height: 48px; border: 0; border-radius: .9rem; background: var(--portal-text); color: var(--portal-bg); padding: 0 1rem; font-weight: 750; cursor: pointer; }
    .profile-panel__text-entry button:disabled { cursor: not-allowed; opacity: .45; }
    .profile-panel__saved-values { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: .8rem; }
    .profile-value { display: inline-flex; min-width: 0; min-height: 44px; max-width: min(100%, 13rem); align-items: center; justify-content: center; border: 1px solid var(--assistant-chip-border); border-radius: 999px; background: var(--assistant-chip-bg); color: var(--assistant-chip-text); padding-left: .85rem; font-size: var(--text-xs); font-weight: 700; }
    .profile-value > span { min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .profile-value button { display: inline-flex; width: 44px; height: 44px; flex: 0 0 44px; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--portal-text-soft); cursor: pointer; }
    .profile-value button svg { width: .95rem; height: .95rem; }
    .profile-panel__error { margin: 1rem 0 0; border: 1px solid color-mix(in srgb, var(--status-live) 36%, var(--portal-border)); border-radius: .8rem; background: var(--status-live-soft); color: var(--status-live); padding: .7rem .8rem; font-size: var(--text-xs); line-height: 1.45; }
    .profile-panel__footer { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: .75rem; border-top: 1px solid var(--portal-border); background: var(--portal-surface-strong); padding: .75rem clamp(1rem, 4vw, 1.5rem) max(.75rem, var(--safe-bottom)); }
    .profile-panel__footer button { min-height: 48px; border-radius: .9rem; font-weight: 750; cursor: pointer; touch-action: manipulation; }
    .profile-panel__footer button:disabled { cursor: not-allowed; opacity: .45; }
    .profile-panel__secondary { border: 1px solid var(--portal-border); background: var(--portal-bg-elevated); color: var(--portal-text-soft); padding: 0 .9rem; }
    .profile-panel__primary { min-width: 10rem; border: 0; background: var(--section-accent); color: var(--section-accent-ink); padding: 0 1rem; }
    button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in srgb, var(--guide-accent) 45%, transparent); outline-offset: 2px; }
    @media (max-width: 430px) { .profile-panel__steps { justify-content: flex-start; overflow-x: auto; padding-bottom: .25rem; scrollbar-width: none; } .profile-panel__steps::-webkit-scrollbar { display: none; } .profile-panel__secondary { padding: 0 .7rem; } .profile-panel__primary { min-width: 0; flex: 1; } }
    @media (min-width: 768px) { :host { inset: 0; } }
    @media (prefers-reduced-motion: reduce) { .profile-panel__progress span, .profile-chip { transition: none; } }
  `],
})
export class ChatProfilePanelComponent implements OnChanges {
  @Input() memory: AssistantMemorySnapshot | null = null;
  @Input() profilePlatforms: string[] = [];
  @Input() profileGenres: string[] = [];
  @Input() saving = false;
  @Input() saveError = '';
  /** Overridable so hosts other than the chat widget (e.g. Mi GuíaTV) can use an accurate label for the "closed" action. */
  @Input() backLabel = 'Volver al chat';
  @Output() answerSaved = new EventEmitter<PreferenceAnswer>();
  @Output() closed = new EventEmitter<void>();

  readonly questions = PREFERENCE_QUESTIONS;

  currentIndex = 0;
  textDraft = '';
  private drafts: Partial<Record<PreferenceQuestionKey, string[]>> = {};
  private initialized = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized && (changes['memory'] || changes['profilePlatforms'] || changes['profileGenres'])) {
      this.resetDrafts();
      this.currentIndex = this.firstIncompleteIndex;
      this.initialized = true;
    }
  }

  get currentQuestion(): PreferenceQuestion { return this.questions[this.currentIndex]; }
  get currentValues(): string[] { return this.drafts[this.currentQuestion.key] || []; }
  get completedCount(): number { return this.questions.filter((question) => this.isComplete(question)).length; }
  get progressRatio(): number { return (this.currentIndex + 1) / this.questions.length; }
  get canSave(): boolean { return Boolean(this.currentValues.length || this.currentQuestion.optional); }

  isSelected(value: string): boolean { return this.currentValues.includes(value); }

  isComplete(question: PreferenceQuestion): boolean {
    return Boolean((this.drafts[question.key] || []).length);
  }

  openQuestion(index: number): void {
    if (this.saving || index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;
    this.textDraft = '';
  }

  previousQuestion(): void { this.openQuestion(this.currentIndex - 1); }

  toggleOption(value: string): void {
    if (this.saving) return;
    if (this.currentQuestion.kind === 'single') {
      this.drafts[this.currentQuestion.key] = this.isSelected(value) ? [] : [value];
      return;
    }
    const values = this.currentValues;
    this.drafts[this.currentQuestion.key] = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value].slice(0, 10);
  }

  addTextValue(event?: Event): void {
    event?.preventDefault();
    const value = this.textDraft.trim();
    if (!value || this.currentValues.some((item) => item.toLocaleLowerCase('es') === value.toLocaleLowerCase('es'))) return;
    this.drafts[this.currentQuestion.key] = [...this.currentValues, value].slice(0, 10);
    this.textDraft = '';
  }

  removeValue(value: string): void {
    this.drafts[this.currentQuestion.key] = this.currentValues.filter((item) => item !== value);
  }

  saveCurrentAnswer(): void {
    if (this.saving || !this.canSave) return;
    const question = this.currentQuestion;
    const values = [...this.currentValues];
    this.answerSaved.emit({
      key: question.key,
      target: question.target,
      field: question.field,
      values,
      community: question.key === 'preferredAutonomousCommunity' ? values[0] || null : undefined,
    });
  }

  onSaveComplete(): void {
    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex += 1;
      this.textDraft = '';
      return;
    }
    this.closed.emit();
  }

  trackByQuestion(_index: number, question: PreferenceQuestion): string { return question.key; }
  trackByOption(_index: number, option: { value: string }): string { return option.value; }
  trackByValue(_index: number, value: string): string { return value; }

  private get firstIncompleteIndex(): number {
    const index = this.questions.findIndex((question) => !this.isComplete(question) && !question.optional);
    return index >= 0 ? index : 0;
  }

  private resetDrafts(): void {
    const merge = (...groups: string[][]): string[] => [...new Set(groups.flat().filter(Boolean))].slice(0, 10);
    this.drafts = {
      preferredPlatforms: merge(this.profilePlatforms, this.memory?.preferredPlatforms || []),
      likedGenres: merge(this.profileGenres, this.memory?.likedGenres || []),
      preferredViewingContexts: [...(this.memory?.preferredViewingContexts || [])],
      preferredDurations: [...(this.memory?.preferredDurations || [])],
      favoriteFranchisesOrTitles: [...(this.memory?.favoriteFranchisesOrTitles || [])],
      preferredAutonomousCommunity: this.memory?.preferredAutonomousCommunity ? [this.memory.preferredAutonomousCommunity] : [],
      negativeSignals: [...(this.memory?.negativeSignals || [])],
    };
  }
}
