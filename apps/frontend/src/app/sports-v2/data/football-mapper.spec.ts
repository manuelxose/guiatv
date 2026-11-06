import { SportsSnapshot } from '../domain/models';
import { ApiMatch, ApiNews, htmlToParagraphs, mapBroadcasts, mapMatch, mapNews, mapStandings, mapStatus, mapTeam, mergeSnapshots, relationIndex } from './football-mapper';

const team = (slug: string, name: string, id = slug) => ({ id, slug, name, aliases: [name] });
const api = (over: Partial<ApiMatch> = {}): ApiMatch => ({
  id: '1', slug: 'a-b-2026-11-05', kickoffAt: '2026-11-05T20:00:00Z', status: 'scheduled',
  competition: { id: '2014', slug: 'primera-division', name: 'Primera División' },
  homeTeam: team('a', 'Alpha'), awayTeam: team('b', 'Beta'), score: { home: null, away: null }, ...over,
});

describe('football mapper', () => {
  describe('matches', () => {
    it('keeps provider scores only for live and finished matches', () => {
      expect(mapMatch(api({ status: 'finished', score: { home: 2, away: 1 } }))).toEqual(jasmine.objectContaining({ status: 'finished', homeScore: 2, awayScore: 1 }));
      expect(mapMatch(api({ status: 'scheduled', score: { home: 0, away: 0 } })).homeScore).toBeUndefined();
    });

    it('never turns a missing score into 0-0', () => {
      const m = mapMatch(api({ status: 'live', score: { home: null, away: null } }));
      expect(m.homeScore).toBeUndefined();
      expect(m.awayScore).toBeUndefined();
    });

    it('only reports a minute the provider gave, and only while live', () => {
      expect(mapMatch(api({ status: 'live', minute: 63 })).minute).toBe(63);
      expect(mapMatch(api({ status: 'live', minute: null })).minute).toBeUndefined();
      expect(mapMatch(api({ status: 'finished', minute: 90, score: { home: 1, away: 0 } })).minute).toBeUndefined();
    });

    it('never invents events, statistics or lineups', () => {
      const m = mapMatch(api({ status: 'finished', score: { home: 1, away: 0 } }));
      expect(m.events).toEqual([]);
      expect(m.stats).toEqual([]);
      expect(m.lineups).toBeUndefined();
    });

    it('maps provider statuses; unknown values are treated as scheduled, not live', () => {
      expect(['live', 'halftime', 'finished', 'postponed', 'suspended', 'cancelled', 'scheduled', 'weird'].map(mapStatus)).toEqual(['live', 'live', 'finished', 'postponed', 'postponed', 'postponed', 'scheduled', 'scheduled']);
    });

    it('keeps the authoritative UTC kickoff untouched', () => {
      expect(mapMatch(api({ kickoffAt: '2026-11-05T23:30:00Z' })).kickoff).toBe('2026-11-05T23:30:00Z');
    });
  });

  describe('broadcast verification', () => {
    const b = (over: object) => ({ channelName: 'DAZN', availability: 'streaming', provenance: 'airing', confidence: 'high', ...over });

    it('accepts EPG airings, editorial overrides and high-confidence reconciliation', () => {
      const out = mapBroadcasts([b({}), b({ channelName: 'Movistar', provenance: 'override', availability: 'tv' }), b({ channelName: 'La 1', provenance: 'reconciliation', availability: 'tv' })]);
      expect(out.map((x) => x.channel)).toEqual(['DAZN', 'Movistar', 'La 1']);
      expect(out[0].kind).toBe('streaming');
    });

    it('drops medium and low confidence guesses', () => {
      expect(mapBroadcasts([b({ provenance: 'reconciliation', confidence: 'medium' }), b({ provenance: 'reconciliation', confidence: 'low' })])).toEqual([]);
    });

    it('drops unknown provenance, blank names and duplicates; only keeps internal channel paths', () => {
      const out = mapBroadcasts([b({ provenance: 'guess' }), b({ channelName: '  ' }), b({ channelPath: '/canales/dazn' }), b({ channelPath: '/canales/dazn' }), b({ channelName: 'X', channelPath: 'https://evil.example/stream' })]);
      expect(out.map((x) => [x.channel, x.channelPath])).toEqual([['DAZN', '/canales/dazn'], ['X', undefined]]);
    });

    it('handles a missing list', () => {
      expect(mapBroadcasts(undefined)).toEqual([]);
    });
  });

  describe('teams and tables', () => {
    it('uses the provider three-letter code when present, else the first letters', () => {
      expect(mapTeam({ id: '1', slug: 'x', name: 'Botafogo FR', aliases: ['Botafogo', 'BOT'] }).shortName).toBe('BOT');
      expect(mapTeam({ id: '2', slug: 'y', name: 'Ñandú Club', aliases: [] }).shortName).toBe('NAN');
    });

    it('orders standings by provider position', () => {
      const row = (position: number, slug: string) => ({ position, team: team(slug, slug), played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 1, goalsAgainst: 0, points: 3 });
      expect(mapStandings('c', [row(2, 'b'), row(1, 'a')]).rows.map((r) => r.teamSlug)).toEqual(['a', 'b']);
    });
  });

  describe('editorial news', () => {
    const news = (over: Partial<ApiNews> = {}): ApiNews => ({ id: 'n1', slug: 'donde-ver-laliga', title: 'T', excerpt: 'E', contentType: 'guide', publishedAt: '2026-10-19T21:07:24.039Z', ...over });

    it('points the canonical URL at the CMS article and keeps the real date', () => {
      const n = mapNews(news());
      expect(n.canonicalPath).toBe('/guias/donde-ver-laliga');
      expect(n.publishedAt).toBe('2026-10-19T21:07:24.039Z');
      expect(n.kicker).toBe('Guía');
    });

    it('resolves structured relations and drops ids that match nothing', () => {
      const rel = relationIndex([team('real', 'Real', '86')], [{ id: '2014', slug: 'primera-division', name: 'x' }], [api({ id: '9' })]);
      const n = mapNews(news({ sportsRelations: { teamIds: ['86', 'nope'], competitionIds: ['catalog:primera-division'], matchIds: ['9'] } }), rel);
      expect(n.teamSlugs).toEqual(['real']);
      expect(n.competitionSlug).toBe('primera-division');
      expect(n.matchSlug).toBe('a-b-2026-11-05');
    });

    it('leaves unrelated articles unrelated', () => {
      const n = mapNews(news({ sportsRelations: { teamIds: [], competitionIds: [], matchIds: [] } }));
      expect(n.teamSlugs).toBeUndefined();
      expect(n.competitionSlug).toBeUndefined();
    });

    it('turns article HTML into plain paragraphs without scripts or tags', () => {
      expect(htmlToParagraphs('<h2>Hola &amp; adiós</h2><p>Uno <b>dos</b></p><script>alert(1)</script><ul><li>a</li><li>b</li></ul>')).toEqual(['Hola & adiós', 'Uno dos', 'a', 'b']);
      expect(htmlToParagraphs(undefined)).toEqual([]);
    });
  });

  describe('merging snapshots', () => {
    const empty: SportsSnapshot = { teams: [], competitions: [], matches: [], standings: [], news: [] };

    it('keeps a typed competition when a later response only embeds a stub', () => {
      const typed = mergeSnapshots(empty, { competitions: [{ slug: 'c', name: 'C', country: 'ES', kind: 'league', hue: 1, teamSlugs: [] }] });
      const merged = mergeSnapshots(typed, { competitions: [{ slug: 'c', name: 'C', country: '', kind: 'cup', hue: 1, teamSlugs: [] }] });
      expect(merged.competitions[0].kind).toBe('league');
    });

    it('replaces a match by slug with the newer record and derives competition teams', () => {
      const first = mergeSnapshots(empty, { competitions: [{ slug: 'c', name: 'C', country: '', kind: 'league', hue: 1, teamSlugs: [] }], matches: [mapMatch(api({ competition: { id: '1', slug: 'c', name: 'C' } }))] });
      const next = mergeSnapshots(first, { matches: [mapMatch(api({ competition: { id: '1', slug: 'c', name: 'C' }, status: 'finished', score: { home: 3, away: 0 } }))] });
      expect(next.matches.length).toBe(1);
      expect(next.matches[0].homeScore).toBe(3);
      expect(next.competitions[0].teamSlugs).toEqual(['a', 'b']);
    });
  });
});
