import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type AdminUserRole = 'admin' | 'editor' | 'user';
export type AdminUserStatus = 'active' | 'suspended';

export interface AdminUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  provider?: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUsersPagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  counts?: { admins: number; suspended: number };
  pagination: AdminUsersPagination;
}

export interface AdminUserReport {
  id: string;
  reporterId: string;
  targetUserId?: string;
  targetMessageId?: string;
  type: 'user' | 'message' | 'content' | 'other';
  reason: string;
  details?: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserReportsResponse {
  reports: AdminUserReport[];
  pagination: AdminUsersPagination;
}

export interface AdminUsersQuery {
  search?: string;
  role?: AdminUserRole | 'all';
  status?: AdminUserStatus | 'all';
  page?: number;
  limit?: number;
}

export interface AdminUserUpdatePayload {
  role?: AdminUserRole;
  status?: AdminUserStatus;
}

export interface AdminUserReportUpdatePayload {
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  resolutionNote?: string;
  action?: 'suspend' | 'none';
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly baseUrl = environment.API_BASE_URL;
  private readonly isBrowser = typeof window !== 'undefined';

  constructor(private http: HttpClient) {}

  getUsers(query: AdminUsersQuery = {}): Observable<AdminUsersResponse> {
    const params = this.serializeParams(query);
    const url = `${this.baseUrl}/admin/users${params ? `?${params}` : ''}`;

    return this.http
      .get<ApiResponse<AdminUsersResponse> | AdminUsersResponse>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(
        map((resp) => {
          if (this.isApiResponse(resp)) {
            return resp.data;
          }
          return resp as AdminUsersResponse;
        })
      );
  }

  updateUser(userId: string, payload: AdminUserUpdatePayload): Observable<AdminUser> {
    const url = `${this.baseUrl}/admin/users/${encodeURIComponent(userId)}`;
    return this.http
      .patch<ApiResponse<{ user: AdminUser }> | AdminUser>(url, payload, {
        headers: this.buildHeaders(),
      })
      .pipe(
        map((resp) => {
          if (this.isApiResponse(resp)) {
            const data: any = resp.data;
            return data?.user || data;
          }
          return resp as AdminUser;
        })
      );
  }

  getReports(query: { status?: string; page?: number; limit?: number } = {}): Observable<AdminUserReportsResponse> {
    const params = this.serializeParams(query as any);
    const url = `${this.baseUrl}/admin/users/reports${params ? `?${params}` : ''}`;
    return this.http
      .get<ApiResponse<AdminUserReportsResponse> | AdminUserReportsResponse>(url, {
        headers: this.buildHeaders(),
      })
      .pipe(
        map((resp) => {
          if (this.isApiResponse(resp)) {
            return resp.data as AdminUserReportsResponse;
          }
          return resp as AdminUserReportsResponse;
        })
      );
  }

  updateReport(reportId: string, payload: AdminUserReportUpdatePayload): Observable<AdminUserReport> {
    const url = `${this.baseUrl}/admin/users/reports/${encodeURIComponent(reportId)}`;
    return this.http
      .patch<ApiResponse<{ report: AdminUserReport }> | AdminUserReport>(url, payload, {
        headers: this.buildHeaders(),
      })
      .pipe(
        map((resp) => {
          if (this.isApiResponse(resp)) {
            const data: any = resp.data;
            return data?.report || data;
          }
          return resp as AdminUserReport;
        })
      );
  }

  private serializeParams(query: AdminUsersQuery): string {
    const params: string[] = [];
    if (query.search) params.push(`search=${encodeURIComponent(query.search)}`);
    if (query.role && query.role !== 'all') params.push(`role=${encodeURIComponent(query.role)}`);
    if (query.status && query.status !== 'all') params.push(`status=${encodeURIComponent(query.status)}`);
    if (query.page) params.push(`page=${query.page}`);
    if (query.limit) params.push(`limit=${query.limit}`);
    return params.join('&');
  }

  private buildHeaders(): HttpHeaders {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return new HttpHeaders(headers);
  }

  private getToken(): string | null {
    if (!this.isBrowser) return null;
    try {
      return localStorage.getItem('gtv_id_token');
    } catch {
      return null;
    }
  }

  private isApiResponse(resp: unknown): resp is ApiResponse<unknown> {
    return (
      !!resp &&
      typeof resp === 'object' &&
      'success' in resp &&
      'data' in resp
    );
  }
}
