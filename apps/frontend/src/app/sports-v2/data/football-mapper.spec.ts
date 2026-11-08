import { SportsSnapshot } from '../domain/models';
import { ApiMatch, ApiNews, htmlToParagraphs, mapBroadcasts, mapEventType, mapMatch, mapNews, mapPhase, mapStandings, mapStatus, mapCompetition, mapTeam, mergeSnapshots, safeImageUrl, relationIndex } from './football-mapper';

const team = (slug: string, name: string, id = slug) => ({ id, slug, name, aliases: [name] });
const api = (over: Partial<ApiMatch> = {}): ApiMatch => ({
  id: '1', slug: 'a-b-2026-11-05', kickoffAt: '2026-11-05T20:00:00Z', status: 'scheduled',
  competition: { id: '2014', slug: 'primera-division', name: 'Primera División' },
  homeTeam: team('a', 'Alpha'), awayTeam: team('b', 'Beta'), score: { home: null, away: null }, ...over,
});

describe('football mapper', () => {
  describe('crests and logos', () => {
    it('preserves the provider crest and competition logo', () => {
      expect(mapTeam({ ...team('a', 'Alpha'), crest: 'https://crests.football-data.org/86.png' }).crestUrl).toBe('https://crests.football-data.org/86.png');
      expect(mapCompetition({ id: '1', slug: 'x', name: 'X', logo: 'https://crests.football-data.org/PD.png' }).logoUrl).toBe('https://crests.football-data.org/PD.png');
    });

    it('drops unsafe or missing image URLs so the UI falls back to a monogram', () => {
      for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://x/a.png', '/rel.png', 'https://u:p@x/a.png', '', null, undefined]) {
        expect(safeImageUrl(bad)).toBeUndefined();
      }
      expect(mapTeam(team('a', 'Alpha')).crestUrl).toBeUndefined();
    });
  });

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

    it('never derives a live minute from the kickoff timestamp', () => {
      expect(mapMatch(api({ status: 'live', kickoffAt: '2026-11-05T20:00:00Z', minute: null })).minute).toBeUndefined();
      expect(mapMatch(api({ status: 'live', minute: 90 })).minute).toBe(90);
    });

    it('leaves events, statistics and lineups undefined when the provider sent none', () => {
      const m = mapMatch(api({ status: 'finished', score: { home: 1, away: 0 } }));
      expect(m.events).toBeUndefined();
      expect(m.stats).toBeUndefined();
      expect(m.lineups).toBeUndefined();
    });

    it('carries venue and referee when supplied and leaves them undefined otherwise', () => {
      expect(mapMatch(api({ venue: 'Estadio Costa', referee: 'Á. Árbitro' })).venue).toBe('Estadio Costa');
      expect(mapMatch(api({ venue: 'Estadio Costa' })).referee).toBeUndefined();
      expect(mapMatch(api({ venue: null, referee: '' })).venue).toBeUndefined();
    });

    it('maps provider statuses; unknown values are treated as scheduled, not live', () => {
      expect(['live', 'halftime', 'finished', 'postponed', 'suspended', 'cancelled', 'scheduled', 'weird'].map(mapStatus)).toEqual(['live', 'live', 'finished', 'postponed', 'postponed', 'postponed', 'scheduled', 'scheduled']);
    });

    it('keeps the authoritative UTC kickoff untouched', () => {
      expect(mapMatch(api({ kickoffAt: '2026-11-05T23:30:00Z' })).kickoff).toBe('2026-11-05T23:30:00Z');
    });
  });

  describe('match phases', () => {
    it('derives unambiguous scheduled/finished phases and keeps live unresolved without a provider value', () => {
      expect(mapMatch(api({ status: 'scheduled' })).phase).toBe('scheduled');
      expect(mapMatch(api({ status: 'finished', score: { home: 1, away: 0 } })).phase).toBe('finished');
      expect(mapMatch(api({ status: 'live' })).phase).toBeUndefined();
    });

    it('keeps a provider phase and tolerates synonyms', () => {
      expect(mapMatch(api({ status: 'live', phase: 'first_half' })).phase).toBe('first_half');
      expect(mapPhase('HALF-TIME', 'live')).toBe('halftime');
      expect(mapPhase('penalty shootout', 'live')).toBe('penalties');
      expect(mapPhase('bogus', 'live')).toBeUndefined();
    });
  });

  describe('match events', () => {
    it('maps provider event type synonyms and ignores unknown types', () => {
      expect(mapEventType('GOAL')).toBe('goal');
      expect(mapEventType('Own Goal')).toBe('own_goal');
      expect(mapEventType('Yellow Card')).toBe('yellow');
      expect(mapEventType('Second Yellow')).toBe('second_yellow');
      expect(mapEventType({ name: 'Missed Penalty' })).toBe('penalty_missed');
      expect(mapEventType('mystery')).toBeUndefined();
    });

    it('preserves events sorted by minute, dedupes (type, minute, player) and drops unknown types', () => {
      const m = mapMatch(api({
        status: 'live', minute: 80, score: { home: 2, away: 1 },
        events: [
          { type: 'GOAL', minute: 63, team: { name: 'Alpha' }, player: { name: 'L. Prieto' }, score: { home: 2, away: 1 } },
          { type: 'goal', minute: 63, team: 'a', player: 'L. Prieto' },
          { type: 'Yellow Card', minute: 38, team: 'b', player: 'J. Salas' },
          { type: 'mystery', minute: 40, team: 'a', player: 'X' },
          { type: 'substitution', minute: 70, team: 'a', player: 'A. Cruz', assist: { name: 'L. Prieto' } },
          { type: 'Own Goal', minute: 12, team: 'a', player: 'Vidal', detail: 'Own Goal' },
          { type: 'Penalty', minute: 50, team: 'b', player: 'Navas', score: { home: 1, away: 1 } },
          { type: 'goal_disallowed', minute: 30, team: 'a', player: 'Ortega' },
          { type: 'var', minute: 31, team: 'a' },
        ],
      }));
      expect(m.events?.map((e) => `${e.type}@${e.minute}:${e.player}`)).toEqual([
        'own_goal@12:Vidal',
        'goal_disallowed@30:Ortega',
        'var@31:undefined',
        'yellow@38:J. Salas',
        'penalty@50:Navas',
        'goal@63:L. Prieto',
        'substitution@70:A. Cruz',
      ]);
      expect(m.events?.[5].scoreAfter).toEqual({ home: 2, away: 1 });
    });

    it('keeps a disallowed goal in the timeline without changing the score', () => {
      const m = mapMatch(api({
        status: 'finished', score: { home: 1, away: 0 },
        events: [{ type: 'goal_disallowed', minute: 40, team: 'a', player: 'Ortega', score: { home: 1, away: 0 } }],
      }));
      expect(m.homeScore).toBe(1);
      expect(m.awayScore).toBe(0);
      expect(m.events?.[0].type).toBe('goal_disallowed');
      expect(m.events?.[0].scoreAfter).toEqual({ home: 1, away: 0 });
    });

    it('maps stoppage time and keeps it separate from the kickoff-derived minute', () => {
      const m = mapMatch(api({ status: 'live', minute: 45, events: [{ type: 'goal', minute: 45, addedMinute: 3, team: 'a', player: 'Ortega' }] }));
      expect(m.minute).toBe(45);
      expect(m.events?.[0].addedMinute).toBe(3);
    });
  });

  describe('match statistics', () => {
    it('preserves statistics and distinguishes an absent value from a real 0', () => {
      const m = mapMatch(api({
        status: 'finished', score: { home: 2, away: 1 },
        statistics: [
          { label: 'Posesión', home: 54, away: 46, unit: '%' },
          { label: 'Fueras de juego', home: 0, away: 3 },
          { label: 'Remates', home: 12 },
        ],
      }));
      expect(m.stats).toEqual([
        { label: 'Posesión', home: 54, away: 46, unit: '%' },
        { label: 'Fueras de juego', home: 0, away: 3 },
        { label: 'Remates', home: 12, away: undefined },
      ]);
    });

    it('accepts a keyed statistics object and drops labels with no values', () => {
      const m = mapMatch(api({ status: 'finished', score: { home: 1, away: 1 }, statistics: { 'Posesión': { home: 50, away: 50 }, 'Córneres': { home: 4, away: 6 }, 'Notas': {} } }));
      expect(m.stats?.map((s) => s.label)).toEqual(['Posesión', 'Córneres']);
      expect(m.stats?.[0].home).toBe(50);
    });

    it('keeps statistics undefined when the provider sends none', () => {
      expect(mapMatch(api({ status: 'finished', score: { home: 1, away: 1 }, statistics: [] })).stats).toBeUndefined();
      expect(mapMatch(api({ status: 'finished', score: { home: 1, away: 1 }, statistics: null })).stats).toBeUndefined();
    });
  });

  describe('match lineups', () => {
    it('preserves coach, formation, starters and bench', () => {
      const m = mapMatch(api({
        status: 'finished', score: { home: 1, away: 0 },
        lineups: {
          home: { formation: '4-3-3', coach: { name: 'C. Táctico' }, starters: [{ number: 1, name: 'Vidal', position: 'POR' }], bench: [{ name: 'Rey' }] },
          away: { formation: '4-4-2', coach: 'R. Banco', players: ['Bravo', 'Salas'] },
        },
      }));
      expect(m.lineups?.home?.coach).toBe('C. Táctico');
      expect(m.lineups?.home?.formation).toBe('4-3-3');
      expect(m.lineups?.home?.starters).toEqual([{ number: 1, name: 'Vidal', position: 'POR' }]);
      expect(m.lineups?.home?.bench).toEqual([{ name: 'Rey' }]);
      expect(m.lineups?.away?.coach).toBe('R. Banco');
      expect(m.lineups?.away?.starters?.map((p) => p.name)).toEqual(['Bravo', 'Salas']);
    });

    it('keeps lineups undefined when the provider sends none', () => {
      expect(mapMatch(api({ status: 'finished', score: { home: 1, away: 0 }, lineups: null })).lineups).toBeUndefined();
      expect(mapMatch(api({ status: 'finished', score: { home: 1, away: 0 }, lineups: { home: {}, away: {} } })).lineups).toBeUndefined();
    });
  });

  describe('broadcast verification', () => {
    const b = (over: object) => ({ channelName: 'DAZN', availability: 'streaming', provenance: 'airing', confidence: 'high', ...over });

    it('accepts EPG airings, editorial overrides and high-confidence reconciliation', () => {
      const out = mapBroadcasts([b({}), b({ channelName: 'Movistar', provenance: 'override', availability: 'tv' }), b({ channelName: 'La 1', provenance: 'reconciliation', availability: 'tv' })]);
      expect(out.map((x) => x.channel)).toEqual(['DAZN', 'Movistar', 'La 1']);
      expect(out[0].kind).toBe('streaming');
    });

    it('keeps medium confidence as probable and drops low', () => {
      expect(mapBroadcasts([b({ provenance: 'reconciliation', confidence: 'medium' })])[0].probable).toBeTrue();
      expect(mapBroadcasts([b({ provenance: 'reconciliation', confidence: 'low' })])).toEqual([]);
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
