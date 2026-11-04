// M13-A: a response a service already hands to the browser through its own TransferState key must not also be
// serialised through Angular's HTTP transfer cache (the browser reads the service's key first, so the copy is dead weight).
import { PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { lastValueFrom, of } from 'rxjs';
import { ApiClientService } from './api-client.service';
import { TvApiService } from './tv-api.service';
import { FootballApiService } from '../features/football/football-api.service';

describe('ApiClientService transferCache option', () => {
  let http: HttpTestingController;
  let client: ApiClientService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(ApiClientService);
  });

  it('leaves the transfer cache decision to Angular by default', async () => {
    const result = lastValueFrom(client.get('/tv/read', { view: 'now' }));
    const req = http.expectOne((r) => r.url.endsWith('/tv/read'));
    expect(req.request.transferCache).toBeUndefined();
    expect(req.request.params.get('view')).toBe('now');
    req.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('opts a request out of the transfer cache without changing URL, params or result', async () => {
    const result = lastValueFrom(client.get('/tv/read', { view: 'now' }, { transferCache: false }));
    const req = http.expectOne((r) => r.url.endsWith('/tv/read'));
    expect(req.request.transferCache).toBe(false);
    expect(req.request.params.get('view')).toBe('now');
    req.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  afterEach(() => http.verify());
});

describe('TvApiService hand-off to the browser', () => {
  const body = { success: true, data: { channels: [{ id: 'la-1' }] } };
  const key = makeStateKey<unknown>('tv-api-v2:/tv/read/channels:{"date":"today"}');

  function setup(platform: 'server' | 'browser') {
    const get = jasmine.createSpy('get').and.returnValue(of(body));
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: platform }, { provide: ApiClientService, useValue: { get } }],
    });
    return { get, service: TestBed.inject(TvApiService), state: TestBed.inject(TransferState) };
  }

  it('keeps its own TransferState key on the server and skips the HTTP transfer cache', async () => {
    const { get, service, state } = setup('server');
    expect(await lastValueFrom(service.getTvReadChannels())).toEqual(body as never);
    expect(get).toHaveBeenCalledOnceWith('/tv/read/channels', { date: 'today', group: undefined, limit: undefined }, { transferCache: false });
    expect(state.get(key, null)).toEqual(body);
  });

  it('does not refetch in the browser when the server already transferred the response', async () => {
    const { get, service, state } = setup('browser');
    state.set(key, body);
    expect(await lastValueFrom(service.getTvReadChannels())).toEqual(body as never);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('FootballApiService hand-off to the browser', () => {
  it('skips the HTTP transfer cache for every football read (FootballFacade owns the TransferState keys)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({}));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: { get } }] });
    const api = TestBed.inject(FootballApiService);
    api.getHome();
    api.getMatches({ date: 'today' });
    api.getLiveMatches();
    api.getMatch('a');
    api.getCompetitions();
    api.getCompetition('laliga');
    api.getTeam('real-madrid');
    api.getNews({ limit: 3 });
    api.search('madrid');
    expect(get).toHaveBeenCalledTimes(9);
    for (const call of get.calls.allArgs()) expect(call[2]).toEqual({ transferCache: false });
    expect(get.calls.argsFor(1)).toEqual(['/sports/football/matches', { date: 'today' }, { transferCache: false }]);
  });
});
