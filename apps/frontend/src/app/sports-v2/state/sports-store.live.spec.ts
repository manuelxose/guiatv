import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FootballData, SPORTS_NOW } from '../data/football-data';
import { FollowStorage, MemoryFollowStorage } from '../data/follow-storage';
import { Match, NewsItem, SportsSnapshot } from '../domain/models';
import { SportsStore, rank } from './sports-store';
import { Sv2Viewport } from './viewport';

const NOW = new Date('2026-11-05T20:00:00Z');
const t = (slug: string, name: string) => ({ slug, name, shortName: name.slice(0, 3).toUpperCase(), hue: 1 });
const match = (slug: string, home: string, away: string, status: Match['status'], over: Partial<Match> = {}): Match => ({ slug, competitionSlug: 'liga', homeSlug: home, awaySlug: away, status, kickoff: '2026-11-05T19:00:00Z', events: [], stats: [], broadcasts: [], ...over });
const news = (slug: string, title: string): NewsItem => ({ slug, title, kicker: 'Noticia', summary: '', author: 'x', publishedAt: '2026-11-01T00:00:00Z', body: [] });

class FakeData extends FootballData {
  readonly source = 'live' as const;
  override readonly polls = true;
  snapshot: SportsSnapshot = {
    teams: [t('real-madrid', 'Real Madrid'), t('real-sociedad', 'Real Sociedad'), t('sporting', 'Sporting'), t('betis', 'Real Betis')],
    competitions: [{ slug: 'liga', name: 'LaLiga', country: 'España', kind: 'league', hue: 1, teamSlugs: [] }],
    matches: [match('rm-ss', 'real-madrid', 'real-sociedad', 'live', { homeScore: 0, awayScore: 0 }), match('sp-be', 'sporting', 'betis', 'scheduled', { kickoff: '2026-11-05T22:00:00Z' })],
    standings: [], news: [news('guia', 'Dónde ver LaLiga')],
  };
  live: Match[] = [];
  fail = false;
  calls: string[] = [];
  detail = new Map<string, Match>();
  remoteNews: NewsItem[] = [];
  load() { return Promise.resolve(this.snapshot); }
  override liveUpdates() { this.calls.push('live'); return this.fail ? Promise.reject(new Error('down')) : Promise.resolve(this.live); }
  override match(slug: string) { this.calls.push(`match:${slug}`); const m = this.detail.get(slug); return Promise.resolve(m ? { matches: [m] } : {}); }
  override competition(slug: string) { this.calls.push(`comp:${slug}`); return Promise.resolve({ standings: [{ competitionSlug: slug, rows: [] }] }); }
  override searchNews() { return Promise.resolve(this.remoteNews); }
}

