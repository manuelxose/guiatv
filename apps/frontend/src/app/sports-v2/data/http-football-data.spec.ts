import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SPORTS_NOW } from './football-data';
import { HttpFootballData } from './http-football-data';

const BASE = '/v2/sports/football';
const team = (id: string, slug: string, name: string) => ({ id, slug, name, aliases: [name] });
const apiMatch = (status = 'scheduled', score = { home: null as number | null, away: null as number | null }) => ({
  id: '555', slug: 'a-b-2026-11-05', kickoffAt: '2026-11-05T20:00:00Z', status, round: 'Jornada 3',
  competition: { id: '2014', slug: 'primera-division', name: 'Primera División' },
  homeTeam: team('1', 'a', 'Alpha'), awayTeam: team('2', 'b', 'Beta'), score,
  broadcasts: [{ channelName: 'DAZN', provenance: 'airing', confidence: 'high', availability: 'streaming' }],
});
const ok = <T>(data: T) => ({ success: true, data });

describe('HttpFootballData', () => {
  let data: HttpFootballData;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpFootballData, { provide: SPORTS_NOW, useValue: () => new Date('2026-11-05T12:00:00Z') }],
    });
    data = TestBed.inject(HttpFootballData);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const answer = (path: string, body: unknown, status = 200) => {
    const req = http.expectOne((r) => r.url === `${BASE}${path}`);
    if (status === 200) req.flush(body);
    else req.flush({}, { status, statusText: "err" });
    return req.request;
  };

  it('loads one 9-day window of fixtures, competitions and news and maps them to the domain', async () => {
    const p = data.load();
    const req = http.expectOne((r) => r.url === `${BASE}/matches`);
    expect(req.request.params.get('dateFrom')).toBe('2026-11-01');
    expect(req.request.params.get('dateTo')).toBe('2026-11-10');
    req.flush(ok({ matches: [apiMatch('finished', { home: 2, away: 1 })] }));
    answer('/competitions', ok({ competitions: [{ id: '2014', slug: 'primera-division', name: 'Primera División', type: 'league', country: 'España' }] }));
    answer('/news', ok({ news: [{ id: 'n', slug: 'guia', title: 'Guía', publishedAt: '2026-10-19T00:00:00Z', contentType: 'guide' }] }));
    const s = await p;
    expect(data.source).toBe('live');
    expect(s.matches[0]).toEqual(jasmine.objectContaining({ homeScore: 2, awayScore: 1, status: 'finished' }));
    expect(s.matches[0].broadcasts[0].channel).toBe('DAZN');
    expect(s.competitions[0]).toEqual(jasmine.objectContaining({ kind: 'league', teamSlugs: ['a', 'b'] }));
    expect(s.teams.map((t) => t.slug)).toEqual(['a', 'b']);
    expect(s.news[0].canonicalPath).toBe('/guias/guia');
  });

  it('handles an empty provider response without inventing anything', async () => {
    const p = data.load();
    answer('/matches', ok({ matches: [] }));
    answer('/competitions', ok({ competitions: [] }));
    answer('/news', ok({ news: [] }));
    expect(await p).toEqual({ teams: [], competitions: [], matches: [], standings: [], news: [] });
  });

  it('falls back to today when the provider rejects the date range', async () => {
    const p = data.load();
    const range = http.expectOne((r) => r.url === `${BASE}/matches` && r.params.has('dateFrom'));
    range.flush({}, { status: 400, statusText: 'bad range' });
    await new Promise((r) => setTimeout(r)); // let the rejection reach the fallback
    const today = http.expectOne((r) => r.url === `${BASE}/matches` && r.params.get('date') === 'today');
    today.flush(ok({ matches: [apiMatch()] }));
    answer('/competitions', ok({ competitions: [] }));
    answer('/news', ok({ news: [] }));
    expect((await p).matches.length).toBe(1);
  });

  it('fails the load when fixtures fail (nothing honest to show)', async () => {
    const p = data.load();
    answer('/matches', {}, 500);
    await new Promise((r) => setTimeout(r)); // let the rejection reach the fallback
    const today = http.expectOne((r) => r.url === `${BASE}/matches` && r.params.get('date') === 'today');
    today.flush({}, { status: 500, statusText: 'err' });
    answer('/competitions', ok({ competitions: [] }));
    answer('/news', ok({ news: [] }));
    await expectAsync(p).toBeRejected();
  });

  it('degrades when only news or competitions fail', async () => {
    const p = data.load();
    answer('/matches', ok({ matches: [apiMatch()] }));
    answer('/competitions', {}, 429);
    answer('/news', {}, 500);
    const s = await p;
    expect(s.matches.length).toBe(1);
    expect(s.news).toEqual([]);
    expect(s.competitions.map((c) => c.slug)).toEqual(['primera-division']); // derived from the fixtures themselves
  });

  it('maps live updates and keeps minute absent when the provider gives none', async () => {
    const p = data.liveUpdates();
    answer('/matches/live', ok({ matches: [apiMatch('live', { home: 1, away: 0 })] }));
    const [m] = await p;
    expect(m.status).toBe('live');
    expect(m.homeScore).toBe(1);
    expect(m.minute).toBeUndefined();
  });

  it('shares one request between identical concurrent calls', async () => {
    const a = data.liveUpdates();
    const b = data.liveUpdates();
    const req = http.expectOne(`${BASE}/matches/live`); // expectOne fails if two went out
    req.flush(ok({ matches: [] }));
    expect(await a).toEqual(await b);
  });

  it('asks for a single day by compact date and maps its fixtures', async () => {
    const p = data.day('2026-12-24');
    const req = answer('/matches', ok({ matches: [apiMatch()] }));
    expect(req.params.get('date')).toBe('20261224');
    expect((await p).matches?.length).toBe(1);
  });

  it('maps a competition with its table', async () => {
    const p = data.competition('primera-division');
    answer('/competitions/primera-division', ok({
      competition: { id: '2014', slug: 'primera-division', name: 'Primera División', type: 'league' },
      matches: [], news: [],
      standings: [{ position: 1, team: team('1', 'a', 'Alpha'), played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 6, goalsAgainst: 1, points: 9 }],
    }));
    const part = await p;
    expect(part.standings?.[0].rows[0]).toEqual(jasmine.objectContaining({ teamSlug: 'a', points: 9 }));
    expect(part.competitions?.[0].slug).toBe('primera-division');
  });

  it('returns null for an unknown article', async () => {
    const p = data.article('nope');
    const req = answer('/news', ok({ news: [] }));
    expect(req.params.get('slug')).toBe('nope');
    expect(await p).toBeNull();
  });

  it('turns an article body into paragraphs', async () => {
    const p = data.article('guia');
    answer('/news', ok({ news: [{ id: 'n', slug: 'guia', title: 'G', publishedAt: '2026-10-19T00:00:00Z', content: '<p>Uno</p><p>Dos</p>' }] }));
    expect((await p)?.body).toEqual(['Uno', 'Dos']);
  });
});
