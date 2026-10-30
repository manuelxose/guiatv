import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface EditorialAIModel {
  id: string;
  provider: 'deepseek' | 'anthropic';
  label: string;
}

export type EditorialAIAction = 'generate' | 'improve' | 'expand' | 'summarize' | 'seo';

export interface EditorialAIAssistResult {
  text: string;
  model: string;
  provider: EditorialAIModel['provider'];
}

@Injectable({ providedIn: 'root' })
export class AdminEditorialAIService {
  private readonly baseUrl = environment.API_BASE_URL;

  constructor(private http: HttpClient) {}

  getModels(): Observable<EditorialAIModel[]> {
    return this.http
      .get<{ models: EditorialAIModel[] }>(`${this.baseUrl}/admin/editorial-ai/models`, {
        headers: this.headers(),
      })
      .pipe(map((r) => r?.models || []));
  }

  assist(body: {
    model: string;
    action: EditorialAIAction;
    instruction?: string;
    title?: string;
    content?: string;
  }): Observable<EditorialAIAssistResult> {
    return this.http.post<EditorialAIAssistResult>(`${this.baseUrl}/admin/editorial-ai/assist`, body, {
      headers: this.headers(),
    });
  }

  private headers(): HttpHeaders {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('gtv_id_token')
        : null;
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
