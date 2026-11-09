import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import {
  ChatConversation,
  ChatMessage,
  UserFriend,
} from '../interfaces/user.interface';

export type ChatRealtimeMode =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded';

/** Message with optimistic-send state layered on top of the API contract. */
export interface ChatMessageWithState extends ChatMessage {
  pending?: boolean;
  failed?: boolean;
}

export interface ChatTypingUser {
  userId: string;
  /** Monotonic epoch when this indicator expires (client-side timeout). */
  expiresAt: number;
}

const TYPING_TIMEOUT_MS = 4_000;

/**
 * Normalized realtime chat state.
 *
 * Single source of truth for presence, conversations, messages and typing.
 * Pure and dependency-free so it can be unit-tested without Angular mocks.
 * The service layer (ChatService) feeds it from REST + Socket.IO; components
 * subscribe to the derived observables below.
 */
@Injectable({ providedIn: 'root' })
export class ChatStateStore {
  private conversationsRaw: ChatConversation[] = [];
  private readonly conversationsSubject = new BehaviorSubject<ChatConversation[]>([]);

  /** Metadata cache for users we know (participants + online-user hydration). */
  private readonly userMetadata = new Map<string, UserFriend>();
  /** Live presence set: only users with at least one active socket. */
  private readonly onlineUserIds = new Set<string>();
  private readonly onlineUsersSubject = new BehaviorSubject<UserFriend[]>([]);
  private readonly connectedCountSubject = new BehaviorSubject<number>(0);
  private readonly realtimeModeSubject = new BehaviorSubject<ChatRealtimeMode>('idle');

  private readonly messagesByConversation = new Map<
    string,
    BehaviorSubject<ChatMessageWithState[]>
  >();

  private readonly typingByConversation = new Map<string, ChatTypingUser[]>();
  private readonly typingSubject = new BehaviorSubject<Map<string, ChatTypingUser[]>>(
    new Map()
  );

  private currentUserId: string | null = null;
  private activeConversationId: string | null = null;
  private readonly activeConversationSubject = new BehaviorSubject<string | null>(null);

  // ------------------------------------------------------------------
  // Identity / activation
  // ------------------------------------------------------------------

  setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId;
    this.recompute();
  }

  setActiveConversation(conversationId: string | null): void {
    this.activeConversationId = conversationId;
    this.activeConversationSubject.next(conversationId);
  }

  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  // ------------------------------------------------------------------
  // Realtime mode
  // ------------------------------------------------------------------

  setRealtimeMode(mode: ChatRealtimeMode): void {
    if (this.realtimeModeSubject.value !== mode) {
      this.realtimeModeSubject.next(mode);
    }
  }

  // ------------------------------------------------------------------
  // Conversations
  // ------------------------------------------------------------------

  /** Replaces the conversation list and caches participant metadata. */
  applyConversations(conversations: ChatConversation[]): void {
    this.conversationsRaw = (conversations || []).map((conv) => ({
      ...conv,
      participants: [...(conv.participants || [])],
    }));
    for (const conv of this.conversationsRaw) {
      for (const participant of conv.participants || []) {
        if (participant && participant.id && participant.id !== 'general') {
          this.userMetadata.set(participant.id, {
            ...this.userMetadata.get(participant.id),
            ...participant,
          } as UserFriend);
        }
      }
    }
    this.recompute();
  }

  /**
   * Applies a realtime conversation update (updatedAt moved). Reorders the
   * list without any HTTP traffic.
   */
  applyConversationUpdate(conversationId: string, updatedAt: string): void {
    const conv = this.findConversation(conversationId);
    if (!conv) return;
    if (updatedAt) conv.updatedAt = updatedAt;
    this.conversationsRaw.sort((a, b) => this.sortKey(b) - this.sortKey(a));
    this.recompute();
  }

  /**
   * Merges an incoming message into its conversation: message list, preview,
   * updatedAt, unread count and list ordering — all locally.
   */
  upsertMessage(
    conversationId: string,
    message: ChatMessage,
    opts: { bumpUnread?: boolean } = {}
  ): boolean {
    const subject = this.getMessagesSubject(conversationId);
    const incomingId = String(message.id || '').trim();
    const incomingClientId = String(message.clientMessageId || '').trim();

    let replaced = false;
    const merged = subject.value
      .filter((row) => {
        const rowId = String(row.id || '').trim();
        const rowClientId = String(row.clientMessageId || '').trim();
        const duplicate =
          (incomingId && rowId === incomingId) ||
          (incomingClientId && rowClientId && rowClientId === incomingClientId);
        if (duplicate) replaced = true;
        return !duplicate;
      })
      .map((row) => {
        // A pending optimistic row with the same clientMessageId is replaced.
        return row;
      });

    merged.push(message);
    merged.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    subject.next(merged);

    const conv = this.findConversation(conversationId);
    if (conv) {
      conv.lastMessage = message;
      conv.updatedAt = message.createdAt || conv.updatedAt;
      const isOwn = message.senderId === this.currentUserId;
      const isActive = conversationId === this.activeConversationId;
      if (!replaced && !isOwn && !isActive && opts.bumpUnread !== false) {
        conv.unreadCount = Math.max(0, (conv.unreadCount || 0) + 1);
      }
      this.conversationsRaw.sort((a, b) => this.sortKey(b) - this.sortKey(a));
    }
    this.recompute();
    return replaced;
  }

  /** Inserts an optimistic pending message before the server confirms it. */
  addPendingMessage(
    conversationId: string,
    pending: {
      clientMessageId: string;
      text?: string;
      type: ChatMessage['type'];
      content?: unknown;
      senderId: string;
    }
  ): void {
    const now = new Date().toISOString();
    const optimistic: ChatMessageWithState = {
      id: `pending_${pending.clientMessageId}`,
      conversationId,
      senderId: pending.senderId,
      clientMessageId: pending.clientMessageId,
      text: pending.text,
      type: pending.type,
      content: pending.content,
      createdAt: now,
      readBy: [pending.senderId],
      pending: true,
    };
    const subject = this.getMessagesSubject(conversationId);
    const existing = subject.value.some(
      (row) => row.clientMessageId === pending.clientMessageId
    );
    if (!existing) {
      subject.next([...subject.value, optimistic]);
    }
  }

  /** Marks a message as failed so the UI can offer a retry. */
  markMessageFailed(conversationId: string, clientMessageId: string): void {
    const subject = this.getMessagesSubject(conversationId);
    const updated = subject.value.map((row) =>
      row.clientMessageId === clientMessageId
        ? { ...row, pending: false, failed: true }
        : row
    );
    subject.next(updated);
  }

  /** Marks a failed message as pending again before a retry. */
  markMessageRetrying(conversationId: string, clientMessageId: string): void {
    const subject = this.getMessagesSubject(conversationId);
    const updated = subject.value.map((row) =>
      row.clientMessageId === clientMessageId
        ? { ...row, pending: true, failed: false }
        : row
    );
    subject.next(updated);
  }

  removeFailedMessage(conversationId: string, clientMessageId: string): void {
    const subject = this.getMessagesSubject(conversationId);
    subject.next(
      subject.value.filter(
        (row) => !(row.clientMessageId === clientMessageId && row.failed)
      )
    );
  }

  /**
   * Applies a server message snapshot (initial hydration or post-reconnect
   * reconciliation). Local optimistic/failed rows survive unless the server
   * snapshot already contains them.
   */
  applyServerMessages(conversationId: string, messages: ChatMessage[]): void {
    const subject = this.getMessagesSubject(conversationId);
    const serverIds = new Set(messages.map((m) => String(m.id)));
    const serverClientIds = new Set(
      messages.map((m) => String(m.clientMessageId || '')).filter(Boolean)
    );
    const keptLocal = subject.value.filter((row) => {
      if (!row.pending && !row.failed) return false;
      if (row.id && serverIds.has(row.id)) return false;
      if (row.clientMessageId && serverClientIds.has(row.clientMessageId)) {
        return false;
      }
      return true;
    });
    const merged = [...messages, ...keptLocal].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    subject.next(merged);
  }

  // ------------------------------------------------------------------
  // Read receipts
  // ------------------------------------------------------------------

  /**
   * Merges a read receipt locally: updates readBy on the reader's messages
   * and clears our unread count when WE are the reader.
   */
  applyReadUpdated(
    conversationId: string,
    readerId: string,
    readAt?: string
  ): void {
    const subject = this.getMessagesSubject(conversationId);
    const updated = subject.value.map((message) => {
      if (message.senderId !== this.currentUserId) return message;
      if (message.readBy.includes(readerId)) return message;
      return {
        ...message,
        readBy: [...message.readBy, readerId],
        readAt,
      };
    });
    subject.next(updated);

    if (readerId === this.currentUserId) {
      const conv = this.findConversation(conversationId);
      if (conv && conv.unreadCount) {
        conv.unreadCount = 0;
        this.recompute();
      }
    }
  }

  /** Optimistic local unread reset used when we mark a conversation read. */
  markConversationReadLocal(conversationId: string): void {
    const conv = this.findConversation(conversationId);
    if (conv && conv.unreadCount) {
      conv.unreadCount = 0;
      this.recompute();
    }
  }

  // ------------------------------------------------------------------
  // Presence
  // ------------------------------------------------------------------

  /** Atomically replaces the live presence set from a server snapshot. */
  applyPresenceSnapshot(onlineUserIds: string[], onlineCount?: number): void {
    this.onlineUserIds.clear();
    for (const id of onlineUserIds || []) {
      if (id && id !== this.currentUserId) this.onlineUserIds.add(id);
    }
    if (typeof onlineCount === 'number' && Number.isFinite(onlineCount)) {
      this.connectedCountSubject.next(onlineCount);
    } else {
      this.connectedCountSubject.next(this.onlineUserIds.size);
    }
    this.recompute();
  }

  /** Applies a single presence delta and returns ids we lack metadata for. */
  applyPresenceDelta(
    userId: string,
    isOnline: boolean,
    onlineCount?: number
  ): string[] {
    if (!userId || userId === this.currentUserId) return [];
    if (isOnline) {
      this.onlineUserIds.add(userId);
    } else {
      this.onlineUserIds.delete(userId);
    }
    if (typeof onlineCount === 'number' && Number.isFinite(onlineCount)) {
      this.connectedCountSubject.next(onlineCount);
    }
    this.recompute();
    if (isOnline && !this.userMetadata.has(userId)) {
      return [userId];
    }
    return [];
  }

  /**
   * Hydrates user metadata from REST payloads (initial hydration and
   * reconciliation). Online state still comes exclusively from presence.
   */
  hydrateOnlineUsers(users: UserFriend[]): void {
    for (const user of users || []) {
      if (!user?.id) continue;
      this.userMetadata.set(user.id, { ...user } as UserFriend);
    }
    this.recompute();
  }

  // ------------------------------------------------------------------
  // Typing
  // ------------------------------------------------------------------

  setTyping(conversationId: string, userId: string, isTyping: boolean): void {
    const now = Date.now();
    const entries = this.typingByConversation.get(conversationId) || [];
    const filtered = entries.filter((entry) => entry.userId !== userId);
    if (isTyping) {
      filtered.push({ userId, expiresAt: now + TYPING_TIMEOUT_MS });
    }
    if (filtered.length) {
      this.typingByConversation.set(conversationId, filtered);
    } else {
      this.typingByConversation.delete(conversationId);
    }
    this.emitTyping();
  }

  /** Removes expired typing entries; called periodically and on every event. */
  /** True while any "typing…" indicator is shown (only then is pruning worth a change detection). */
  hasTyping(): boolean {
    return this.typingByConversation.size > 0;
  }

  pruneExpiredTyping(now = Date.now()): void {
    let changed = false;
    for (const [conversationId, entries] of this.typingByConversation) {
      const kept = entries.filter((entry) => entry.expiresAt > now);
      if (kept.length !== entries.length) {
        changed = true;
        if (kept.length) {
          this.typingByConversation.set(conversationId, kept);
        } else {
          this.typingByConversation.delete(conversationId);
        }
      }
    }
    if (changed) this.emitTyping();
  }

  // ------------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------------

  reset(): void {
    this.conversationsRaw = [];
    this.onlineUserIds.clear();
    this.userMetadata.clear();
    this.typingByConversation.clear();
    this.messagesByConversation.clear();
    this.conversationsSubject.next([]);
    this.onlineUsersSubject.next([]);
    this.connectedCountSubject.next(0);
    this.realtimeModeSubject.next('idle');
    this.activeConversationId = null;
    this.activeConversationSubject.next(null);
    this.typingSubject.next(new Map());
  }

  // ------------------------------------------------------------------
  // Selectors
  // ------------------------------------------------------------------

  getConversations(): Observable<ChatConversation[]> {
    return this.conversationsSubject.asObservable();
  }

  getConversationsValue(): ChatConversation[] {
    return this.conversationsSubject.value;
  }

  /** Online users: metadata ∩ live presence, excluding the current user. */
  getOnlineUsers(): Observable<UserFriend[]> {
    return this.onlineUsersSubject.asObservable();
  }

  getConnectedCount(): Observable<number> {
    return this.connectedCountSubject.asObservable();
  }

  getRealtimeMode(): Observable<ChatRealtimeMode> {
    return this.realtimeModeSubject.asObservable();
  }

  getActiveConversationId$(): Observable<string | null> {
    return this.activeConversationSubject.asObservable();
  }

  getMessages(conversationId: string): Observable<ChatMessageWithState[]> {
    return this.getMessagesSubject(conversationId).asObservable();
  }

  getTyping(conversationId: string): Observable<ChatTypingUser[]> {
    return this.typingSubject.pipe(
      map((map) => map.get(conversationId) || []),
      distinctUntilChanged(
        (a, b) =>
          a.length === b.length &&
          a.every((entry, index) => entry.userId === b[index].userId)
      )
    );
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private getMessagesSubject(
    conversationId: string
  ): BehaviorSubject<ChatMessageWithState[]> {
    const key = String(conversationId || '').trim();
    if (!this.messagesByConversation.has(key)) {
      this.messagesByConversation.set(
        key,
        new BehaviorSubject<ChatMessageWithState[]>([])
      );
    }
    return this.messagesByConversation.get(key)!;
  }

  private findConversation(conversationId: string): ChatConversation | null {
    return (
      this.conversationsRaw.find((conv) => conv.id === conversationId) || null
    );
  }

  private sortKey(conversation: ChatConversation): number {
    return new Date(
      conversation.updatedAt || conversation.lastMessage?.createdAt || 0
    ).getTime();
  }

  /** Re-emits all derived state after any mutation. */
  private recompute(): void {
    const overlays = this.conversationsRaw.map((conv) => ({
      ...conv,
      participants: conv.participants.map((participant) => {
        if (participant.id === 'general') return participant;
        return {
          ...participant,
          isOnline: this.onlineUserIds.has(participant.id),
        };
      }),
    }));
    this.conversationsSubject.next(overlays);

    const onlineUsers: UserFriend[] = [];
    for (const userId of this.onlineUserIds) {
      const metadata = this.userMetadata.get(userId);
      if (!metadata) continue;
      onlineUsers.push({ ...metadata, isOnline: true });
    }
    onlineUsers.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    this.onlineUsersSubject.next(onlineUsers);
  }

  private emitTyping(): void {
    this.typingSubject.next(new Map(this.typingByConversation));
  }
}
