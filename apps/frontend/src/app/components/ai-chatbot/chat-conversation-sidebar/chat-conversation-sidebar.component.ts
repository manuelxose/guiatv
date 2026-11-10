import {
  Component,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConversationSummary } from '../../../interfaces/chatbot.interface';

@Component({
  selector: 'app-chat-conversation-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Backdrop (mobile) -->
    <button
      type="button"
      class="absolute inset-0 bg-black/50 backdrop-blur-sm z-[var(--z-dropdown)]"
      (click)="close.emit()"
      tabindex="-1"
      aria-label="Cerrar panel de conversaciones"
    ></button>

    <!-- Sidebar panel -->
    <div
      class="absolute top-0 left-0 bottom-0 z-[var(--z-drawer)]
             w-full md:w-[min(340px,78%)] bg-[var(--portal-bg-elevated)]
             border-r border-[var(--portal-border)]
             flex flex-col shadow-xl overscroll-contain"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-[var(--portal-border)]">
        <div>
          <h2 class="text-base font-bold text-[var(--portal-text)]">Conversaciones</h2>
          <p class="text-xs text-[var(--portal-text-muted)]">Recupera y organiza tus chats</p>
        </div>
        <div class="flex items-center gap-1">
          <button
            (click)="onNewConversation()"
            class="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--portal-text-muted)] hover:text-[var(--accent-live)] hover:bg-[var(--accent-live-soft)] transition-colors"
            aria-label="Nueva conversación"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
          </button>
          <button
            (click)="close.emit()"
            class="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--portal-text-muted)] hover:text-[var(--portal-text)] hover:bg-[var(--portal-surface-strong)] transition-colors"
            aria-label="Cerrar conversaciones"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Search -->
      <div class="px-3 py-3 border-b border-[var(--portal-border)]/60">
        <div class="relative">
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--portal-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            placeholder="Buscar conversaciones…"
            aria-label="Buscar conversaciones"
            class="h-11 w-full pl-9 pr-3 text-sm rounded-xl border border-[var(--portal-border)]
                   bg-[var(--portal-bg)] text-[var(--portal-text)]
                   placeholder:text-[var(--portal-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-live)]/50 focus:border-[var(--accent-live)]/50"
          />
        </div>
      </div>

      <!-- Conversation list -->
      <div class="flex-1 overflow-y-auto">
        <!-- Pinned section -->
        @if (pinnedList.length > 0) {
          <div class="px-3 pt-2 pb-1">
            <button
              (click)="pinnedCollapsed.set(!pinnedCollapsed())"
              class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--portal-text-muted)] hover:text-[var(--portal-text)]"
            >
              <svg class="w-3 h-3 transition-transform" [class.rotate-90]="!pinnedCollapsed()" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
              <svg class="w-3 h-3 text-[var(--status-warning)]" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
              Fijadas
            </button>
          </div>
          @if (!pinnedCollapsed()) {
            @for (conv of pinnedList; track conv.conversationId) {
              <ng-container *ngTemplateOutlet="conversationItem; context: { $implicit: conv }"></ng-container>
            }
          }
        }

        <!-- Recent section -->
        @if (recentList.length > 0) {
          <div class="px-3 pt-2 pb-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--portal-text-muted)]">Recientes</span>
          </div>
          @for (conv of recentList; track conv.conversationId) {
            <ng-container *ngTemplateOutlet="conversationItem; context: { $implicit: conv }"></ng-container>
          }
        }

        <!-- Archived section -->
        @if (archivedList.length > 0) {
          <div class="px-3 pt-2 pb-1">
            <button
              (click)="archivedCollapsed.set(!archivedCollapsed())"
              class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--portal-text-muted)] hover:text-[var(--portal-text)]"
            >
              <svg class="w-3 h-3 transition-transform" [class.rotate-90]="!archivedCollapsed()" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
              <svg class="w-3 h-3 text-[var(--portal-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8"/>
              </svg>
              Archivadas
            </button>
          </div>
          @if (!archivedCollapsed()) {
            @for (conv of archivedList; track conv.conversationId) {
              <ng-container *ngTemplateOutlet="conversationItem; context: { $implicit: conv }"></ng-container>
            }
          }
        }

        <!-- Empty state -->
        @if (displayList.length === 0) {
          <div class="flex flex-col items-center justify-center py-12 text-[var(--portal-text-muted)]">
            <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
            </svg>
            <span class="text-xs">{{ searchQuery ? 'Sin resultados' : 'Sin conversaciones' }}</span>
          </div>
        }
      </div>
    </div>

    <!-- Conversation item template -->
    <ng-template #conversationItem let-conv>
      <article
        class="mx-2 mb-1 overflow-hidden rounded-xl border border-transparent transition-colors"
        [ngClass]="conv.conversationId === activeConversationId
          ? 'border-[var(--assistant-list-active-border)] bg-[var(--assistant-list-active-bg)]'
          : 'hover:bg-[var(--portal-surface-strong)]'"
      >
        <div class="flex min-h-[68px] items-stretch">
          <button
            type="button"
            (click)="onSelect(conv)"
            class="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--guide-accent)]"
            [attr.aria-current]="conv.conversationId === activeConversationId ? 'true' : null"
          >
            <span class="block truncate text-sm font-semibold text-[var(--portal-text)]">{{ conv.sessionTitle }}</span>
            <span class="mt-1 flex items-center gap-2 text-xs text-[var(--portal-text-muted)]">
              <span>{{ formatRelativeTime(conv.lastUsedAt) }}</span>
              @if (conv.messageCount > 0) { <span>· {{ conv.messageCount }} mensajes</span> }
            </span>
            @if (conv.lastMessage) {
              <span class="mt-1 block truncate text-xs text-[var(--portal-text-soft)]">{{ conv.lastMessage }}</span>
            }
          </button>
          <button
            type="button"
            (click)="toggleActions(conv.conversationId)"
            class="m-2 flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-xl text-[var(--portal-text-muted)] hover:bg-[var(--portal-bg-elevated)] hover:text-[var(--portal-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--guide-accent)]"
            [attr.aria-label]="'Acciones de ' + conv.sessionTitle"
            [attr.aria-expanded]="actionsId() === conv.conversationId"
          >
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/></svg>
          </button>
        </div>

        @if (actionsId() === conv.conversationId) {
          <div class="border-t border-[var(--portal-border)] bg-[var(--assistant-action-bg)] p-2" [attr.aria-label]="'Opciones de ' + conv.sessionTitle">
            @if (editingId() === conv.conversationId) {
              <label class="block text-xs font-semibold text-[var(--portal-text)]" [for]="'rename-' + conv.conversationId">Nuevo nombre</label>
              <input
                [id]="'rename-' + conv.conversationId"
                type="text"
                [value]="conv.sessionTitle"
                (keydown.enter)="onRenameConfirm($event, conv)"
                (keydown.escape)="cancelActions()"
                class="mt-1 h-11 w-full rounded-xl border border-[var(--portal-border-strong)] bg-[var(--portal-bg-elevated)] px-3 text-sm text-[var(--portal-text)] focus:outline-none focus:ring-2 focus:ring-[var(--guide-accent)]"
              />
              <div class="mt-2 grid grid-cols-2 gap-2">
                <button type="button" (click)="cancelActions()" class="min-h-11 rounded-xl border border-[var(--portal-border)] text-sm font-semibold text-[var(--portal-text)]">Cancelar</button>
                <button type="button" (click)="onRenameFromButton(conv)" class="min-h-11 rounded-xl bg-[var(--section-accent)] text-sm font-semibold text-[var(--section-accent-ink)]">Guardar</button>
              </div>
            } @else if (deleteConfirmId() === conv.conversationId) {
              <p class="px-1 text-sm font-semibold text-[var(--portal-text)]">¿Eliminar esta conversación?</p>
              <p class="px-1 pt-1 text-xs text-[var(--portal-text-muted)]">Esta acción no se puede deshacer.</p>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <button type="button" (click)="deleteConfirmId.set(null)" class="min-h-11 rounded-xl border border-[var(--portal-border)] text-sm font-semibold text-[var(--portal-text)]">Cancelar</button>
                <button type="button" (click)="confirmDelete(conv)" class="min-h-11 rounded-xl bg-[var(--assistant-danger)] text-sm font-semibold text-white">Eliminar</button>
              </div>
            } @else {
              <div class="grid grid-cols-2 gap-1.5">
                <button type="button" (click)="onTogglePin(conv)" class="min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-[var(--portal-text)] hover:bg-[var(--portal-surface-strong)]">{{ conv.pinned ? 'Desfijar' : 'Fijar' }}</button>
                <button type="button" (click)="editingId.set(conv.conversationId)" class="min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-[var(--portal-text)] hover:bg-[var(--portal-surface-strong)]">Renombrar</button>
                <button type="button" (click)="onToggleArchive(conv)" class="min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-[var(--portal-text)] hover:bg-[var(--portal-surface-strong)]">{{ conv.archived ? 'Desarchivar' : 'Archivar' }}</button>
                <button type="button" (click)="deleteConfirmId.set(conv.conversationId)" class="min-h-11 rounded-xl px-3 text-left text-sm font-semibold text-[var(--assistant-danger)] hover:bg-[var(--assistant-danger-soft)]">Eliminar…</button>
              </div>
            }
          </div>
        }
      </article>
    </ng-template>
  `,
})
export class ChatConversationSidebarComponent {
  @Input() conversations: ConversationSummary[] = [];
  @Input() activeConversationId: string | null = null;

  @Output() selectConversation = new EventEmitter<string>();
  @Output() newConversation = new EventEmitter<void>();
  @Output() updateConversationEvent = new EventEmitter<{
    conversationId: string;
    updates: { sessionTitle?: string; pinned?: boolean; archived?: boolean };
  }>();
  @Output() deleteConversationEvent = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();
  @Output() search = new EventEmitter<string>();

  searchQuery = '';
  editingId = signal<string | null>(null);
  actionsId = signal<string | null>(null);
  deleteConfirmId = signal<string | null>(null);
  pinnedCollapsed = signal(false);
  archivedCollapsed = signal(true);

  get displayList(): ConversationSummary[] {
    return [...this.pinnedList, ...this.recentList, ...this.archivedList];
  }

  get pinnedList(): ConversationSummary[] {
    return (this.conversations || []).filter((c) => c.pinned && !c.archived);
  }

  get recentList(): ConversationSummary[] {
    return (this.conversations || []).filter((c) => !c.pinned && !c.archived);
  }

  get archivedList(): ConversationSummary[] {
    return (this.conversations || []).filter((c) => c.archived);
  }

  onSearchChange(query: string): void {
    this.search.emit(query);
  }

  onSelect(conv: ConversationSummary): void {
    if (this.editingId() || this.deleteConfirmId()) return;
    this.selectConversation.emit(conv.conversationId);
  }

  onNewConversation(): void {
    this.newConversation.emit();
    this.close.emit();
  }

  onTogglePin(conv: ConversationSummary): void {
    this.updateConversationEvent.emit({
      conversationId: conv.conversationId,
      updates: { pinned: !conv.pinned },
    });
    this.actionsId.set(null);
  }

  onToggleArchive(conv: ConversationSummary): void {
    this.updateConversationEvent.emit({
      conversationId: conv.conversationId,
      updates: { archived: !conv.archived },
    });
    this.actionsId.set(null);
  }

  onRenameConfirm(event: Event, conv: ConversationSummary): void {
    const input = event.target as HTMLInputElement;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== conv.sessionTitle) {
      this.updateConversationEvent.emit({
        conversationId: conv.conversationId,
        updates: { sessionTitle: newTitle },
      });
    }
    this.editingId.set(null);
  }

  onDelete(conv: ConversationSummary): void {
    this.deleteConversationEvent.emit(conv.conversationId);
  }

  toggleActions(conversationId: string): void {
    const isOpen = this.actionsId() === conversationId;
    this.actionsId.set(isOpen ? null : conversationId);
    this.editingId.set(null);
    this.deleteConfirmId.set(null);
  }

  cancelActions(): void {
    this.editingId.set(null);
    this.deleteConfirmId.set(null);
    this.actionsId.set(null);
  }

  onRenameFromButton(conv: ConversationSummary): void {
    const input = document.getElementById(`rename-${conv.conversationId}`) as HTMLInputElement | null;
    if (input) this.onRenameConfirm({ target: input } as unknown as Event, conv);
    this.actionsId.set(null);
  }

  confirmDelete(conv: ConversationSummary): void {
    this.onDelete(conv);
    this.cancelActions();
  }

  onContextMenu(event: MouseEvent, conv: ConversationSummary): void {
    event.preventDefault();
    this.toggleActions(conv.conversationId);
  }

  formatRelativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `hace ${days}d`;
    return new Date(isoDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
}
