import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  OnChanges,
  OnInit,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ChatConversation,
  UserFriend,
} from '../../../interfaces/user.interface';
import { ChatService } from '../../../services/chat.service';
import {
  ChatMessageWithState,
  ChatRealtimeMode,
  ChatTypingUser,
} from '../../../services/chat-state.store';
import { UserService } from '../../../services/user.service';

interface ChatWindowState {
  conversationId: string;
  draft: string;
  messages: ChatMessageWithState[];
}

@Component({
  selector: 'app-social-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Active conversation view -->
    <ng-container *ngIf="activeWindow; else listView">
      <div class="flex h-full flex-col">
        <!-- Conversation header -->
        <div class="flex items-center gap-2 border-b border-[var(--portal-border)] px-4 py-2.5">
          <button
            type="button"
            (click)="closeActiveWindow()"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--portal-text-muted)] hover:bg-[var(--portal-surface-strong)] hover:text-[var(--portal-text)]"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-[var(--portal-text)]">{{ getWindowTitle(activeWindow.conversationId) }}</p>
            <p class="text-[10px] text-[var(--portal-text-muted)]">{{ getConversationStatus(activeWindow.conversationId) }}</p>
          </div>
          <span *ngIf="connectionLabel" class="shrink-0 text-[10px]" [ngClass]="connectionLabelClass">{{ connectionLabel }}</span>
        </div>

        <!-- Typing indicator -->
        <div
          *ngIf="typingText"
          class="flex items-center gap-2 border-b border-[var(--portal-border)] bg-[var(--portal-surface-soft)] px-4 py-1.5"
        >
          <span class="flex gap-0.5">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </span>
          <p class="text-[10px] text-[var(--portal-text-muted)]">{{ typingText }} está escribiendo…</p>
        </div>

        <!-- Messages -->
        <div class="flex-1 overflow-y-auto px-4 py-3 space-y-2 [overscroll-behavior-y:contain]">
          <div
            *ngFor="let msg of activeWindow.messages.slice(-50); trackBy: trackByMessage"
            class="flex"
            [ngClass]="msg.senderId === currentUserId ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-2xl px-3 py-2 text-xs"
              [ngClass]="bubbleClasses(msg)"
            >
              <p *ngIf="msg.senderId !== currentUserId && isGroupConversation(activeWindow.conversationId)"
                 class="mb-0.5 text-[10px] font-semibold text-[var(--accent-live)]">{{ getSenderName(msg.senderId) }}</p>
              <p class="break-words leading-relaxed">{{ msg.text || 'Adjunto' }}</p>
              <p class="mt-1 text-[10px] opacity-60">{{ msg.createdAt | date: 'shortTime' }}</p>
              <div *ngIf="msg.failed" class="mt-1 flex items-center gap-2">
                <p class="text-[10px] text-[var(--assistant-danger)]">No enviado</p>
                <button
                  type="button"
                  (click)="retryMessage(msg)"
                  class="rounded-md border border-[var(--assistant-danger)]/50 px-2 py-0.5 text-[10px] text-[var(--assistant-danger)] hover:bg-[var(--assistant-danger-soft)]"
                >Reintentar</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Input -->
        <div class="border-t border-[var(--portal-border)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div class="flex items-center gap-2">
            <input
              type="text"
              [(ngModel)]="activeWindow.draft"
              (ngModelChange)="onDraftChange()"
              (keydown.enter)="sendMessage()"
              placeholder="Escribe un mensaje..."
              class="flex-1 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface)] px-3 py-2 text-sm text-[var(--portal-text)] placeholder:text-[var(--portal-text-faint)] focus:border-[var(--accent-live)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--accent-live)]/30"
            />
            <button
              type="button"
              (click)="sendMessage()"
              [disabled]="!activeWindow.draft?.trim()"
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--section-accent)] text-[var(--section-accent-ink)] transition-colors hover:opacity-90 disabled:opacity-40"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </ng-container>

    <!-- Conversations/users list view -->
    <ng-template #listView>
      <div class="flex h-full flex-col overflow-y-auto">
        <!-- Connection status -->
        <div *ngIf="connectionLabel" class="px-4 pt-3">
          <div
            class="rounded-xl border px-3 py-1.5 text-center text-[10px]"
            [ngClass]="connectionLabelClass"
          >{{ connectionLabel }}</div>
        </div>

        <!-- General chat button -->
        <div class="px-4 pt-4 pb-2">
          <button
            type="button"
            (click)="openGeneralChat()"
            class="flex w-full items-center gap-3 rounded-2xl border border-transparent bg-[var(--accent-live-soft)] px-4 py-3 text-left transition-colors hover:opacity-90"
          >
            <span class="relative flex h-3 w-3">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-live)] opacity-75"></span>
              <span class="relative inline-flex h-3 w-3 rounded-full bg-[var(--accent-live)]"></span>
            </span>
            <span class="flex-1 text-sm font-semibold text-[var(--portal-text)]">Chat general</span>
            <span class="text-xs text-[var(--accent-live)]">{{ connectedUsersCount }} online</span>
          </button>
        </div>

        <!-- Conversations -->
        <div class="px-4 pt-2 pb-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[var(--portal-text-muted)]">Conversaciones</p>
        </div>

        <div *ngIf="isLoadingConversations" class="space-y-2 px-4">
          <div *ngFor="let i of [1,2,3]" class="h-14 animate-pulse rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)]"></div>
        </div>

        <div *ngIf="!isLoadingConversations && conversations.length" class="space-y-1 px-4">
          <button
            type="button"
            *ngFor="let conv of conversations; trackBy: trackByConversation"
            class="w-full rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--portal-surface-strong)]"
            (click)="openConversation(conv)"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-xs font-medium text-[var(--portal-text)]">{{ getConversationTitle(conv) }}</p>
              <span
                *ngIf="conv.unreadCount"
                class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--section-accent)] px-1 text-[10px] text-[var(--section-accent-ink)]"
              >{{ conv.unreadCount }}</span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-[var(--portal-text-muted)]">
              <span *ngIf="conv.lastMessage?.senderId === currentUserId">Tú: </span>
              {{ conv.lastMessage?.text || 'Sin mensajes' }}
            </p>
          </button>
        </div>

        <p *ngIf="!isLoadingConversations && !conversations.length"
           class="mx-4 mt-1 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)] px-3 py-2 text-xs text-[var(--portal-text-muted)]">
          No hay conversaciones.
        </p>

        <!-- Online users (live socket presence only) -->
        <div class="px-4 pt-4 pb-1 flex items-center justify-between">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-[var(--portal-text-muted)]">Conectados ahora</p>
          <span class="text-[10px] text-[var(--portal-text-faint)]">{{ connectedUsersCount }} en línea</span>
        </div>

        <div *ngIf="isLoadingOnlineUsers" class="space-y-2 px-4">
          <div *ngFor="let i of [1,2,3]" class="h-12 animate-pulse rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)]"></div>
        </div>

        <div *ngIf="!isLoadingOnlineUsers && onlineUsers.length" class="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 px-4 pb-4">
          <button
            type="button"
            *ngFor="let user of onlineUsers; trackBy: trackByUser"
            class="flex w-full items-center gap-3 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--portal-surface-strong)]"
            (click)="openOrCreateConversationWithUser(user)"
          >
            <div class="relative flex-shrink-0">
              <img *ngIf="user.avatar" [src]="user.avatar" class="h-8 w-8 rounded-lg bg-[var(--portal-surface-strong)] object-cover" alt="" />
              <div *ngIf="!user.avatar" class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--portal-surface-strong)] text-[10px] font-bold text-[var(--portal-text)]">
                {{ user.name?.slice(0, 2)?.toUpperCase() }}
              </div>
              <span
                class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--portal-card)]"
                [ngClass]="user.isOnline ? 'bg-[var(--accent-streaming)]' : 'bg-[var(--portal-border-strong)]'"
              ></span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-medium text-[var(--portal-text)]">{{ user.name }}</p>
              <p class="truncate text-[10px] text-[var(--portal-text-muted)]">{{ user.isOnline ? 'En línea' : user.lastActivity }}</p>
            </div>
          </button>
        </div>

        <p *ngIf="!isLoadingOnlineUsers && !onlineUsers.length"
           class="mx-4 mt-1 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface-soft)] px-3 py-2 text-xs text-[var(--portal-text-muted)]">
          Nadie conectado ahora.
        </p>
      </div>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      height: 100%;
    }
    .typing-dot {
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--portal-text-muted);
      animation: typing-bounce 1.2s infinite cubic-bezier(0.16, 1, 0.3, 1);
    }
    .typing-dot:nth-child(2) { animation-delay: 0.15s; }
    .typing-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes typing-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-3px); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .typing-dot { animation: none; opacity: 0.8; }
    }
  `],
})
export class SocialChatPanelComponent implements OnInit, OnChanges, OnDestroy {
  /** Set by the shell when a notification asks to open a conversation. */
  @Input() targetUser: { userId: string; nonce: number } | null = null;

  conversations: ChatConversation[] = [];
  onlineUsers: UserFriend[] = [];
  connectedUsersCount = 0;
  currentUserId: string | null = null;
  isLoadingConversations = false;
  isLoadingOnlineUsers = false;
  activeWindow: ChatWindowState | null = null;
  typingUsers: ChatTypingUser[] = [];
  connectionMode: ChatRealtimeMode = 'idle';

  private readonly sub = new Subscription();
  private readonly messageSubs = new Map<string, Subscription>();
  private typingSub: Subscription | null = null;
  private typingStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.userService.getProfile().subscribe((profile) => {
        this.currentUserId = profile?.id || null;
        this.cdr.markForCheck();
      })
    );

    this.isLoadingConversations = true;
    this.isLoadingOnlineUsers = true;

    this.sub.add(
      this.chatService.getConversations().subscribe((conversations) => {
        this.conversations = conversations;
        this.isLoadingConversations = false;
        this.cdr.markForCheck();
      })
    );

    this.sub.add(
      this.chatService.getOnlineUsers().subscribe((users) => {
        this.onlineUsers = users;
        this.isLoadingOnlineUsers = false;
        this.cdr.markForCheck();
      })
    );

    this.sub.add(
      this.chatService.getConnectedUsersCount().subscribe((count) => {
        this.connectedUsersCount = Number.isFinite(count) && count >= 0 ? count : 0;
        this.cdr.markForCheck();
      })
    );

    this.sub.add(
      this.chatService.getRealtimeMode().subscribe((mode) => {
        this.connectionMode = mode;
        this.cdr.markForCheck();
      })
    );

    // Post-reconnect reconciliation: refetch the open conversation's history.
    this.sub.add(
      this.chatService.reconnected$.subscribe(() => {
        if (this.activeWindow) {
          this.refetchActiveMessages();
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.clearTypingStopTimer();
    if (this.activeWindow) {
      this.chatService.sendTyping(this.activeWindow.conversationId, false);
      this.chatService.setActiveConversation(null);
    }
    this.typingSub?.unsubscribe();
    this.messageSubs.forEach((s) => s.unsubscribe());
    this.sub.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const target = changes['targetUser']?.currentValue as
      | { userId: string; nonce: number }
      | null
      | undefined;
    if (target?.userId) {
      this.openChatWithUserById(target.userId);
    }
  }

  /** Opens (or creates) the conversation with a user id from a notification. */
  private openChatWithUserById(userId: string): void {
    if (!userId || userId === this.currentUserId) return;
    const existing = this.conversations.find(
      (c) => !c.isGroup && c.participants?.some((p) => p.id === userId)
    );
    if (existing) {
      this.openConversation(existing);
      return;
    }
    // Conversations may not be hydrated yet: refresh once, then fall back to
    // creating the conversation.
    this.chatService.refreshConversations().subscribe((convs) => {
      const found = convs.find(
        (c) => !c.isGroup && c.participants?.some((p) => p.id === userId)
      );
      if (found) {
        this.openConversation(found);
        return;
      }
      this.openNewConversationWithUser(userId);
    });
  }

  private openNewConversationWithUser(userId: string): void {
    this.chatService.createConversation(userId).subscribe((result) => {
      if (result?.ok && result.conversation) {
        this.openConversationResult(result.conversation);
      }
    });
  }

  private openConversationResult(conversation: ChatConversation): void {
    this.activeWindow = {
      conversationId: conversation.id,
      draft: '',
      messages: [],
    };
    this.chatService.setActiveConversation(conversation.id);
    this.subscribeToMessages(conversation.id);
    this.subscribeToTyping(conversation.id);
    this.chatService.refreshConversations().subscribe((convs) => {
      this.conversations = convs;
      this.cdr.markForCheck();
    });
  }

  get connectionLabel(): string | null {
    switch (this.connectionMode) {
      case 'connecting':
        return 'Conectando…';
      case 'reconnecting':
        return 'Reconectando…';
      case 'degraded':
        return 'Sin conexión en tiempo real';
      default:
        return null;
    }
  }

  get connectionLabelClass(): string {
    switch (this.connectionMode) {
      case 'connecting':
      case 'reconnecting':
        return 'border-[color-mix(in_oklch,var(--accent-sports)_40%,transparent)] bg-[var(--accent-sports-soft)] text-[var(--accent-sports)]';
      case 'degraded':
        return 'border-[color-mix(in_oklch,var(--status-live)_40%,transparent)] bg-[var(--status-live-soft)] text-[var(--status-live)]';
      default:
        return '';
    }
  }

  get typingText(): string | null {
    if (!this.activeWindow || !this.typingUsers.length) return null;
    const other = this.typingUsers.find(
      (entry) => entry.userId !== this.currentUserId
    );
    if (!other) return null;
    return this.getSenderName(other.userId);
  }

  bubbleClasses(msg: ChatMessageWithState): Record<string, boolean> {
    const classes: Record<string, boolean> = {};
    if (msg.senderId === this.currentUserId) {
      classes['bg-[var(--accent-live-strong)]'] = true;
      classes['text-white'] = true;
      classes['opacity-60'] = Boolean(msg.pending);
    } else {
      classes['border'] = true;
      classes['border-[var(--portal-border)]'] = true;
      classes['bg-[var(--portal-surface)]'] = true;
      classes['text-[var(--portal-text)]'] = true;
      classes['opacity-60'] = Boolean(msg.pending);
    }
    if (msg.failed) {
      classes['border-[color-mix(in_oklch,var(--status-live)_40%,transparent)]'] = true;
    }
    return classes;
  }

  openGeneralChat(): void {
    const general = this.findGeneralConversation();
    if (general) {
      this.openConversation(general);
      return;
    }
    this.chatService.refreshConversations().subscribe((convs) => {
      this.conversations = convs;
      const g = this.findGeneralConversation();
      if (g) this.openConversation(g);
      this.cdr.markForCheck();
    });
  }

  openConversation(conv: ChatConversation): void {
    this.closeActiveWindow(false);
    this.activeWindow = {
      conversationId: conv.id,
      draft: '',
      messages: [],
    };
    this.chatService.setActiveConversation(conv.id);
    this.subscribeToMessages(conv.id);
    this.subscribeToTyping(conv.id);
    this.cdr.markForCheck();
  }

  openOrCreateConversationWithUser(user: UserFriend): void {
    const existing = this.conversations.find(
      (c) => !c.isGroup && c.participants?.some((p) => p.id === user.id)
    );
    if (existing) {
      this.openConversation(existing);
      return;
    }
    this.chatService.createConversation(user.id).subscribe((result) => {
      if (result?.ok && result.conversation) {
        this.openConversationResult(result.conversation);
      }
    });
  }

  closeActiveWindow(notify = true): void {
    if (this.activeWindow) {
      const sub = this.messageSubs.get(this.activeWindow.conversationId);
      if (sub) {
        sub.unsubscribe();
        this.messageSubs.delete(this.activeWindow.conversationId);
      }
      if (notify) {
        this.chatService.sendTyping(this.activeWindow.conversationId, false);
      }
    }
    this.typingSub?.unsubscribe();
    this.typingSub = null;
    this.typingUsers = [];
    if (this.activeWindow) {
      this.chatService.setActiveConversation(null);
    }
    this.activeWindow = null;
    this.cdr.markForCheck();
  }

  onDraftChange(): void {
    if (!this.activeWindow) return;
    const conversationId = this.activeWindow.conversationId;
    this.chatService.sendTyping(conversationId, true);
    this.clearTypingStopTimer();
    this.typingStopTimer = setTimeout(() => {
      this.chatService.sendTyping(conversationId, false);
      this.typingStopTimer = null;
    }, 3_000);
  }

  sendMessage(): void {
    if (!this.activeWindow?.draft?.trim()) return;
    const text = this.activeWindow.draft.trim();
    const conversationId = this.activeWindow.conversationId;
    this.activeWindow.draft = '';
    this.clearTypingStopTimer();
    this.chatService.sendTyping(conversationId, false);
    this.chatService.sendMessage(conversationId, text).subscribe();
  }

  retryMessage(message: ChatMessageWithState): void {
    if (!this.activeWindow) return;
    this.chatService
      .retryMessage(this.activeWindow.conversationId, message)
      .subscribe();
  }

  getWindowTitle(conversationId: string): string {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return 'Chat';
    if (this.isGeneralConversation(conv)) return 'Chat general';
    const other = conv.participants?.find((p) => p.id !== this.currentUserId);
    return other?.name || conv.groupName || 'Chat';
  }

  getConversationTitle(conv: ChatConversation): string {
    if (this.isGeneralConversation(conv)) return 'Chat general';
    const other = conv.participants?.find((p) => p.id !== this.currentUserId);
    return other?.name || conv.groupName || 'Chat';
  }

  getConversationStatus(conversationId: string): string {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return '';
    if (this.isGeneralConversation(conv)) return `${this.connectedUsersCount} conectados`;
    const other = conv.participants?.find((p) => p.id !== this.currentUserId);
    return other?.isOnline ? 'En línea' : 'Desconectado';
  }

  isGroupConversation(conversationId: string): boolean {
    const conv = this.conversations.find((c) => c.id === conversationId);
    return !!conv?.isGroup;
  }

  getSenderName(senderId: string): string {
    for (const conv of this.conversations) {
      const p = conv.participants?.find((u) => u.id === senderId);
      if (p) return p.name;
    }
    return 'Usuario';
  }

  trackByMessage(_: number, msg: ChatMessageWithState): string {
    return msg.id || msg.clientMessageId || msg.createdAt?.toString() || String(_);
  }

  trackByConversation(_: number, conv: ChatConversation): string {
    return conv.id;
  }

  trackByUser(_: number, user: UserFriend): string {
    return user.id;
  }

  private isGeneralConversation(conv: ChatConversation | null): boolean {
    if (!conv) return false;
    if (conv.groupName?.toLowerCase() === 'chat general') return true;
    return conv.participants?.[0]?.id === 'general';
  }

  private findGeneralConversation(): ChatConversation | null {
    return this.conversations.find((c) => this.isGeneralConversation(c)) || null;
  }

  private subscribeToMessages(conversationId: string): void {
    const existing = this.messageSubs.get(conversationId);
    if (existing) existing.unsubscribe();

    const sub = this.chatService.getMessages(conversationId).subscribe((messages) => {
      if (this.activeWindow?.conversationId === conversationId) {
        this.activeWindow.messages = messages;
        this.cdr.markForCheck();
      }
    });
    this.messageSubs.set(conversationId, sub);
  }

  private subscribeToTyping(conversationId: string): void {
    this.typingSub?.unsubscribe();
    this.typingUsers = [];
    this.typingSub = this.chatService
      .getTyping(conversationId)
      .subscribe((users) => {
        this.typingUsers = users;
        this.cdr.markForCheck();
      });
  }

  private refetchActiveMessages(): void {
    if (!this.activeWindow) return;
    this.chatService.getMessages(this.activeWindow.conversationId).subscribe();
    this.chatService.setActiveConversation(this.activeWindow.conversationId);
  }

  private clearTypingStopTimer(): void {
    if (this.typingStopTimer) {
      clearTimeout(this.typingStopTimer);
      this.typingStopTimer = null;
    }
  }
}
