import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserService } from '../../../../services/user.service';
import { avatarSrc } from '../../../../utils/avatar-src';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // same limit as the API
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The user's photo with a camera button on it: upload or change (previewed in the browser first, saved only
 * after "Guardar") and remove. Used in the profile card and in Cuenta.
 */
@Component({
  selector: 'app-avatar-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './avatar-editor.component.scss',
  template: `
    <div class="ae" [style.--ae-size.px]="size()">
      <span class="ae__img" [class.ae__img--preview]="!!preview()">
        @if (preview() || photo()) {<img [src]="preview() || photo()" [alt]="preview() ? 'Vista previa de tu nueva foto' : 'Tu foto de perfil'" />} @else { {{ initials() }} }
        @if (busy()) {<span class="ae__busy" aria-hidden="true"></span>}
      </span>

      @if (!preview()) {
      <button type="button" class="ae__cam" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-haspopup="menu" [disabled]="busy()" [attr.aria-label]="photo() ? 'Cambiar o quitar foto' : 'Subir foto'" [title]="photo() ? 'Cambiar o quitar foto' : 'Subir foto'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.3-1.8A1.5 1.5 0 0 1 9.6 3.5h4.8a1.5 1.5 0 0 1 1.2.7L16.9 6h1.6A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9Z" /><circle cx="12" cy="13" r="3.5" /></svg>
      </button>
      }

      @if (menuOpen()) {
      <div class="ae__menu" role="menu">
        <button type="button" role="menuitem" (click)="choose()">{{ photo() ? 'Cambiar foto' : 'Subir foto' }}</button>
        @if (photo()) {<button type="button" role="menuitem" class="danger" (click)="remove()">Quitar foto</button>}
      </div>
      }
      <input #file type="file" accept="image/png,image/jpeg,image/webp" hidden (change)="picked($event)" />
    </div>

    @if (preview()) {
    <div class="ae__confirm">
      <button type="button" class="ae__save" (click)="save()" [disabled]="busy()">Guardar foto</button>
      <button type="button" class="ae__cancel" (click)="cancel()" [disabled]="busy()">Cancelar</button>
    </div>
    }
    @if (showStatus()) {<p class="ae__status" [class.err]="error()" role="status">{{ note() }}</p>}
  `,
})
export class AvatarEditorComponent {
  /** Diameter in px. */
  readonly size = input(88);
  /** Show the one-line status under the photo (Cuenta does; the small profile card does not have room). */
  readonly showStatus = input(true);

  private readonly user = inject(UserService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  private readonly profile = toSignal(this.user.getProfile(), { requireSync: true });

  readonly photo = computed(() => avatarSrc(this.profile().avatar));
  readonly menuOpen = signal(false);
  readonly preview = signal('');
  readonly busy = signal(false);
  readonly note = signal('');
  readonly error = signal(false);
  private file: File | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dropPreview());
  }

  initials(): string {
    return (this.profile().name || 'U').split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen.set(false);
  }

  choose(): void {
    this.menuOpen.set(false);
    this.fileInput().nativeElement.click();
  }

  /** Shows the picked image in the circle; nothing is uploaded until "Guardar foto". */
  picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be picked again
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return this.fail('Sube una imagen PNG, JPEG o WebP.');
    if (file.size > MAX_PHOTO_BYTES) return this.fail('La imagen debe pesar menos de 5 MB.');
    this.dropPreview();
    this.file = file;
    this.preview.set(URL.createObjectURL(file));
    this.error.set(false);
    this.note.set('Así quedará tu foto (se recorta en cuadrado).');
  }

  save(): void {
    if (!this.file) return;
    this.busy.set(true);
    this.note.set('Subiendo foto…');
    this.user.uploadAvatar(this.file).subscribe((p) => {
      this.busy.set(false);
      if (!p) return this.fail('No se pudo subir la foto. Inténtalo de nuevo.');
      this.dropPreview();
      this.error.set(false);
      this.note.set('Foto actualizada.');
    });
  }

  cancel(): void {
    this.dropPreview();
    this.note.set('');
  }

  remove(): void {
    this.menuOpen.set(false);
    if (!confirm('¿Quitar tu foto de perfil?')) return;
    this.busy.set(true);
    this.user.updateProfile({ avatar: '' }).subscribe((p) => {
      this.busy.set(false);
      this.error.set(!p);
      this.note.set(p ? 'Foto quitada.' : 'No se pudo quitar la foto.');
    });
  }

  private fail(message: string): void {
    this.error.set(true);
    this.note.set(message);
  }

  private dropPreview(): void {
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.preview.set('');
    this.file = null;
  }
}
