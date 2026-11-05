import { TestBed } from '@angular/core/testing';
import { DemoFootballData, FootballData } from '../data/football-data';
import { matchClockLabel, scoreAriaLabel } from '../domain/match-status';
import { SportsStore } from './sports-store';

describe('sports-v2 SportsStore', () => {
  let store: SportsStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: FootballData, useClass: DemoFootballData }, SportsStore] });
    store = TestBed.inject(SportsStore);
    await store.load();
  });

  it('loads demo data and pre-selects a live match', () => {
    expect(store.loadState()).toBe('ready');
    expect(store.liveMatches().length).toBeGreaterThan(0);
    expect(store.selectedMatch()?.status).toBe('live');
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

  it('searches accent-insensitively and ignores one-letter queries', () => {
    store.query.set('atletico');
    expect(store.searchHits().some((h) => h.kind === 'team')).toBeTrue();
    store.query.set('a');
    expect(store.searchHits()).toEqual([]);
  });

  it('never exposes ids in search links (slugs only)', () => {
    store.query.set('real');
    for (const hit of store.searchHits()) expect(hit.link.join('/')).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/);
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