describe('SportsStore with live data', () => {
  let data: FakeData;
  let store: SportsStore;

  beforeEach(async () => {
    data = new FakeData();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: SPORTS_NOW, useValue: () => NOW }, { provide: FootballData, useValue: data }, { provide: FollowStorage, useClass: MemoryFollowStorage }, Sv2Viewport, SportsStore] });
    store = TestBed.inject(SportsStore);
    await store.load();
  });

  describe('live refresh', () => {
    it('updates the score in place and records when it happened', async () => {
      data.live = [match('rm-ss', 'real-madrid', 'real-sociedad', 'live', { homeScore: 1, awayScore: 0, minute: 12 })];
      await store.pollLive();
      expect(store.match('rm-ss')).toEqual(jasmine.objectContaining({ homeScore: 1, minute: 12 }));
      expect(store.match('sp-be')?.status).toBe('scheduled');
      expect(store.lastUpdated()).toBe(NOW.getTime());
      expect(store.stale()).toBeFalse();
    });

    it('keeps known broadcasts when the live payload has none', async () => {
      store['snapshot'].update((s) => ({ ...s, matches: s.matches.map((m) => (m.slug === 'rm-ss' ? { ...m, broadcasts: [{ channel: 'DAZN', kind: 'streaming' as const }] } : m)) }));
      data.live = [match('rm-ss', 'real-madrid', 'real-sociedad', 'live', { homeScore: 1, awayScore: 0 })];
      await store.pollLive();
      expect(store.match('rm-ss')?.broadcasts.length).toBe(1);
    });

    it('settles a match that left the live list by asking for it directly', async () => {
      data.live = [];
      data.detail.set('rm-ss', match('rm-ss', 'real-madrid', 'real-sociedad', 'finished', { homeScore: 2, awayScore: 1 }));
      await store.pollLive();
      expect(data.calls).toContain('match:rm-ss');
      expect(store.match('rm-ss')).toEqual(jasmine.objectContaining({ status: 'finished', homeScore: 2 }));
    });

    it('does not drop a live match when the settle lookup fails', async () => {
      data.live = [];
      await store.pollLive();
      expect(store.match('rm-ss')?.status).toBe('live');
    });

    it('propagates a failed poll so the poller can back off, leaving data untouched', async () => {
      data.fail = true;
      await expectAsync(store.pollLive()).toBeRejected();
      expect(store.match('rm-ss')?.homeScore).toBe(0);
    });
  });

  describe('search', () => {
    it('ranks exact and prefix hits before word-start and contains hits', () => {
      expect(rank('real madrid', 'real madrid')).toBe(4);
      expect(rank('real madrid', 'real')).toBe(3);
      expect(rank('atletico real', 'real')).toBe(2);
      expect(rank('surreal', 'real')).toBe(1);
      expect(rank('betis', 'real')).toBe(0);
    });

    it('groups results by type and matches real fixtures only', () => {
      const g = store.search('real');
      expect(g.teams.map((x) => x.label)).toEqual(['Real Madrid', 'Real Sociedad', 'Real Betis']);
      expect(g.matches.map((x) => x.link[1])).toEqual(['rm-ss', 'sp-be']); // sp-be via Real Betis
      expect(g.competitions.length).toBe(0);
    });

    it('is accent- and case-insensitive and ignores one-letter queries', () => {
      expect(store.search('ESPAÑA').competitions.length).toBe(1);
      expect(store.search('espana').competitions.length).toBe(1);
      expect(store.search('r').total).toBe(0);
    });

    it('never fabricates a result for an unknown query', () => {
      expect(store.search('zzzzzz').total).toBe(0);
    });
  });

  describe('personalisation and tracker', () => {
    it('auto-tracks live matches of followed teams and respects dismissal', () => {
      store.toggleTeam('real-madrid');
      expect(store.trackedMatches().map((m) => m.slug)).toEqual(['rm-ss']);
      expect(store.isTracked('rm-ss')).toBeTrue();
      store.toggleTracked('rm-ss');
      expect(store.trackedMatches()).toEqual([]);
      store.toggleTracked('rm-ss');
      expect(store.trackedMatches().map((m) => m.slug)).toEqual(['rm-ss']);
    });

    it('does not auto-track matches of teams nobody follows', () => {
      expect(store.trackedMatches()).toEqual([]);
    });

    it('restores follows from storage and persists changes', () => {
      TestBed.inject(FollowStorage).write({ teams: ['betis'], competitions: ['liga'], matches: [] });
      store.restoreFollows();
      expect(store.followedTeams().map((x) => x.slug)).toEqual(['betis']);
      store.toggleTeam('sporting');
      expect((TestBed.inject(FollowStorage) as MemoryFollowStorage).state.teams).toEqual(['betis', 'sporting']);
    });
  });

  describe('lazy resources', () => {
    it('fetches a competition once and keeps the page in "resolving" only while in flight', async () => {
      const p = store.ensureCompetition('liga');
      expect(store.resolving()).toBe(1);
      await p;
      await store.ensureCompetition('liga');
      expect(data.calls.filter((c) => c === 'comp:liga').length).toBe(1);
      expect(store.resolving()).toBe(0);
      expect(store.standingsOf('liga')).toBeDefined();
    });

    it('allows a retry after a failed lazy fetch', async () => {
      let n = 0;
      data.competition = () => (++n === 1 ? Promise.reject(new Error('x')) : Promise.resolve({ standings: [{ competitionSlug: 'liga', rows: [] }] }));
      await store.ensureCompetition('liga');
      expect(store.standingsOf('liga')).toBeUndefined();
      await store.ensureCompetition('liga');
      expect(store.standingsOf('liga')).toBeDefined();
    });

    it('opens a match that is outside the preloaded window by direct link', async () => {
      data.detail.set('old', match('old', 'sporting', 'betis', 'finished', { homeScore: 1, awayScore: 1 }));
      expect(store.match('old')).toBeUndefined();
      await store.ensureMatch('old');
      expect(store.match('old')?.status).toBe('finished');
    });
  });
});
