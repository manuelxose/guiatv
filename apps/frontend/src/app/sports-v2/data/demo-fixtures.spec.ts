import { dayKey } from '../domain/calendar';
import { goalDifference, isConsistent, zoneAt } from '../domain/standings';
import { DEMO_COMPETITIONS, DEMO_STANDINGS, DEMO_TEAMS, buildDemoMatches, buildDemoNews } from './demo-fixtures';

describe('sports-v2 demo fixtures integrity', () => {
  const today = '2026-11-05';
  const matches = buildDemoMatches(today);
  const teams = new Set(DEMO_TEAMS.map((t) => t.slug));

  it('uses unique <home>-<away>-<date> slugs that match the kickoff day', () => {
    expect(new Set(matches.map((m) => m.slug)).size).toBe(matches.length);
    for (const m of matches) expect(m.slug).toBe(`${m.homeSlug}-${m.awaySlug}-${dayKey(m.kickoff)}`);
  });

  it('only references known teams and competitions', () => {
    for (const m of matches) {
      expect(teams.has(m.homeSlug) && teams.has(m.awaySlug)).toBeTrue();
      expect(DEMO_COMPETITIONS.some((c) => c.slug === m.competitionSlug)).toBeTrue();
    }
  });

  it('keeps goal events equal to the score when events exist', () => {
    for (const m of matches.filter((x) => x.events.length && x.homeScore != null)) {
      const goals = (side: 'home' | 'away') => m.events.filter((e) => e.type === 'goal' && e.side === side).length;
      expect([m.slug, goals('home'), goals('away')]).toEqual([m.slug, m.homeScore, m.awayScore]);
    }
  });

  it('only gives scores to live and finished matches, and a minute only to live ones', () => {
    for (const m of matches) {
      expect(m.homeScore != null).toBe(m.status === 'live' || m.status === 'finished');
      expect(m.minute != null).toBe(m.status === 'live');
    }
  });

  it('has past results, live games, today and future fixtures so every view has content', () => {
    const days = matches.map((m) => dayKey(m.kickoff));
    expect(days.some((d) => d < today)).toBeTrue();
    expect(days.some((d) => d > today)).toBeTrue();
    expect(matches.filter((m) => m.status === 'live').length).toBeGreaterThan(0);
    expect(matches.some((m) => m.status === 'postponed')).toBeTrue();
  });

  it('standings are internally consistent and ordered by points', () => {
    for (const s of DEMO_STANDINGS) {
      s.rows.forEach((r) => expect(isConsistent(r)).toBeTrue());
      const pts = s.rows.map((r) => r.points);
      expect(pts).toEqual([...pts].sort((a, b) => b - a));
      expect(s.rows.length).toBe(DEMO_COMPETITIONS.find((c) => c.slug === s.competitionSlug)?.teamSlugs.length);
    }
    expect(goalDifference(DEMO_STANDINGS[0].rows[0])).toBe(11);
  });

  it('only declares zones inside the table, and only for competitions with a table', () => {
    for (const c of DEMO_COMPETITIONS.filter((x) => x.zones)) {
      const size = DEMO_STANDINGS.find((s) => s.competitionSlug === c.slug)?.rows.length ?? 0;
      expect(size).toBeGreaterThan(0);
      for (const z of c.zones ?? []) expect(z.from >= 1 && z.to <= size && z.from <= z.to).toBeTrue();
    }
    expect(zoneAt(DEMO_COMPETITIONS[0].zones, 1)?.kind).toBe('qualification');
    expect(zoneAt(DEMO_COMPETITIONS[0].zones, 4)).toBeUndefined();
    expect(zoneAt(undefined, 1)).toBeUndefined();
  });

  it('news references real matches and carries author and date', () => {
    const slugs = new Set(matches.map((m) => m.slug));
    for (const n of buildDemoNews(today)) {
      if (n.matchSlug) expect(slugs.has(n.matchSlug)).toBeTrue();
      expect(n.author && n.publishedAt && n.body.length).toBeTruthy();
    }
  });
});
