import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiConfigService } from './api-config.service';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  constructor(private http: HttpClient, private config: ApiConfigService) {}

  /**
   * `transferCache: false` keeps the response out of Angular's HTTP transfer cache. For callers that already hand the
   * response to the browser through their own `TransferState` key, the HTTP copy is never read (their key is checked
   * first) and only doubles the bytes serialised into the SSR HTML (`/canales`: 2.37 MB twice).
   */
  get<T>(path: string, params?: Record<string, any>, options: { transferCache?: false } = {}): Observable<T> {
    const url = this.config.buildUrl(path);
    const httpParams = this.toParams(params);
    return this.http
      .get<T>(url, options.transferCache === false ? { params: httpParams, transferCache: false } : { params: httpParams })
      .pipe(catchError((err) => this.handleError(err, url)));
  }

  post<T>(path: string, body: any): Observable<T> {
    const url = this.config.buildUrl(path);
    return this.http
      .post<T>(url, body)
      .pipe(catchError((err) => this.handleError(err, url)));
  }

  private toParams(params?: Record<string, any>): HttpParams | undefined {
    if (!params) return undefined;
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        httpParams = httpParams.set(key, value.join(','));
      } else {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return httpParams;
  }

  private handleError(err: any, url: string) {
    if (err instanceof HttpErrorResponse) {
      const message = `[ApiClient] ${err.status} ${err.statusText} @ ${url}`;
      console.error(message, err.error);
      return throwError(() => new Error(message));
    }
    console.error('[ApiClient] Unknown error', err);
    return throwError(() => err);
  }
}
