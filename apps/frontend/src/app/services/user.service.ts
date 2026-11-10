import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import {
  UserActivity,
  UserFriend,
  UserListItem,
  UserProfile,
  UserRecommendation,
  UserNotifications,
  UserPrivacy,
  UserTvPreferences,
  WatchingNow,
  UserList,
  Top10Category,
  NewsItem,
  UserFavorite,
  UserNotification,
  UserReport,
  UserContentInteraction,
  CommunityList,
} from '../interfaces/user.interface';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { normalizeCatalogInteractionId } from '../utils/catalog';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

export type UserAuthState =
  | 'unknown'
  | 'authenticated'
  | 'unauthenticated'
  | 'refreshing'
  | 'refresh_failed';

const EMPTY_PROFILE: UserProfile = {
  id: '',
  name: 'Usuario',
  username: 'usuario',
  email: '',
  avatar: '/assets/gpt-avatar.png',
  bio: '',
  location: '-',
  role: 'user',
  favoriteGenres: [],
  preferredPlatforms: [],
  tvPreferences: {
    favoriteChannelIds: [],
    favoriteFootballTeamIds: [],
    favoriteFootballCompetitionIds: [],
    preferredContentLanguages: [],
  },
  discoveryDefaults: {
    types: ['program', 'movie', 'series'],
    availability: [],
    platforms: [],
    sort: 'popular',
  },
  watchingNow: {
    title: '',
    mood: '',
    visibility: 'friends',
  },
  privacy: {
    profilePublic: true,
    shareActivity: true,
    shareWatchlist: true,
    showOnline: true,
    allowMessages: 'all',
    publicLists: true,
  },
  notifications: {
    recommendations: true,
    followers: true,
    weeklySummary: false,
    chatMessages: true,
    groupActivity: true,
  },
  stats: {
    followers: 0,
    following: 0,
    recommendations: 0,
    watchlist: 0,
    listsCreated: 0,
    ratings: 0,
  },
};

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly isBrowser: boolean;
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly interactionCacheTtlMs = 60_000;
  private readonly interactionRetryCooldownMs = 25_000;
  private profileSubject = new BehaviorSubject<UserProfile>(EMPTY_PROFILE);
  private recommendationsSubject = new BehaviorSubject<UserRecommendation[]>([]);
  private activitiesSubject = new BehaviorSubject<UserActivity[]>([]);
  private friendsSubject = new BehaviorSubject<UserFriend[]>([]);
  private watchlistSubject = new BehaviorSubject<UserListItem[]>([]);
  private listsSubject = new BehaviorSubject<UserList[]>([]);
  private favoritesSubject = new BehaviorSubject<UserFavorite[]>([]);
  private interactionHistorySubject = new BehaviorSubject<UserContentInteraction[]>([]);
  private notificationsSubject = new BehaviorSubject<UserNotification[]>([]);
  private unreadNotificationsSubject = new BehaviorSubject<number>(0);
  /**
   * Signal twin of the unread counter. Socket.io-driven fetches complete
   * outside Angular's zone, and global change detection does not reliably run
   * for them in production; signals notify their template readers directly
   * and are immune to zone timing.
   */
  public readonly unreadNotificationsSignal = signal<number>(0);
  private notificationsHydrated = false;
  private top10Subject = new BehaviorSubject<Top10Category[]>([]);
  private newsSubject = new BehaviorSubject<NewsItem[]>([]);
  private authenticatedSubject = new BehaviorSubject<boolean>(false);
  private authStateSubject = new BehaviorSubject<UserAuthState>('unknown');
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new BehaviorSubject<string | null>(null);
  private readonly interactionCache = new Map<
    string,
    {
      value: UserContentInteraction | null;
      expiresAt: number;
      unavailableUntil?: number;
    }
  >();
  private readonly interactionInFlight = new Map<
    string,
    Observable<UserContentInteraction | null>
  >();

  private defaultListId: string | null = null;

  public readonly isAuthenticated$ = this.authenticatedSubject.asObservable();
  public readonly authState$ = this.authStateSubject.asObservable();
  public readonly loading$ = this.loadingSubject.asObservable();
  public readonly error$ = this.errorSubject.asObservable();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) return;

    window.addEventListener('gtv-auth-refreshing', this.handleAuthRefreshing);
    window.addEventListener('gtv-auth-restored', this.handleAuthRestored);
    window.addEventListener('gtv-auth-expired', this.handleAuthExpired);

    const token = this.safeGetToken();
    if (token) {
      this.bootstrapSession().subscribe();
      return;
    }

    this.authStateSubject.next('unauthenticated');
  }

  isAuthenticatedSync(): boolean {
    return this.authenticatedSubject.value;
  }

  getProfileSnapshot(): UserProfile {
    return this.profileSubject.value;
  }

  getProfile(): Observable<UserProfile> {
    return this.profileSubject.asObservable();
  }

  getRecommendations(): Observable<UserRecommendation[]> {
    return this.recommendationsSubject.asObservable();
  }

  getActivities(): Observable<UserActivity[]> {
    return this.activitiesSubject.asObservable();
  }

  getFriends(): Observable<UserFriend[]> {
    return this.friendsSubject.asObservable();
  }

  getWatchlist(): Observable<UserListItem[]> {
    return this.watchlistSubject.asObservable();
  }

  getLists(): Observable<UserList[]> {
    return this.listsSubject.asObservable();
  }

  getFavorites(): Observable<UserFavorite[]> {
    return this.favoritesSubject.asObservable();
  }

  getInteractionHistory(): Observable<UserContentInteraction[]> {
    return this.interactionHistorySubject.asObservable();
  }

  getNotifications(): Observable<UserNotification[]> {
    return this.notificationsSubject.asObservable();
  }

  getUnreadNotificationsCount(): Observable<number> {
    return this.unreadNotificationsSubject.asObservable();
  }

  getTop10(): Observable<Top10Category[]> {
    return this.top10Subject.asObservable();
  }

  getNews(): Observable<NewsItem[]> {
    return this.newsSubject.asObservable();
  }

  loadUserAreaData(): Observable<boolean> {
    const token = this.safeGetToken();
    if (!token) {
      this.logout('unauthenticated');
      return of(false);
    }

    if (!this.authenticatedSubject.value) {
      return this.bootstrapSession();
    }

    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    return forkJoin({
      profile: this.fetchProfile(),
      lists: this.fetchLists(),
      favorites: this.fetchFavorites(),
      interactions: this.fetchInteractionHistory(),
      notifications: this.fetchNotifications(),
      friends: this.fetchFriends(),
      activities: this.fetchActivities('all'),
      recommendations: this.fetchRecommendations('friends'),
    }).pipe(
      switchMap(() => this.fetchWatchlist()),
      map(() => true),
      tap(() => this.loadingSubject.next(false)),
      catchError(this.handleError(false, 'No se pudo cargar la informacion.'))
    );
  }

  fetchProfile(): Observable<UserProfile | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/profile`;
    return this.http
      .get<ApiResponse<{ profile: UserProfile }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.profile || null),
        tap((profile) => {
          if (profile) {
            this.profileSubject.next(this.mergeProfile(profile));
            this.authenticatedSubject.next(true);
          }
        }),
        catchError(this.handleError(null, 'No se pudo cargar el perfil.'))
      );
  }

  /** Updates only normalized TV/sports preferences, independently of profile copy. */
  updateTvPreferences(preferences: UserTvPreferences): Observable<UserTvPreferences> {
    return this.http
      .patch<ApiResponse<{ tvPreferences: UserTvPreferences }>>(
        `${this.baseUrl}/user/preferences`,
        preferences,
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((response) => response?.data?.tvPreferences || EMPTY_PROFILE.tvPreferences),
        tap((tvPreferences) => {
          this.profileSubject.next({ ...this.profileSubject.value, tvPreferences });
        }),
        catchError(this.handleError(EMPTY_PROFILE.tvPreferences, 'No se pudieron guardar las preferencias.'))
      );
  }

  applySession(user: Partial<UserProfile>, token: string): void {
    const current = this.profileSubject.value;
    const merged: UserProfile = {
      ...current,
      ...user,
      privacy: { ...current.privacy, ...(user.privacy || {}) },
      notifications: { ...current.notifications, ...(user.notifications || {}) },
      watchingNow: { ...current.watchingNow, ...(user.watchingNow || {}) },
      favoriteGenres: user.favoriteGenres || current.favoriteGenres,
      preferredPlatforms: user.preferredPlatforms || current.preferredPlatforms,
      tvPreferences: { ...current.tvPreferences, ...(user.tvPreferences || {}) },
      discoveryDefaults:
        user.discoveryDefaults || current.discoveryDefaults,
      stats: { ...current.stats, ...(user.stats || {}) },
      role: user.role ?? current.role,
      avatar: user.avatar || (user as any).picture || current.avatar,
      username: user.username || current.username,
      name: user.name || current.name,
      email: user.email || current.email,
    };

    this.profileSubject.next(merged);
    this.authenticatedSubject.next(true);
    this.authStateSubject.next('authenticated');
    if (token && this.isBrowser) {
      try {
        localStorage.setItem('gtv_id_token', token);
      } catch {
        // ignore
      }
    }

    // Profile context is sufficient at sign-in. Private areas request their own
    // data when opened instead of eagerly loading the community surface.
  }

  logout(nextState: UserAuthState = 'unauthenticated'): void {
    if (this.isBrowser) {
      try {
        localStorage.removeItem('gtv_id_token');
        localStorage.removeItem('gtv_refresh_token');
      } catch {
        // ignore
      }
    }
    this.profileSubject.next(EMPTY_PROFILE);
    this.recommendationsSubject.next([]);
    this.activitiesSubject.next([]);
    this.friendsSubject.next([]);
    this.watchlistSubject.next([]);
    this.listsSubject.next([]);
    this.favoritesSubject.next([]);
    this.interactionHistorySubject.next([]);
    this.notificationsSubject.next([]);
    this.unreadNotificationsSubject.next(0);
    this.unreadNotificationsSignal.set(0);
    this.interactionCache.clear();
    this.interactionInFlight.clear();
    this.authenticatedSubject.next(false);
    this.authStateSubject.next(nextState);
    this.loadingSubject.next(false);
    this.errorSubject.next(null);
    this.defaultListId = null;
    this.notificationsHydrated = false;
  }

  updateProfile(data: Partial<UserProfile>): Observable<UserProfile | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/profile`;
    return this.http
      .patch<ApiResponse<{ profile: UserProfile }>>(url, data, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.profile || null),
        tap((profile) => {
          if (profile) {
            this.profileSubject.next(this.mergeProfile(profile));
          }
        }),
        catchError(this.handleError(null, 'No se pudo actualizar el perfil.'))
      );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/auth/password`;
    return this.http
      .patch<ApiResponse<{ changed: boolean }>>(url, { currentPassword, newPassword }, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => !!resp?.data?.changed),
        catchError(this.handleError(false, 'No se pudo cambiar la contraseña.'))
      );
  }

  updatePrivacy(privacy: Partial<UserPrivacy>): Observable<UserPrivacy | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/privacy`;
    return this.http
      .patch<ApiResponse<{ privacy: UserPrivacy }>>(url, privacy, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.privacy || null),
        tap((privacyData) => {
          if (privacyData) {
            const profile = this.profileSubject.value;
            this.profileSubject.next({ ...profile, privacy: { ...profile.privacy, ...privacyData } });
          }
        }),
        catchError(this.handleError(null, 'No se pudo actualizar la privacidad.'))
      );
  }

  updateNotifications(notifications: Partial<UserNotifications>): Observable<UserNotifications | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/notifications`;
    return this.http
      .patch<ApiResponse<{ notifications: UserNotifications }>>(url, notifications, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.notifications || null),
        tap((notificationData) => {
          if (notificationData) {
            const profile = this.profileSubject.value;
            this.profileSubject.next({
              ...profile,
              notifications: { ...profile.notifications, ...notificationData },
            });
          }
        }),
        catchError(this.handleError(null, 'No se pudo actualizar las notificaciones.'))
      );
  }

  updateWatchingNow(data: Partial<WatchingNow>): Observable<WatchingNow | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/status`;
    return this.http
      .post<ApiResponse<{ watchingNow: WatchingNow }>>(url, data, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.watchingNow || null),
        tap((watchingNow) => {
          if (watchingNow) {
            const profile = this.profileSubject.value;
            this.profileSubject.next({ ...profile, watchingNow: { ...profile.watchingNow, ...watchingNow } });
            this.fetchActivities('all').subscribe();
          }
        }),
        catchError(this.handleError(null, 'No se pudo actualizar el estado.'))
      );
  }

  fetchLists(): Observable<UserList[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/user/lists`;
    return this.http
      .get<ApiResponse<{ lists: UserList[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.lists || []),
        map((lists) => lists.map((list) => this.mapList(list))),
        tap((lists) => {
          this.listsSubject.next(lists);
          const defaultList = lists.find((list) => list.isDefault);
          this.defaultListId = defaultList?.id || null;
        }),
        catchError(this.handleError([], 'No se pudieron cargar las listas.'))
      );
  }

  fetchListItems(listId: string): Observable<UserListItem[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/user/lists/${listId}/items`;
    return this.http
      .get<ApiResponse<{ items: UserListItem[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.items || []),
        map((items) => items.map((item) => this.mapListItem(item))),
        tap((items) => {
          if (this.defaultListId && listId === this.defaultListId) {
            this.watchlistSubject.next(items);
          }
        }),
        catchError(this.handleError([], 'No se pudieron cargar los items.'))
      );
  }

  fetchWatchlist(): Observable<UserListItem[]> {
    if (!this.safeGetToken()) return of([]);

    return this.ensureDefaultListId().pipe(
      switchMap((listId) => {
        if (!listId) return of([]);
        return this.fetchListItems(listId);
      }),
      catchError(this.handleError([], 'No se pudo cargar la watchlist.'))
    );
  }

  createList(data: { title: string; description: string; visibility: 'public' | 'friends' | 'private' }): Observable<UserList | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/lists`;
    return this.http
      .post<ApiResponse<{ list: UserList }>>(url, data, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.list || null),
        map((list) => (list ? this.mapList(list) : null)),
        tap((list) => {
          if (!list) return;
          const lists = [list, ...this.listsSubject.value.filter((entry) => entry.id !== list.id)];
          this.listsSubject.next(lists);
          this.bumpStats({ listsCreated: this.profileSubject.value.stats.listsCreated + 1 });
          this.fetchActivities('all').subscribe();
          this.fetchProfile().subscribe();
        }),
        catchError(this.handleError(null, 'No se pudo crear la lista.'))
      );
  }

  updateList(listId: string, changes: { title?: string; description?: string; visibility?: 'public' | 'friends' | 'private' }): Observable<UserList | null> {
    if (!this.safeGetToken()) return of(null);

    return this.http
      .patch<ApiResponse<{ list: UserList }>>(`${this.baseUrl}/user/lists/${listId}`, changes, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => (resp?.data?.list ? this.mapList(resp.data.list) : null)),
        tap((list) => {
          if (list) this.upsertList(list);
        }),
        catchError(this.handleError(null, 'No se pudo guardar la lista.'))
      );
  }

  /** Uploads a profile photo (raw image body); the server crops it, stores it and returns the updated profile. */
  uploadAvatar(file: Blob): Observable<UserProfile | null> {
    if (!this.safeGetToken()) return of(null);

    return this.http
      .post<ApiResponse<{ profile: UserProfile }>>(`${this.baseUrl}/user/avatar`, file, {
        headers: this.getAuthHeaders().set('Content-Type', file.type || 'application/octet-stream'),
      })
      .pipe(
        map((resp) => resp?.data?.profile || null),
        tap((profile) => {
          if (profile) this.profileSubject.next(this.mergeProfile(profile));
        }),
        catchError(this.handleError(null, 'No se pudo subir la foto.'))
      );
  }

  deleteList(listId: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    return this.http
      .delete<ApiResponse<{ deleted: boolean }>>(`${this.baseUrl}/user/lists/${listId}`, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.deleted !== false),
        tap((deleted) => {
          if (deleted) this.listsSubject.next(this.listsSubject.value.filter((list) => list.id !== listId));
        }),
        catchError(this.handleError(false, 'No se pudo borrar la lista.'))
      );
  }

  addListItem(
    listId: string,
    item: {
      title: string;
      type: 'movie' | 'series' | 'program';
      state: 'pending' | 'watching' | 'finished';
      contentId?: string;
    }
  ): Observable<UserListItem | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/lists/${listId}/items`;
    return this.http
      .post<ApiResponse<{ list: UserList; item: UserListItem }>>(url, item, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data || null),
        tap((data) => {
          if (!data) return;
          const itemData = this.mapListItem(data.item);
          if (data.list) {
            this.upsertList(this.mapList(data.list));
          } else {
            this.updateListCount(listId, 1);
          }
          if (this.defaultListId && listId === this.defaultListId) {
            this.watchlistSubject.next([itemData, ...this.watchlistSubject.value.filter((entry) => entry.id !== itemData.id)]);
          }
          this.fetchProfile().subscribe();
        }),
        map((data) => (data?.item ? this.mapListItem(data.item) : null)),
        catchError(this.handleError(null, 'No se pudo agregar el item.'))
      );
  }

  removeListItem(listId: string, itemId: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/user/lists/${listId}/items/${itemId}`;
    return this.http
      .delete<ApiResponse<{ deleted: boolean; list?: UserList }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => ({
          deleted: Boolean(resp?.data?.deleted),
          list: resp?.data?.list,
        })),
        tap((result) => {
          if (!result.deleted) return;
          if (this.defaultListId && listId === this.defaultListId) {
            this.watchlistSubject.next(this.watchlistSubject.value.filter((item) => item.id !== itemId));
          }
          if (result.list) {
            this.upsertList(this.mapList(result.list));
          } else {
            this.updateListCount(listId, -1);
          }
          this.fetchProfile().subscribe();
        }),
        map((result) => result.deleted),
        catchError(this.handleError(false, 'No se pudo eliminar el item.'))
      );
  }

  toggleWatchlistItem(payload: { contentId: string; title: string; type: 'movie' | 'series' | 'program' }): Observable<boolean | null> {
    if (!this.safeGetToken()) return of(null);
    const normalizedContentId = normalizeCatalogInteractionId({
      contentId: payload.contentId,
      contentType: payload.type,
    });

    return this.ensureDefaultListId().pipe(
      switchMap((listId) => {
        if (!listId) return of(null);
        const existing = this.watchlistSubject.value.find((item) => item.contentId === normalizedContentId);
        if (existing) {
          return this.removeListItem(listId, existing.id).pipe(
            tap((deleted) => {
              if (deleted) {
                this.patchInteractionCache(normalizedContentId, {
                  contentId: normalizedContentId,
                  contentTitle: payload.title,
                  contentType: payload.type,
                  addedToList: false,
                });
              }
            }),
            map((deleted) => (deleted ? false : null))
          );
        }
        return this.addListItem(listId, {
          title: payload.title,
          type: payload.type,
          state: 'pending',
          contentId: normalizedContentId,
        }).pipe(
          tap((created) => {
            if (created) {
              this.patchInteractionCache(normalizedContentId, {
                contentId: normalizedContentId,
                contentTitle: payload.title,
                contentType: payload.type,
                status: 'pending',
                addedToList: true,
              });
            }
          }),
          map((created) => (created ? true : null))
        );
      }),
      catchError(this.handleError(null, 'No se pudo actualizar la lista.'))
    );
  }

  fetchFavorites(): Observable<UserFavorite[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/user/favorites`;
    return this.http
      .get<ApiResponse<{ favorites: UserFavorite[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.favorites || []),
        tap((favorites) => this.favoritesSubject.next(favorites)),
        catchError(this.handleError([], 'No se pudieron cargar los favoritos.'))
      );
  }

  fetchCommunityLists(limit = 12): Observable<CommunityList[]> {
    const url = `${this.baseUrl}/lists/public?limit=${limit}`;
    return this.http
      .get<ApiResponse<{ lists: CommunityList[] }>>(url)
      .pipe(
        map((resp) => resp?.data?.lists || []),
        catchError(() => of([] as CommunityList[]))
      );
  }

  addFavorite(payload: Partial<UserFavorite>): Observable<UserFavorite | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/favorites`;
    return this.http
      .post<ApiResponse<{ favorite: UserFavorite }>>(url, payload, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.favorite || null),
        tap((favorite) => {
          if (favorite) {
            this.favoritesSubject.next([favorite, ...this.favoritesSubject.value]);
          }
        }),
        catchError(this.handleError(null, 'No se pudo agregar a favoritos.'))
      );
  }

  removeFavorite(id: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/user/favorites/${id}`;
    return this.http
      .delete<ApiResponse<{ deleted: boolean }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => Boolean(resp?.data?.deleted)),
        tap((deleted) => {
          if (deleted) {
            this.favoritesSubject.next(this.favoritesSubject.value.filter((fav) => fav.id !== id));
          }
        }),
        catchError(this.handleError(false, 'No se pudo eliminar el favorito.'))
      );
  }

  fetchNotifications(): Observable<UserNotification[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/user/notifications`;
    return this.http
      .get<ApiResponse<{ notifications: UserNotification[] }>>(url, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.notifications || []),
        tap((notifications) => this.notificationsSubject.next(notifications)),
        switchMap((notifications) =>
          this.fetchUnreadNotificationsCount().pipe(map(() => notifications))
        ),
        catchError(this.handleError([], 'No se pudieron cargar las notificaciones.'))
      );
  }

  fetchUnreadNotificationsCount(): Observable<number> {
    if (!this.safeGetToken()) return of(0);

    const url = `${this.baseUrl}/user/notifications/unread-count`;
    return this.http
      .get<ApiResponse<{ unreadCount: number }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => Number(resp?.data?.unreadCount || 0)),
        tap((count) => {
          this.unreadNotificationsSubject.next(count);
          this.unreadNotificationsSignal.set(count);
        }),
        catchError(this.handleError(0, 'No se pudo cargar el contador de notificaciones.'))
      );
  }

  markNotificationsRead(ids: string[] = [], all: boolean = false): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/user/notifications/read`;
    return this.http
      .post<ApiResponse<{ updated: boolean }>>(
        url,
        { ids, all },
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((resp) => Boolean(resp?.data?.updated)),
        tap((updated) => {
          if (!updated) return;
          if (all) {
            const now = new Date().toISOString();
            this.notificationsSubject.next(
              this.notificationsSubject.value.map((notification) => ({
                ...notification,
                readAt: notification.readAt || now,
              }))
            );
          } else if (ids.length) {
            const now = new Date().toISOString();
            const idSet = new Set(ids);
            this.notificationsSubject.next(
              this.notificationsSubject.value.map((notification) =>
                idSet.has(notification.id)
                  ? { ...notification, readAt: notification.readAt || now }
                  : notification
              )
            );
          }
          this.fetchUnreadNotificationsCount().subscribe();
        }),
        catchError(this.handleError(false, 'No se pudo actualizar notificaciones.'))
      );
  }

  blockUser(userId: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/social/block/${userId}`;
    return this.http
      .post<ApiResponse<{ blocked: boolean }>>(url, {}, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => Boolean(resp?.data?.blocked)),
        tap((blocked) => {
          if (!blocked) return;
          this.friendsSubject.next(this.friendsSubject.value.filter((friend) => friend.id !== userId));
          this.fetchActivities('all').subscribe();
        }),
        catchError(this.handleError(false, 'No se pudo bloquear al usuario.'))
      );
  }

  unblockUser(userId: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/social/block/${userId}`;
    return this.http
      .delete<ApiResponse<{ blocked: boolean }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => !resp?.data?.blocked),
        catchError(this.handleError(false, 'No se pudo desbloquear al usuario.'))
      );
  }

  reportUser(payload: {
    targetUserId?: string;
    targetMessageId?: string;
    reason: string;
    details?: string;
    type?: 'user' | 'message' | 'content' | 'other';
  }): Observable<UserReport | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/social/reports`;
    return this.http
      .post<ApiResponse<{ report: UserReport }>>(url, payload, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.report || null),
        catchError(this.handleError(null, 'No se pudo enviar el reporte.'))
      );
  }

  getBlockedUsers(): Observable<Array<{ id: string; name: string; username: string; avatar: string }>> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/blocks`;
    return this.http
      .get<ApiResponse<{ blocks: Array<{ id: string; name: string; username: string; avatar: string }> }>>(
        url,
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((resp) => resp?.data?.blocks || []),
        catchError(this.handleError([], 'No se pudieron cargar los usuarios bloqueados.'))
      );
  }

  deleteAccount(password: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/user/account`;
    return this.http
      .delete<ApiResponse<{ deleted: boolean }>>(url, {
        headers: this.getAuthHeaders(),
        body: { password },
      })
      .pipe(
        map((resp) => Boolean(resp?.data?.deleted)),
        catchError(this.handleError(false, 'No se pudo eliminar la cuenta.'))
      );
  }

  exportUserData(): Observable<any> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/user/export`;
    return this.http
      .get<ApiResponse<any>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data || null),
        catchError(this.handleError(null, 'No se pudieron exportar los datos.'))
      );
  }

  toggleActivityLike(activityId: string): Observable<{ liked: boolean; likes: number } | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/social/activities/${activityId}/like`;
    return this.http
      .post<ApiResponse<{ liked: boolean; likes: number }>>(url, {}, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data || null),
        tap((result) => {
          if (result) {
            const current = this.activitiesSubject.value;
            this.activitiesSubject.next(
              current.map((a) => a.id === activityId ? { ...a, liked: result.liked, likes: result.likes } : a)
            );
          }
        }),
        catchError(this.handleError(null, 'No se pudo actualizar el me gusta.'))
      );
  }

  addActivityComment(activityId: string, text: string): Observable<any> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/social/activities/${activityId}/comments`;
    return this.http
      .post<ApiResponse<{ comment: any }>>(url, { text }, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.comment || null),
        tap((comment) => {
          if (comment) {
            const current = this.activitiesSubject.value;
            this.activitiesSubject.next(
              current.map((a) => a.id === activityId ? { ...a, comments: (a.comments || 0) + 1 } : a)
            );
          }
        }),
        catchError(this.handleError(null, 'No se pudo añadir el comentario.'))
      );
  }

  fetchActivityComments(activityId: string, offset = 0, limit = 20): Observable<any[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/activities/${activityId}/comments?offset=${offset}&limit=${limit}`;
    return this.http
      .get<ApiResponse<{ comments: any[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.comments || []),
        catchError(this.handleError([], 'No se pudieron cargar los comentarios.'))
      );
  }

  getPublicProfile(userId: string): Observable<any> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/social/profile/${userId}`;
    return this.http
      .get<ApiResponse<{ profile: any }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.profile || null),
        catchError(this.handleError(null, 'No se pudo cargar el perfil.'))
      );
  }

  searchUsers(query: string, limit = 20): Observable<any[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/users/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    return this.http
      .get<ApiResponse<{ users: any[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.users || []),
        catchError(this.handleError([], 'No se pudo buscar usuarios.'))
      );
  }

  getUserStats(userId?: string): Observable<any> {
    if (!this.safeGetToken()) return of(null);

    const url = userId
      ? `${this.baseUrl}/social/stats/${userId}`
      : `${this.baseUrl}/social/stats`;
    return this.http
      .get<ApiResponse<{ stats: any }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.stats || null),
        catchError(this.handleError(null, 'No se pudieron cargar las estadísticas.'))
      );
  }

  fetchActivities(scope: 'me' | 'friends' | 'all' = 'all'): Observable<UserActivity[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/activities?scope=${scope}`;
    return this.http
      .get<ApiResponse<{ activities: UserActivity[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.activities || []),
        map((activities) => activities.map((activity) => this.mapActivity(activity))),
        tap((activities) => this.activitiesSubject.next(activities)),
        catchError(this.handleError([], 'No se pudo cargar la actividad.'))
      );
  }

  fetchFriends(): Observable<UserFriend[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/friends`;
    return this.http
      .get<ApiResponse<{ friends: UserFriend[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.friends || []),
        tap((friends) => this.friendsSubject.next(friends)),
        catchError(this.handleError([], 'No se pudo cargar la red social.'))
      );
  }

  toggleFollow(userId: string): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/social/follow/${userId}`;
    return this.http
      .post<ApiResponse<{ following: boolean; stats?: { followers: number; following: number } }>>(
        url,
        { action: 'toggle' },
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((resp) => resp?.data || { following: false }),
        tap((data) => {
          const following = Boolean(data.following);
          const friends = this.friendsSubject.value.map((friend) =>
            friend.id === userId ? { ...friend, following } : friend
          );
          this.friendsSubject.next(friends);
          if (data.stats) {
            this.bumpStats({ followers: data.stats.followers, following: data.stats.following });
          }
          this.fetchActivities('all').subscribe();
          this.fetchProfile().subscribe();
        }),
        map((data) => Boolean(data.following)),
        catchError(this.handleError(false, 'No se pudo actualizar el seguimiento.'))
      );
  }

  addRecommendation(payload: Partial<UserRecommendation>): Observable<UserRecommendation | null> {
    if (!this.safeGetToken()) return of(null);

    const url = `${this.baseUrl}/social/recommendations`;
    return this.http
      .post<ApiResponse<{ recommendation: UserRecommendation }>>(url, payload, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        map((resp) => resp?.data?.recommendation || null),
        map((recommendation) => (recommendation ? this.mapRecommendation(recommendation) : null)),
        tap((recommendation) => {
          if (recommendation) {
            this.recommendationsSubject.next([recommendation, ...this.recommendationsSubject.value]);
            this.fetchActivities('all').subscribe();
            this.fetchProfile().subscribe();
          }
        }),
        catchError(this.handleError(null, 'No se pudo enviar la recomendacion.'))
      );
  }

  fetchRecommendations(scope: 'me' | 'friends' | 'all' = 'friends'): Observable<UserRecommendation[]> {
    if (!this.safeGetToken()) return of([]);

    const url = `${this.baseUrl}/social/recommendations?scope=${scope}`;
    return this.http
      .get<ApiResponse<{ recommendations: UserRecommendation[] }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => resp?.data?.recommendations || []),
        map((recs) => recs.map((rec) => this.mapRecommendation(rec))),
        tap((recs) => this.recommendationsSubject.next(recs)),
        catchError(this.handleError([], 'No se pudieron cargar las recomendaciones.'))
      );
  }

  private mapList(list: UserList): UserList {
    return {
      ...list,
      createdAt: this.formatDate(list.createdAt),
      updatedAt: this.formatDate(list.updatedAt),
    };
  }

  private mapListItem(item: UserListItem): UserListItem {
    return {
      ...item,
      addedAt: item.addedAt ? this.formatDate(item.addedAt) : item.addedAt,
      progress: Number(item.progress || 0),
    };
  }

  private mapActivity(activity: UserActivity): UserActivity {
    return {
      ...activity,
      description: activity.description || '',
      createdAt: this.formatRelativeTime(activity.createdAt),
    };
  }

  private mapRecommendation(recommendation: UserRecommendation): UserRecommendation {
    return {
      ...recommendation,
      createdAt: this.formatRelativeTime(recommendation.createdAt),
      note: recommendation.note || '',
      tags: recommendation.tags || [],
      likes: recommendation.likes || 0,
      comments: recommendation.comments || 0,
    };
  }

  private mergeProfile(profile: UserProfile): UserProfile {
    const current = this.profileSubject.value;
    return {
      ...current,
      ...profile,
      privacy: { ...current.privacy, ...(profile.privacy || {}) },
      notifications: { ...current.notifications, ...(profile.notifications || {}) },
      watchingNow: { ...current.watchingNow, ...(profile.watchingNow || {}) },
      favoriteGenres: profile.favoriteGenres || current.favoriteGenres,
      preferredPlatforms: profile.preferredPlatforms || current.preferredPlatforms,
      tvPreferences: { ...current.tvPreferences, ...(profile.tvPreferences || {}) },
      discoveryDefaults:
        profile.discoveryDefaults || current.discoveryDefaults,
      stats: { ...current.stats, ...(profile.stats || {}) },
      role: profile.role ?? current.role,
      avatar: profile.avatar || current.avatar,
    };
  }

  private ensureDefaultListId(): Observable<string | null> {
    if (this.defaultListId) return of(this.defaultListId);
    return this.fetchLists().pipe(map(() => this.defaultListId));
  }

  private upsertList(list: UserList): void {
    const existing = this.listsSubject.value;
    const hasMatch = existing.some((entry) => entry.id === list.id);
    const updated = hasMatch
      ? existing.map((entry) => (entry.id === list.id ? list : entry))
      : [list, ...existing];
    this.listsSubject.next(updated);
  }

  private updateListCount(listId: string, delta: number): void {
    const lists = this.listsSubject.value.map((list) =>
      list.id === listId ? { ...list, itemsCount: Math.max(0, list.itemsCount + delta) } : list
    );
    this.listsSubject.next(lists);
  }

  private bumpStats(stats: Partial<UserProfile['stats']>): void {
    const profile = this.profileSubject.value;
    this.profileSubject.next({
      ...profile,
      stats: { ...profile.stats, ...(stats || {}) },
    });
  }

  private formatDate(value: string | Date | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  }

  private formatRelativeTime(value: string | Date | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} d`;
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

  private handleError<T>(fallback: T, message: string) {
    return (error: any): Observable<T> => {
      if (error?.status === 401) {
        this.logout('refresh_failed');
      }
      this.errorSubject.next(message);
      this.loadingSubject.next(false);
      return of(fallback);
    };
  }

  private bootstrapSession(): Observable<boolean> {
    const token = this.safeGetToken();
    if (!token) {
      this.logout('unauthenticated');
      return of(false);
    }

    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.authStateSubject.next('refreshing');

    return this.fetchProfile().pipe(
      switchMap((profile) => {
        if (!profile?.id) {
          this.logout('refresh_failed');
          return of(false);
        }

        this.authenticatedSubject.next(true);
        this.authStateSubject.next('authenticated');
        if (!this.notificationsHydrated) {
          this.notificationsHydrated = true;
          // Load the persisted unread badge + list so the bell reflects state
          // without requiring a visit to the user area.
          this.fetchNotifications().subscribe();
        }
        return of(true);
      }),
      finalize(() => this.loadingSubject.next(false))
    );
  }

  private readonly handleAuthRefreshing = (): void => {
    if (!this.safeGetToken()) {
      return;
    }
    this.authStateSubject.next('refreshing');
  };

  private readonly handleAuthRestored = (): void => {
    if (!this.safeGetToken()) {
      this.authStateSubject.next('unauthenticated');
      return;
    }
    this.authStateSubject.next(
      this.authenticatedSubject.value ? 'authenticated' : 'unknown'
    );
  };

  private readonly handleAuthExpired = (): void => {
    this.logout('refresh_failed');
  };

  addContentInteraction(payload: {
    contentId: string;
    contentTitle: string;
    contentType: 'movie' | 'series' | 'program';
    tmdbId?: number;
    genres?: string[];
    rating?: number;
    status?: 'seen' | 'watching' | 'pending' | 'dropped';
    liked?: boolean;
    recommended?: boolean;
    platform?: string;
  }): Observable<boolean> {
    if (!this.safeGetToken()) return of(false);

    const url = `${this.baseUrl}/user/interactions`;
    const normalizedContentId = normalizeCatalogInteractionId({
      contentId: payload.contentId,
      contentType: payload.contentType,
      tmdbId: payload.tmdbId,
    });
    return this.http
      .post<ApiResponse<{ interaction: any }>>(
        url,
        {
          ...payload,
          contentId: normalizedContentId,
        },
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        map((resp) => resp?.data?.interaction ? this.normalizeInteraction(resp.data.interaction) : null),
        tap((interaction) => {
          if (!interaction) {
            return;
          }
          this.setInteractionCache(interaction.contentId, interaction);
          this.upsertInteractionHistoryEntry(interaction);
          if (interaction.status === 'watching') {
            this.patchProfileWatchingNow(interaction.contentTitle);
          }
        }),
        map((interaction) => Boolean(interaction)),
        catchError(this.handleError(false, 'No se pudo guardar la interaccion.'))
      );
  }

  getContentInteraction(contentId: string): Observable<UserContentInteraction | null> {
    if (!this.safeGetToken()) return of(null);
    if (!String(contentId || '').trim()) return of(null);

    const normalizedContentId = normalizeCatalogInteractionId({ contentId });
    const now = Date.now();
    const cached = this.interactionCache.get(normalizedContentId);

    if (cached?.expiresAt && cached.expiresAt > now) {
      return of(cached.value);
    }

    if (cached?.unavailableUntil && cached.unavailableUntil > now) {
      return of(cached.value);
    }

    if (cached) {
      this.fetchContentInteraction(normalizedContentId, true);
      return of(cached.value);
    }

    return this.fetchContentInteraction(normalizedContentId);
  }

  fetchInteractionHistory(filters?: {
    status?: 'seen' | 'watching' | 'pending' | 'dropped';
    contentType?: 'movie' | 'series' | 'program';
    limit?: number;
  }): Observable<UserContentInteraction[]> {
    if (!this.safeGetToken()) return of([]);

    const params: Record<string, string> = {};
    if (filters?.status) params['status'] = filters.status;
    if (filters?.contentType) params['contentType'] = filters.contentType;
    if (filters?.limit) params['limit'] = String(filters.limit);

    return this.http
      .get<ApiResponse<{ interactions: UserContentInteraction[] }>>(`${this.baseUrl}/user/interactions`, {
        headers: this.getAuthHeaders(),
        params,
      })
      .pipe(
        map((resp) => resp?.data?.interactions || []),
        map((interactions) => interactions.map((interaction) => this.normalizeInteraction(interaction))),
        tap((interactions) => {
          this.interactionHistorySubject.next(interactions);
          this.primeInteractionCache(interactions);
        }),
        catchError(this.handleError([], 'No se pudo cargar el historial.'))
      );
  }

  saveGenrePreferences(genres: string[], platforms: string[]): Observable<boolean> {
    return this.updateProfile({
      favoriteGenres: genres,
      preferredPlatforms: platforms,
    } as any).pipe(map((profile) => Boolean(profile)));
  }

  saveDiscoveryDefaults(
    discoveryDefaults: UserProfile['discoveryDefaults']
  ): Observable<boolean> {
    return this.updateProfile({
      discoveryDefaults,
    } as any).pipe(map((profile) => Boolean(profile)));
  }

  peekContentInteraction(contentId: string): UserContentInteraction | null {
    if (!String(contentId || '').trim()) {
      return null;
    }
    const normalizedContentId = normalizeCatalogInteractionId({ contentId });
    const cached = this.interactionCache.get(normalizedContentId);
    if (cached) {
      return cached.value;
    }

    return (
      this.interactionHistorySubject.value.find(
        (interaction) => interaction.contentId === normalizedContentId
      ) || null
    );
  }

  private fetchContentInteraction(
    normalizedContentId: string,
    background = false
  ): Observable<UserContentInteraction | null> {
    const existing = this.interactionInFlight.get(normalizedContentId);
    if (existing) {
      return existing;
    }

    const url = `${this.baseUrl}/user/interactions/${encodeURIComponent(normalizedContentId)}`;
    const cached = this.interactionCache.get(normalizedContentId);

    const request$ = this.http
      .get<ApiResponse<{ interaction: any | null }>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map((resp) => (resp?.data?.interaction ? this.normalizeInteraction(resp.data.interaction) : null)),
        tap((interaction) => {
          this.setInteractionCache(normalizedContentId, interaction);
          if (interaction) {
            this.upsertInteractionHistoryEntry(interaction);
          }
        }),
        catchError((error) => {
          this.interactionCache.set(normalizedContentId, {
            value: cached?.value || null,
            expiresAt: cached?.expiresAt || 0,
            unavailableUntil: Date.now() + this.interactionRetryCooldownMs,
          });
          return this.handleError(cached?.value || null, 'No se pudo cargar la interaccion.')(error);
        }),
        finalize(() => this.interactionInFlight.delete(normalizedContentId)),
        shareReplay(1)
      );

    this.interactionInFlight.set(normalizedContentId, request$);

    if (background) {
      request$.subscribe();
    }

    return request$;
  }

  private primeInteractionCache(interactions: UserContentInteraction[]): void {
    interactions.forEach((interaction) => {
      this.setInteractionCache(interaction.contentId, interaction);
    });
  }

  private setInteractionCache(
    contentId: string,
    interaction: UserContentInteraction | null
  ): void {
    this.interactionCache.set(contentId, {
      value: interaction,
      expiresAt: Date.now() + this.interactionCacheTtlMs,
    });
  }

  private patchInteractionCache(
    contentId: string,
    patch: Partial<UserContentInteraction> & {
      contentId: string;
      contentTitle: string;
      contentType: 'movie' | 'series' | 'program';
    }
  ): void {
    const existing =
      this.peekContentInteraction(contentId) ||
      ({
        id: '',
        userId: this.profileSubject.value.id,
        contentId: patch.contentId,
        contentTitle: patch.contentTitle,
        contentType: patch.contentType,
        genres: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as UserContentInteraction);

    const nextValue: UserContentInteraction = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.setInteractionCache(contentId, nextValue);
    this.upsertInteractionHistoryEntry(nextValue);
  }

  private upsertInteractionHistoryEntry(interaction: UserContentInteraction): void {
    const existing = this.interactionHistorySubject.value.filter(
      (entry) => entry.contentId !== interaction.contentId
    );
    const next = [interaction, ...existing].sort(
      (left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() -
        new Date(left.updatedAt || left.createdAt).getTime()
    );
    this.interactionHistorySubject.next(next);
  }

  private normalizeInteraction(input: any): UserContentInteraction {
    return {
      id: String(input?.id || input?._id || ''),
      userId: String(input?.userId || ''),
      contentId: normalizeCatalogInteractionId({ contentId: input?.contentId }),
      contentTitle: String(input?.contentTitle || ''),
      contentType: input?.contentType || 'program',
      tmdbId:
        input?.tmdbId !== undefined && input?.tmdbId !== null
          ? Number(input.tmdbId)
          : undefined,
      genres: Array.isArray(input?.genres)
        ? input.genres.map((genre: unknown) => String(genre || '').trim()).filter(Boolean)
        : [],
      rating:
        input?.rating !== undefined && input?.rating !== null
          ? Number(input.rating)
          : undefined,
      status: input?.status || 'pending',
      liked: input?.liked !== undefined ? Boolean(input.liked) : undefined,
      addedToList:
        input?.addedToList !== undefined ? Boolean(input.addedToList) : undefined,
      recommended:
        input?.recommended !== undefined ? Boolean(input.recommended) : undefined,
      platform: input?.platform ? String(input.platform) : undefined,
      watchedAt: input?.watchedAt ? String(input.watchedAt) : undefined,
      createdAt: String(input?.createdAt || new Date().toISOString()),
      updatedAt: String(input?.updatedAt || input?.createdAt || new Date().toISOString()),
    };
  }

  private patchProfileWatchingNow(title: string): void {
    const profile = this.profileSubject.value;
    if (!title || !profile?.id) {
      return;
    }

    this.profileSubject.next({
      ...profile,
      watchingNow: {
        ...profile.watchingNow,
        title,
      },
    });
  }
}
