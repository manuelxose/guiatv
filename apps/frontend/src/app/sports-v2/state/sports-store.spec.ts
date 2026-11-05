import { TestBed } from '@angular/core/testing';
import { FollowStorage, MemoryFollowStorage } from '../data/follow-storage';
import { matchClockLabel, scoreAriaLabel } from '../domain/match-status';
import { sv2TestProviders, TEST_TODAY } from '../testing/providers';
import { SportsStore } from './sports-store';

describe('sports-v2 SportsStore', () => {
  let store: SportsStore;
  let storage: MemoryFollowStorage;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: sv2TestProviders() });
    store = TestBed.inject(SportsStore);
    storage = TestBed.inject(FollowStorage) as MemoryFollowStorage;
    await store.load();
  });

  it('loads demo data, flags it as demo and pre-selects a live match', () => {
    expect(store.loadState()).toBe('ready');
    expect(store.isDemo).toBeTrue();
    expect(store.today()).toBe(TEST_TODAY);
    expect(store.selectedMatch()?.status).toBe('live');
  });

  it('starts anonymous: nothing followed, suggestions offered from the data', () => {
    expect(store.followedTeams()).toEqual([]);
    expect(store.favoriteCompetitions()).toEqual([]);
    expect(store.suggestedTeams().length).toBeGreaterThan(0);
    expect(store.personalizedNews()).toEqual([]);
  });

  it('keeps at most three tracked matches, dropping the oldest', () => {
    ['a', 'b', 'c', 'd'].forEach((s) => store.toggleTracked(s));
    expect(store.trackedSlugs()).toEqual(['b', 'c', 'd']);
  });

  it('untracks when toggled twice', () => {
    store.toggleTracked('x');
    store.toggleTracked('x');
    expect(store.isTracked('x')).toBeFalse();
  });

  describe('follows', () => {
    it('toggles teams, competitions and saved fixtures and persists each change', () => {
      store.toggleTeam('real-costa');
      store.toggleCompetition('copa-demo');
      store.toggleSaved('some-match');
      expect(storage.state).toEqual({ teams: ['real-costa'], competitions: ['copa-demo'], matches: ['some-match'] });
      store.toggleTeam('real-costa');
      expect(store.isTeamFollowed('real-costa')).toBeFalse();
      expect(storage.state.teams).toEqual([]);
    });

    it('restores persisted follows and ignores slugs that no longer exist', () => {
      storage.state = { teams: ['racing-sur', 'ghost-fc'], competitions: ['liga-demo-a'], matches: [] };
      store.restoreFollows();
      expect(store.followedTeams().map((t) => t.slug)).toEqual(['racing-sur']);
      expect(store.favoriteCompetitions().map((c) => c.slug)).toEqual(['liga-demo-a']);
    });

    it('puts followed teams first in live and upcoming lists and builds personalised news', () => {
      store.toggleTeam('atletico-norte');
      expect(store.featuredLive()[0].slug).toContain('atletico-norte');
      expect(store.importantUpcoming()[0].homeSlug === 'atletico-norte' || store.importantUpcoming()[0].awaySlug === 'atletico-norte').toBeTrue();
      expect(store.personalizedNews().every((n) => n.teamSlugs?.includes('atletico-norte'))).toBeTrue();
      expect(store.personalizedNews().length).toBeGreaterThan(0);
    });

    it('lists saved matches in kickoff order', () => {
      const [a, b] = store.upcomingMatches();
      store.toggleSaved(b.slug);
      store.toggleSaved(a.slug);
      expect(store.savedMatches().map((m) => m.slug)).toEqual([a.slug, b.slug]);
    });
  });

  describe('queries', () => {
    it('returns the matches of a day and lists the distinct match days', () => {
      expect(store.matchesOnDay(TEST_TODAY).length).toBe(5);
      expect(store.matchesOnDay('2030-01-01')).toEqual([]);
      const days = store.matchDays();
      expect(days).toEqual([...days].sort());
      expect(days).toContain(TEST_TODAY);
    });

    it('reports league position only for league competitions', () => {
      expect(store.positionOf('real-costa')?.position).toBe(1);
      expect(store.positionOf('real-costa')?.competition.slug).toBe('liga-demo-a');
      expect(store.positionOf('ciudad-alta')).toBeUndefined(); // only in a cup and an international table
    });

    it('filters news by team, competition and match', () => {
      expect(store.newsFor({ team: 'racing-sur' }).length).toBeGreaterThan(0);
      expect(store.newsFor({ competition: 'copa-demo' }).every((n) => n.competitionSlug === 'copa-demo')).toBeTrue();
      expect(store.newsFor({ match: 'does-not-exist' })).toEqual([]);
    });
  });

  describe('search', () => {
    it('searches accent-insensitively and ignores one-letter queries', () => {
      store.query.set('atletico');
      expect(store.searchHits().some((h) => h.kind === 'team')).toBeTrue();
      store.query.set('a');
      expect(store.searchHits()).toEqual([]);
    });

    it('groups teams, competitions, fixtures and news', () => {
      const g = store.search('real costa');
      expect(g.teams.length).toBe(1);
      expect(g.matches.length).toBeGreaterThan(0);
      expect(g.news.length).toBeGreaterThan(0);
      expect(store.search('liga').competitions.length).toBe(2);
      expect(g.total).toBe(g.teams.length + g.competitions.length + g.matches.length + g.news.length);
    });

    it('returns an empty result, not an error, when nothing matches', () => {
      expect(store.search('zzzz-no-existe').total).toBe(0);
    });

    it('never exposes ids in search links (slugs only)', () => {
      store.query.set('real');
      expect(store.searchHits().length).toBeGreaterThan(0);
      for (const hit of store.searchHits()) expect(hit.link.join('/')).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/);
    });
  });
});

describe('sports-v2 match-status helpers', () => {
  it('shows the minute for live matches and FIN for finished', () => {
    expect(matchClockLabel('live', 72, '2026-11-05T20:00:00+01:00')).toBe("72'");
    expect(matchClockLabel('finished', undefined, '2026-11-05T20:00:00+01:00')).toBe('FIN');
  });
  it('describes scores accessibly', () => {
    expect(scoreAriaLabel('A', 'B', 'live', 2, 1)).toBe('A 2, B 1, en vivo');
    expect(scoreAriaLabel('A', 'B', 'scheduled')).toBe('A contra B, programado');
  });
});
