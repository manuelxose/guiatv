import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClientService } from '@app/api/api-client.service';
import { ApiResponse } from '@app/api/models';
import {
  FootballCompetitionDetailDTO,
  FootballCompetitionsResponseDTO,
  FootballHomeDTO,
  FootballMatchDetailDTO,
  FootballMatchesResponseDTO,
  FootballNewsDTO,
  FootballSearchDTO,
  FootballTeamDetailDTO,
} from './football.models';

@Injectable({ providedIn: 'root' })
export class FootballApiService {
  constructor(private readonly client: ApiClientService) {}

  // FootballFacade hands every response to the browser through its own TransferState key; skip the HTTP copy.
  private get<T>(path: string, params?: Record<string, any>) {
    return this.client.get<T>(path, params, { transferCache: false });
  }

  getHome(): Observable<ApiResponse<FootballHomeDTO>> {
    return this.get<ApiResponse<FootballHomeDTO>>('/sports/football/home');
  }

  getMatches(params: {
    date?: string;
    status?: string;
    competition?: string;
    team?: string;
    q?: string;
    limit?: number;
  } = {}): Observable<ApiResponse<FootballMatchesResponseDTO>> {
    return this.get<ApiResponse<FootballMatchesResponseDTO>>(
      '/sports/football/matches',
      params
    );
  }

  getLiveMatches(): Observable<ApiResponse<FootballMatchesResponseDTO>> {
    return this.get<ApiResponse<FootballMatchesResponseDTO>>('/sports/football/matches/live');
  }

  getMatch(idOrSlug: string): Observable<ApiResponse<FootballMatchDetailDTO>> {
    return this.get<ApiResponse<FootballMatchDetailDTO>>(
      `/sports/football/matches/${idOrSlug}`
    );
  }

  getCompetitions(): Observable<ApiResponse<FootballCompetitionsResponseDTO>> {
    return this.get<ApiResponse<FootballCompetitionsResponseDTO>>(
      '/sports/football/competitions'
    );
  }

  getCompetition(slug: string): Observable<ApiResponse<FootballCompetitionDetailDTO>> {
    return this.get<ApiResponse<FootballCompetitionDetailDTO>>(
      `/sports/football/competitions/${slug}`
    );
  }

  getTeam(slug: string): Observable<ApiResponse<FootballTeamDetailDTO>> {
    return this.get<ApiResponse<FootballTeamDetailDTO>>(`/sports/football/teams/${slug}`);
  }

  getNews(
    params: { team?: string; competition?: string; match?: string; slug?: string; q?: string; limit?: number; offset?: number } = {}
  ): Observable<ApiResponse<{ news: FootballNewsDTO[] }>> {
    return this.get<ApiResponse<{ news: FootballNewsDTO[] }>>('/sports/football/news', params);
  }

  search(q: string): Observable<ApiResponse<FootballSearchDTO>> {
    return this.get<ApiResponse<FootballSearchDTO>>('/sports/football/search', { q });
  }
}
