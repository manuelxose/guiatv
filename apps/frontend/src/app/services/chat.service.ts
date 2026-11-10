import {
  ApplicationRef,
  Inject,
  Injectable,
  InjectionToken,
  NgZone,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { ChatConversation, ChatMessage, UserFriend } from '../interfaces/user.interface';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
import {
  ChatStateStore,
  ChatMessageWithState,
  ChatRealtimeMode,
} from './chat-state.store';
import type { Socket } from 'socket.io-client';

export type { ChatRealtimeMode, ChatMessageWithState } from './chat-state.store';

/** Test seam: lets specs provide a fake socket.io client. */
export type ChatSocketFactory = () => Promise<typeof import('socket.io-client')>;

export const CHAT_SOCKET_FACTORY = new InjectionToken<ChatSocketFactory>(
  'CHAT_SOCKET_FACTORY',
  {
    providedIn: 'root',
    factory: () => () => import('socket.io-client'),
  }
);

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

interface OnlineUsersPayload {
  users: UserFriend[];
  onlineUserIds?: string[];
  connectedUsersNow?: number;
}

// ---------------------------------------------------------------------------
// Realtime lifecycle tuning. WebSocket is preferred because the production
// proxy supports upgrades; polling remains an automatic fallback and is never
// the normal path. Reconnection is infinite with exponential backoff + jitter
// while the authenticated session is valid.
// ---------------------------------------------------------------------------
const RECONNECTION_ATTEMPTS = Infinity;
const RECONNECTION_DELAY_MS = 500;
const RECONNECTION_DELAY_MAX_MS = 15_000;
const RECONNECTION_JITTER = 0.5;
const SOCKET_TIMEOUT_MS = 10_000;
const FALLBACK_POLL_INTERVAL_MS = 15_000;
const METADATA_HYDRATE_THROTTLE_MS = 10_000;
const TYPING_CLIENT_THROTTLE_MS = 2_500;
const DEGRADED_ERROR_THRESHOLD = 5;
const TYPING_PRUNE_INTERVAL_MS = 5_000;

export type ChatConversationCreateReason =
  | 'blocked'
  | 'forbidden'
  | 'not_found'
  | 'unauthorized'
  | 'unknown';

export interface ChatConversationCreateResult {
  ok: boolean;
  conversation?: ChatConversation;
  reason?: ChatConversationCreateReason;
  message?: string;
  status?: number;
  code?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private readonly isBrowser: boolean;
  private readonly baseUrl = environment.API_BASE_URL;
  private socket: Socket | null = null;
  private currentUserId: string | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private typingPruneTimer: ReturnType<typeof setInterval> | null = null;
  private lastMetadataHydrationAt = 0;
  private consecutiveConnectErrors = 0;
  private manuallyDisconnected = false;

  /** conversationId -> last emitted typing state (client-side throttle). */
  private readonly lastTypingSent = new Map<string, { isTyping: boolean; at: number }>();

  /** Emits when a component requests opening the chat shell with a specific user */
  private readonly requestOpenChatSubject = new Subject<string>();
  public readonly requestOpenChat$ = this.requestOpenChatSubject.asObservable();

  /** Emits when a notification asks to open the social chat with a user. */
  private readonly requestOpenSocialChatSubject = new Subject<{
    userId: string;
    nonce: number;
  }>();
  public readonly requestOpenSocialChat$ = this.requestOpenSocialChatSubject.asObservable();

  /** Emits after the socket re-established and reconciliation completed. */
  private readonly reconnectedSubject = new Subject<void>();
  public readonly reconnected$ = this.reconnectedSubject.asObservable();

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private store: ChatStateStore,
    private ngZone: NgZone,
    private applicationRef: ApplicationRef,
    @Inject(CHAT_SOCKET_FACTORY) private socketFactory: ChatSocketFactory,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) return;

    this.userService.getProfile().subscribe((profile) => {
      this.currentUserId = profile?.id || null;
      this.store.setCurrentUserId(this.currentUserId);
    });

    this.userService.isAuthenticated$.subscribe((isAuthenticated) => {
      if (isAuthenticated) {
        this.refreshConversations().subscribe();
        // Immediate realtime: the socket connects as soon as the user is
        // authenticated. No artificial delay, no UI-activation gate.
        void this.connectSocket();
      } else {
        this.manuallyDisconnected = true;
        this.disconnectSocket();
        this.store.reset();
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleBrowserOnline);
      window.addEventListener('gtv-auth-restored', this.handleAuthRestored);
    }

    // Outside the Angular zone: a permanent interval inside it keeps the app from ever
    // becoming stable, which blocks hydration from completing (NG0506) on every page.
    this.typingPruneTimer = this.ngZone.runOutsideAngular(() =>
      setInterval(() => {
        if (this.store.hasTyping()) this.ngZone.run(() => this.store.pruneExpiredTyping());
      }, TYPING_PRUNE_INTERVAL_MS)
    );
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Kept for call sites that explicitly activate chat; idempotent. */
  activateChat(): void {
    if (!this.isBrowser) return;
    void this.connectSocket();
  }

  /** Opens the chat shell landing on the social chat with the given user. */
  requestOpenSocialChat(userId: string): void {
    this.activateChat();
    this.requestOpenSocialChatSubject.next({ userId, nonce: Date.now() });
  }

  private readonly requestToggleAssistantSubject = new Subject<void>();
  /** The header/bottom-bar assistant buttons: open the assistant, or close it if it is open. */
  public readonly requestToggleAssistant$ = this.requestToggleAssistantSubject.asObservable();

  requestToggleAssistant(): void {
    this.activateChat();
    this.requestToggleAssistantSubject.next();
  }

  requestOpenChat(userId: string): void {
    this.activateChat();
    this.requestOpenChatSubject.next(userId);
  }

  getConversations(): Observable<ChatConversation[]> {
    return this.store.getConversations();
  }

  getOnlineUsers(): Observable<UserFriend[]> {
    return this.store.getOnlineUsers();
  }

  getConnectedUsersCount(): Observable<number> {
    return this.store.getConnectedCount();
  }

  getRealtimeMode(): Observable<ChatRealtimeMode> {
    return this.store.getRealtimeMode();
  }

  getTyping(conversationId: string): Observable<{ userId: string; expiresAt: number }[]> {
    return this.store.getTyping(conversationId);
  }

  /** Marks the conversation currently open, for unread/read-receipt handling. */
  setActiveConversation(conversationId: string | null): void {
    this.store.setActiveConversation(conversationId);
    if (conversationId) {
      this.store.markConversationReadLocal(conversationId);
      if (this.socket?.connected) {
        this.socket.emit('chat:read', { conversationId });
      }
    }
  }

  refreshConversations(): Observable<ChatConversation[]> {
    if (!this.safeGetToken()) {
      return of([]);
    }

    const url = `${this.baseUrl}/chat/conversations`;
    return this.http
      .get<ApiResponse<{ conversations: ChatConversation[] }>>(url, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.conversations || []),
        map((conversations) => conversations.map((conv) => this.reorderParticipants(conv))),
        tap((conversations) => this.store.applyConversations(conversations)),
        finalize(() => this.safeTick()),
        catchError(() => of([]))
      );
  }

  /**
   * Hydration/reconciliation call. The connected list itself is derived from
   * live presence: this REST call only resolves metadata for online users.
   */
  refreshOnlineUsers(): Observable<UserFriend[]> {
    if (!this.safeGetToken()) {
      return of([]);
    }

    const url = `${this.baseUrl}/chat/online-users`;
    return this.http
      .get<ApiResponse<OnlineUsersPayload>>(url, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data || { users: [] }),
        tap((payload) => {
          const users = payload.users || [];
          this.store.hydrateOnlineUsers(users);
          const onlineIds = Array.isArray(payload.onlineUserIds)
            ? payload.onlineUserIds
            : users.map((user) => user.id);
          const count =
            Number.isFinite(Number(payload.connectedUsersNow)) &&
            Number(payload.connectedUsersNow) >= 0
              ? Number(payload.connectedUsersNow)
              : onlineIds.length;
          this.store.applyPresenceSnapshot(onlineIds, count);
        }),
        map((payload) => payload.users || []),
        finalize(() => this.safeTick()),
        catchError(() => of([]))
      );
  }

  getMessages(conversationId: string): Observable<ChatMessageWithState[]> {
    if (!this.safeGetToken()) {
      return this.store.getMessages(conversationId);
    }

    const url = `${this.baseUrl}/chat/conversations/${conversationId}/messages`;
    this.http
      .get<ApiResponse<{ messages: ChatMessage[] }>>(url, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.messages || []),
        tap((messages) => this.store.applyServerMessages(conversationId, messages)),
        finalize(() => this.safeTick()),
        catchError(() => of([]))
      )
      .subscribe();

    return this.store.getMessages(conversationId);
  }

  sendMessage(
    conversationId: string,
    text: string,
    type: 'text' | 'image' | 'recommendation' | 'list' = 'text',
    content?: any
  ): Observable<ChatMessage | null> {
    if (!this.safeGetToken()) {
      return of(null);
    }

    const clientMessageId = this.createClientMessageId();
    this.store.addPendingMessage(conversationId, {
      clientMessageId,
      text,
      type,
      content,
      senderId: this.currentUserId || '',
    });

    return this.postMessage(conversationId, { text, type, content, clientMessageId });
  }

  /** Retries a failed message reusing the same clientMessageId (idempotent). */
  retryMessage(conversationId: string, message: ChatMessage): Observable<ChatMessage | null> {
    if (!this.safeGetToken()) {
      return of(null);
    }
    const clientMessageId = message.clientMessageId || this.createClientMessageId();
    this.store.markMessageRetrying(conversationId, clientMessageId);
    return this.postMessage(conversationId, {
      text: message.text,
      type: message.type,
      content: message.content,
      clientMessageId,
    });
  }

  createConversation(participantId: string): Observable<ChatConversationCreateResult> {
    if (!this.safeGetToken()) {
      return of({
        ok: false,
        reason: 'unauthorized',
        status: 401,
        message: 'Necesitas iniciar sesión para abrir un chat.',
      });
    }

    const url = `${this.baseUrl}/chat/conversations`;
    return this.http
      .post<ApiResponse<{ conversation: ChatConversation }>>(
        url,
        { participantId },
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((resp) => resp?.data?.conversation || null),
        map((conversation) => {
          if (!conversation) {
            return {
              ok: false,
              reason: 'unknown',
              message: 'No se pudo abrir la conversación.',
            } as ChatConversationCreateResult;
          }
          return {
            ok: true,
            conversation,
          } as ChatConversationCreateResult;
        }),
        tap((result) => {
          if (!result.ok) return;
          this.refreshConversations().subscribe();
        }),
        finalize(() => this.safeTick()),
        catchError((error: HttpErrorResponse) =>
          of(this.mapCreateConversationError(error))
        )
      );
  }

  markConversationRead(conversationId: string): Observable<boolean> {
    if (!this.safeGetToken()) {
      return of(false);
    }

    // Optimistic local reset; persistence goes through the socket event and
    // the REST call below.
    this.store.markConversationReadLocal(conversationId);
    if (this.socket?.connected) {
      this.socket.emit('chat:read', { conversationId });
    }

    const url = `${this.baseUrl}/chat/conversations/${conversationId}/read`;
    return this.http
      .post<ApiResponse<{ updated: number }>>(url, {}, { headers: this.getAuthHeaders() })
      .pipe(
        map(() => true),
        finalize(() => this.safeTick()),
        catchError(() => of(false))
      );
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    const now = Date.now();
    const previous = this.lastTypingSent.get(conversationId);
    if (
      previous &&
      previous.isTyping === isTyping &&
      now - previous.at < TYPING_CLIENT_THROTTLE_MS
    ) {
      return;
    }
    this.lastTypingSent.set(conversationId, { isTyping, at: now });
    this.socket.emit('chat:typing', { conversationId, isTyping });
  }

  // ------------------------------------------------------------------
  // Socket lifecycle
  // ------------------------------------------------------------------

  private async connectSocket(): Promise<void> {
    if (!this.isBrowser) return;
    const token = this.safeGetToken();
    if (!token) return;
    if (this.socket?.connected) return;

    this.disconnectSocket();

    const socketUrl = this.resolveSocketUrl();
    this.manuallyDisconnected = false;
    this.store.setRealtimeMode('connecting');
    const { io } = await this.socketFactory();
    // Authentication may have changed while the optional realtime bundle was
    // loading. Do not establish a stale connection in that case.
    if (!this.safeGetToken()) {
      this.store.setRealtimeMode('idle');
      return;
    }

    // Created outside the Angular zone (its heartbeat/reconnect timers would keep the app
    // unstable forever); every handler below re-enters the zone with ngZone.run.
    this.socket = this.ngZone.runOutsideAngular(() => io(socketUrl, {
      path: '/v2/ws',
      // Dynamic auth: the client re-resolves the token on every (re)connect,
      // so refreshes are picked up without recreating the socket.
      auth: (callback) => callback({ token: this.safeGetToken() || '' }),
      // WebSocket first; polling is only an automatic degraded transport.
      transports: ['websocket', 'polling'],
      // Infinite reconnection with exponential backoff + jitter while the
      // authenticated session is valid.
      reconnection: true,
      reconnectionAttempts: RECONNECTION_ATTEMPTS,
      reconnectionDelay: RECONNECTION_DELAY_MS,
      reconnectionDelayMax: RECONNECTION_DELAY_MAX_MS,
      randomizationFactor: RECONNECTION_JITTER,
      timeout: SOCKET_TIMEOUT_MS,
    }));

    this.socket.on('connect', () => {
      this.ngZone.run(() => {
        this.consecutiveConnectErrors = 0;
        this.store.setRealtimeMode('connected');
        this.clearFallbackPolling();
        this.reconcileAfterReconnect();
        this.safeTick();
      });
    });

    this.socket.on('disconnect', (reason: string) => {
      this.ngZone.run(() => {
        this.lastTypingSent.clear();
        if (reason === 'io client disconnect' || this.manuallyDisconnected) {
          this.store.setRealtimeMode('idle');
          this.safeTick();
          return;
        }
        // Server restart / network drop: socket.io reconnects automatically.
        this.store.setRealtimeMode('reconnecting');
        this.ensureFallbackPolling();
        this.safeTick();
      });
    });

    this.socket.on('connect_error', () => {
      this.ngZone.run(() => {
        this.consecutiveConnectErrors += 1;
        this.store.setRealtimeMode(
          this.consecutiveConnectErrors >= DEGRADED_ERROR_THRESHOLD
            ? 'degraded'
            : 'reconnecting'
        );
        this.ensureFallbackPolling();
        this.safeTick();
      });
    });

    this.socket.on('reconnect_attempt', () => {
      this.ngZone.run(() => {
        this.store.setRealtimeMode('reconnecting');
        this.safeTick();
      });
    });

    this.socket.on('reconnect_failed', () => {
      this.ngZone.run(() => {
        this.store.setRealtimeMode('degraded');
        this.ensureFallbackPolling();
        this.safeTick();
      });
    });

    this.socket.on('chat:conversation:update', (payload: { conversationId?: string; updatedAt?: string } = {}) => {
      this.ngZone.run(() => {
        const conversationId = String(payload?.conversationId || '').trim();
        if (!conversationId) return;
        this.store.applyConversationUpdate(conversationId, payload?.updatedAt || '');
        this.safeTick();
      });
    });

    this.socket.on(
      'chat:presence',
      (payload: { userId?: string; isOnline?: boolean; onlineCount?: number } = {}) => {
        this.ngZone.run(() => {
          const userId = String(payload?.userId || '').trim();
          if (!userId) return;
          const unknownIds = this.store.applyPresenceDelta(
            userId,
            Boolean(payload?.isOnline),
            payload?.onlineCount
          );
          if (unknownIds.length) {
            this.scheduleMetadataHydration();
          }
          this.safeTick();
        });
      }
    );

    this.socket.on(
      'chat:presence:snapshot',
      (payload: { onlineUserIds?: string[]; onlineCount?: number } = {}) => {
        this.ngZone.run(() => {
          this.store.applyPresenceSnapshot(
            Array.isArray(payload?.onlineUserIds) ? payload.onlineUserIds : [],
            payload?.onlineCount
          );
          this.scheduleMetadataHydration(true);
          this.safeTick();
        });
      }
    );

    this.socket.on(
      'chat:message:new',
      (payload: { conversationId?: string; message?: ChatMessage }) => {
        this.ngZone.run(() => {
          const conversationId = String(payload?.conversationId || '').trim();
          const message = payload?.message;
          if (!conversationId || !message) return;

          const duplicated = this.store.upsertMessage(conversationId, message);
          if (conversationId === this.store.getActiveConversationId() && !duplicated) {
            // Message for the open conversation: mark read immediately.
            this.socket?.emit('chat:read', { conversationId });
          }
          this.safeTick();
        });
      }
    );

    this.socket.on(
      'chat:read:updated',
      (payload: { conversationId?: string; userId?: string; readAt?: string } = {}) => {
        this.ngZone.run(() => {
          const conversationId = String(payload?.conversationId || '').trim();
          const readerId = String(payload?.userId || '').trim();
          if (!conversationId || !readerId) return;
          this.store.applyReadUpdated(conversationId, readerId, payload?.readAt);
          this.safeTick();
        });
      }
    );

    this.socket.on(
      'chat:typing',
      (payload: { conversationId?: string; userId?: string; isTyping?: boolean } = {}) => {
        this.ngZone.run(() => {
          const conversationId = String(payload?.conversationId || '').trim();
          const userId = String(payload?.userId || '').trim();
          if (!conversationId || !userId || userId === this.currentUserId) return;
          this.store.setTyping(conversationId, userId, Boolean(payload?.isTyping));
          this.safeTick();
        });
      }
    );

    this.socket.on('notification:new', () => {
      // Socket.IO callbacks arrive outside Angular's zone. Re-enter the zone
      // and force a change-detection pass when the fetches complete so the
      // notification bell reflects the new state without user interaction.
      this.ngZone.run(() => {
        this.userService
          .fetchUnreadNotificationsCount()
          .pipe(finalize(() => this.safeTick()))
          .subscribe();
        this.userService
          .fetchNotifications()
          .pipe(finalize(() => this.safeTick()))
          .subscribe();
      });
    });
  }

  /**
   * Runs a change-detection pass deterministically. Zone-driven CD is not
   * enough for socket.io events: their callbacks (and sometimes the XHR
   * completions they schedule) run outside the Angular zone.
   */
  private safeTick(): void {
    try {
      this.ngZone.run(() => this.applicationRef.tick());
    } catch {
      // Application may be tearing down; ignore.
    }
  }

  /** Best-effort reconnect trigger (tab visible again, network restored). */
  private reconnectSocket(): void {
    if (!this.socket) {
      void this.connectSocket();
      return;
    }
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  private disconnectSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.clearFallbackPolling();
  }

  private reconcileAfterReconnect(): void {
    this.refreshConversations().subscribe();
    this.refreshOnlineUsers().subscribe();
    this.reconnectedSubject.next();
  }

  private scheduleMetadataHydration(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastMetadataHydrationAt < METADATA_HYDRATE_THROTTLE_MS) {
      return;
    }
    this.lastMetadataHydrationAt = now;
    this.refreshOnlineUsers().subscribe();
  }

  // ------------------------------------------------------------------
  // Fallback mode (degraded only; never the normal path)
  // ------------------------------------------------------------------

  private ensureFallbackPolling(): void {
    if (this.fallbackTimer) return;
    // The interval lives outside the zone (stability); each poll re-enters it so its HTTP
    // results update the UI.
    this.fallbackTimer = this.ngZone.runOutsideAngular(() =>
      setInterval(() => this.ngZone.run(() => {
        if (this.socket?.connected) {
          this.clearFallbackPolling();
          return;
        }
        this.refreshConversations().subscribe();
        this.refreshOnlineUsers().subscribe();
      }), FALLBACK_POLL_INTERVAL_MS)
    );
  }

  private clearFallbackPolling(): void {
    if (!this.fallbackTimer) return;
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  // ------------------------------------------------------------------
  // Browser lifecycle / auth listeners
  // ------------------------------------------------------------------

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.safeGetToken()) {
      this.reconnectSocket();
    }
  };

  private readonly handleBrowserOnline = (): void => {
    if (this.safeGetToken()) {
      this.reconnectSocket();
    }
  };

  private readonly handleAuthRestored = (): void => {
    if (!this.safeGetToken()) return;
    // Reconnect with the fresh token (dynamic auth callback picks it up).
    this.reconnectSocket();
  };

  // ------------------------------------------------------------------
  // HTTP helpers
  // ------------------------------------------------------------------

  private postMessage(
    conversationId: string,
    payload: {
      text?: string;
      type: string;
      content?: unknown;
      clientMessageId: string;
    }
  ): Observable<ChatMessage | null> {
    const url = `${this.baseUrl}/chat/conversations/${conversationId}/messages`;
    return this.http
      .post<ApiResponse<{ message: ChatMessage }>>(url, payload, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.message || null),
        tap((message) => {
          if (!message) {
            this.store.markMessageFailed(conversationId, payload.clientMessageId);
            return;
          }
          this.store.upsertMessage(conversationId, message, { bumpUnread: false });
        }),
        finalize(() => this.safeTick()),
        catchError(() => {
          this.store.markMessageFailed(conversationId, payload.clientMessageId);
          return of(null);
        })
      );
  }

  private resolveSocketUrl(): string {
    const base = String(this.baseUrl || '').trim();
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base.replace(/\/v2\/?$/, '');
    }
    if (this.isBrowser) {
      return window.location.origin;
    }
    return 'http://127.0.0.1:4000';
  }

  private reorderParticipants(conversation: ChatConversation): ChatConversation {
    if (!this.currentUserId || !conversation?.participants?.length) return conversation;

    const participants = conversation.participants.slice();
    participants.sort((a) => (a.id === this.currentUserId ? 1 : -1));
    return { ...conversation, participants };
  }

  private createClientMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private mapCreateConversationError(
    error: HttpErrorResponse
  ): ChatConversationCreateResult {
    const apiError = error?.error?.error || {};
    const code = String(apiError.code || '').toUpperCase();
    const rawMessage = String(apiError.message || '').trim();
    const message =
      rawMessage || 'No se pudo abrir la conversación con este usuario.';

    if (error.status === 401 || code === 'UNAUTHORIZED') {
      return {
        ok: false,
        reason: 'unauthorized',
        status: error.status,
        code,
        message,
      };
    }

    if (error.status === 404 || code === 'NOT_FOUND') {
      return {
        ok: false,
        reason: 'not_found',
        status: error.status,
        code,
        message,
      };
    }

    if (error.status === 403 || code === 'FORBIDDEN') {
      const lowered = message.toLowerCase();
      const blocked =
        lowered.includes('blocked') ||
        lowered.includes('bloque') ||
        lowered.includes('does not accept');
      return {
        ok: false,
        reason: blocked ? 'blocked' : 'forbidden',
        status: error.status,
        code,
        message,
      };
    }

    return {
      ok: false,
      reason: 'unknown',
      status: error.status || 0,
      code: code || 'UNKNOWN_ERROR',
      message,
    };
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.safeGetToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  private safeGetToken(): string | null {
    if (!this.isBrowser) return null;
    try {
      return localStorage.getItem('gtv_id_token');
    } catch {
      return null;
    }
  }
}
