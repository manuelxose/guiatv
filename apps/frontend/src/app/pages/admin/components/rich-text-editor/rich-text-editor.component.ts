import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  forwardRef,
  ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

interface EditorCommand {
  id: string;
  label: string;
  title: string;
  command?: string;
  argument?: string;
}

/**
 * Editor de texto enriquecido ligero (sin dependencias) para el contenido HTML
 * editorial. Implementa ControlValueAccessor para enlazarse con formControlName.
 */
@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="rte border border-[var(--portal-border)] rounded-xl overflow-hidden">
      <div class="flex flex-wrap items-center gap-1 border-b border-[var(--portal-border)] bg-[var(--portal-surface)] px-2 py-1.5" role="toolbar" aria-label="Formato">
        <button
          *ngFor="let cmd of commands"
          type="button"
          class="px-2 py-1 rounded-lg text-xs text-[var(--portal-text-soft)] hover:text-[var(--portal-text)] hover:bg-[var(--portal-surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-green)]"
          [title]="cmd.title"
          [attr.aria-label]="cmd.title"
          (mousedown)="$event.preventDefault()"
          (click)="exec(cmd)"
          [disabled]="disabled"
        >
          {{ cmd.label }}
        </button>
      </div>
      <div
        #editor
        class="rte-content min-h-[320px] max-h-[600px] overflow-auto px-4 py-3 text-sm text-[var(--portal-text)] bg-[var(--portal-surface)] focus:outline-none"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        (input)="onInput()"
        (blur)="onTouchedCallback()"
        (paste)="onPaste($event)"
      ></div>
    </div>
  `,
  styles: [
    `
      .rte-content:empty::before {
        content: 'Escribe o pega el contenido del artículo…';
        color: var(--portal-text-muted);
        pointer-events: none;
      }
      .rte-content h2 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
      .rte-content h3 { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
      .rte-content p { margin: 0.5rem 0; }
      .rte-content ul, .rte-content ol { margin: 0.5rem 0; padding-left: 1.5rem; }
      .rte-content blockquote {
        border-left: 3px solid var(--portal-border-strong);
        padding-left: 0.75rem;
        margin: 0.75rem 0;
        color: var(--portal-text-soft);
      }
      .rte-content a { color: var(--accent-streaming); text-decoration: underline; }
    `,
  ],
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit {
  @ViewChild('editor', { static: true }) editorRef!: ElementRef<HTMLDivElement>;

  disabled = false;

  readonly commands: EditorCommand[] = [
    { id: 'bold', label: 'B', title: 'Negrita', command: 'bold' },
    { id: 'italic', label: 'I', title: 'Cursiva', command: 'italic' },
    { id: 'h2', label: 'H2', title: 'Titular 2', command: 'formatBlock', argument: 'h2' },
    { id: 'h3', label: 'H3', title: 'Titular 3', command: 'formatBlock', argument: 'h3' },
    { id: 'p', label: '¶', title: 'Párrafo', command: 'formatBlock', argument: 'p' },
    { id: 'quote', label: '❝', title: 'Cita', command: 'formatBlock', argument: 'blockquote' },
    { id: 'ul', label: '• Lista', title: 'Lista con viñetas', command: 'insertUnorderedList' },
    { id: 'ol', label: '1. Lista', title: 'Lista numerada', command: 'insertOrderedList' },
    { id: 'link', label: '🔗', title: 'Insertar enlace' },
    { id: 'unlink', label: '⛓‍💥', title: 'Quitar enlace', command: 'unlink' },
    { id: 'clear', label: '⌫', title: 'Limpiar formato', command: 'removeFormat' },
    { id: 'undo', label: '↶', title: 'Deshacer', command: 'undo' },
    { id: 'redo', label: '↷', title: 'Rehacer', command: 'redo' },
  ];

  private onChange: (value: string) => void = () => undefined;
  onTouchedCallback: () => void = () => undefined;
  private pendingValue: string | null = null;

  ngAfterViewInit(): void {
    if (this.pendingValue !== null) {
      this.editorRef.nativeElement.innerHTML = this.pendingValue;
      this.pendingValue = null;
    }
  }

  writeValue(value: string | null): void {
    const html = value || '';
    if (this.editorRef) {
      const el = this.editorRef.nativeElement;
      if (el.innerHTML !== html) el.innerHTML = html;
    } else {
      this.pendingValue = html;
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouchedCallback = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (this.editorRef) {
      this.editorRef.nativeElement.contentEditable = String(!isDisabled);
    }
  }

  exec(cmd: EditorCommand): void {
    if (this.disabled) return;
    if (cmd.id === 'link') {
      const url = window.prompt('URL del enlace (https://… o /ruta-interna):');
      if (!url) return;
      document.execCommand('createLink', false, url);
    } else if (cmd.command) {
      document.execCommand(cmd.command, false, cmd.argument);
    }
    this.editorRef.nativeElement.focus();
    this.onInput();
  }

  onInput(): void {
    this.onChange(this.editorRef.nativeElement.innerHTML);
  }

  onPaste(event: ClipboardEvent): void {
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    event.preventDefault();
    if (html) {
      // Limpia etiquetas peligrosas del HTML pegado, conserva formato básico.
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,iframe,object,embed,form,meta,link').forEach((n) => n.remove());
      doc.querySelectorAll('*').forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name !== 'href') el.removeAttribute(attr.name);
        });
      });
      document.execCommand('insertHTML', false, doc.body.innerHTML);
    } else {
      document.execCommand('insertText', false, text);
    }
    this.onInput();
  }
}
