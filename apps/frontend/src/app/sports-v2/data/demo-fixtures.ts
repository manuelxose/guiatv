/**
 * DEMO DATA ONLY. Every club, competition, player and score here is fictional.
 * It exists so the M01 shell can be developed and reviewed without touching
 * production APIs. Never import this file outside `demo-football-data.ts`.
 */
import { Competition, Match, NewsItem, Team } from '../domain/models';

const team = (slug: string, name: string, shortName: string, hue: number): Team => ({ slug, name, shortName, hue });

export const DEMO_TEAMS: readonly Team[] = [
  team('real-costa', 'Real Costa', 'RCO', 210),
  team('racing-sur', 'Racing Sur', 'RSU', 8),
  team('atletico-norte', 'Atlético Norte', 'ANO', 350),
  team('deportivo-valle', 'Deportivo Valle', 'DVA', 140),
  team('union-puerto', 'Unión Puerto', 'UPU', 45),
  team('sporting-mesa', 'Sporting Mesa', 'SME', 275),
  team('ciudad-alta', 'Ciudad Alta', 'CAL', 190),
  team('club-ribera', 'Club Ribera', 'CRI', 25),
];

export const DEMO_COMPETITIONS: readonly Competition[] = [
  {
    slug: 'liga-demo-a',
    name: 'Liga Demo A',
    country: 'España',
    kind: 'league',
    hue: 210,
    teamSlugs: ['real-costa', 'racing-sur', 'atletico-norte', 'deportivo-valle'],
  },
  {
    slug: 'copa-demo',
    name: 'Copa Demo',
    country: 'España',
    kind: 'cup',
    hue: 275,
    teamSlugs: ['union-puerto', 'sporting-mesa', 'ciudad-alta', 'club-ribera'],
  },
  {
    slug: 'liga-continental-demo',
    name: 'Liga Continental Demo',
    country: 'Europa',
    kind: 'international',
    hue: 150,
    teamSlugs: ['real-costa', 'ciudad-alta', 'atletico-norte', 'sporting-mesa'],
  },
];

const stats = (poss: number, shots: number, shotsAway: number) =>
  [
    { label: 'Posesión', home: poss, away: 100 - poss, unit: '%' as const },
    { label: 'Remates', home: shots, away: shotsAway },
    { label: 'Remates a puerta', home: Math.round(shots / 2), away: Math.round(shotsAway / 2) },
    { label: 'Córneres', home: 5, away: 3 },
  ] as const;

const squad = (formation: string, names: string[]) => ({ formation, players: names });

export const DEMO_MATCHES: readonly Match[] = [
  {
    slug: 'real-costa-racing-sur-demo-01',
    competitionSlug: 'liga-demo-a',
    homeSlug: 'real-costa',
    awaySlug: 'racing-sur',
    status: 'live',
    kickoff: '2026-11-05T20:00:00+01:00',
    minute: 72,
    homeScore: 2,
    awayScore: 1,
    events: [
      { minute: 14, type: 'goal', side: 'home', player: 'M. Ortega' },
      { minute: 38, type: 'yellow', side: 'away', player: 'J. Salas' },
      { minute: 51, type: 'goal', side: 'away', player: 'D. Navas' },
      { minute: 63, type: 'goal', side: 'home', player: 'L. Prieto' },
      { minute: 70, type: 'sub', side: 'home', player: 'A. Cruz' },
    ],
    stats: stats(54, 12, 8),
    lineups: {
      home: squad('4-3-3', ['Vidal', 'Ibarra', 'Soto', 'Peña', 'Lara', 'Ortega', 'Prieto', 'Mena', 'Cruz', 'Gil', 'Rey']),
      away: squad('4-4-2', ['Bravo', 'Salas', 'Nieto', 'Ruiz', 'Vera', 'Navas', 'Toro', 'Luna', 'Cano', 'Pozo', 'Mora']),
    },
    broadcasts: [
      { channel: 'Canal Deportes 1', kind: 'tv' },
      { channel: 'Plataforma Fútbol+', kind: 'streaming' },
    ],
  },
  {
    slug: 'atletico-norte-deportivo-valle-demo-02',
    competitionSlug: 'liga-demo-a',
    homeSlug: 'atletico-norte',
    awaySlug: 'deportivo-valle',
    status: 'live',
    kickoff: '2026-11-05T20:00:00+01:00',
    minute: 31,
    homeScore: 0,
    awayScore: 0,
    events: [{ minute: 22, type: 'yellow', side: 'home', player: 'R. Campos' }],
    stats: stats(48, 4, 5),
    broadcasts: [{ channel: 'Plataforma Fútbol+', kind: 'streaming' }],
  },
  {
    slug: 'union-puerto-sporting-mesa-demo-03',
    competitionSlug: 'copa-demo',
    homeSlug: 'union-puerto',
    awaySlug: 'sporting-mesa',
    status: 'finished',
    kickoff: '2026-11-05T16:00:00+01:00',
    homeScore: 1,
    awayScore: 3,
    events: [
      { minute: 9, type: 'goal', side: 'away', player: 'T. Arce' },
      { minute: 44, type: 'goal', side: 'home', player: 'P. Lobo' },
      { minute: 58, type: 'goal', side: 'away', player: 'T. Arce' },
      { minute: 81, type: 'goal', side: 'away', player: 'C. Fe' },
    ],
    stats: stats(41, 7, 13),
    broadcasts: [{ channel: 'Canal Deportes 2', kind: 'tv' }],
  },
  {
    slug: 'ciudad-alta-club-ribera-demo-04',
    competitionSlug: 'copa-demo',
    homeSlug: 'ciudad-alta',
    awaySlug: 'club-ribera',
    status: 'scheduled',
    kickoff: '2026-11-05T21:30:00+01:00',
    events: [],
    stats: [],
    broadcasts: [{ channel: 'Canal Deportes 2', kind: 'tv' }],
  },
  {
    slug: 'real-costa-ciudad-alta-demo-05',
    competitionSlug: 'liga-continental-demo',
    homeSlug: 'real-costa',
    awaySlug: 'ciudad-alta',
    status: 'scheduled',
    kickoff: '2026-11-06T21:00:00+01:00',
    events: [],
    stats: [],
    broadcasts: [
      { channel: 'Canal Europa', kind: 'tv' },
      { channel: 'Plataforma Fútbol+', kind: 'streaming' },
    ],
  },
  {
    slug: 'atletico-norte-sporting-mesa-demo-06',
    competitionSlug: 'liga-continental-demo',
    homeSlug: 'atletico-norte',
    awaySlug: 'sporting-mesa',
    status: 'postponed',
    kickoff: '2026-11-06T18:45:00+01:00',
    events: [],
    stats: [],
    broadcasts: [],
  },
];

export const DEMO_NEWS: readonly NewsItem[] = [
  {
    slug: 'claves-del-duelo-real-costa-racing-sur',
    kicker: 'Análisis',
    title: 'Las claves del duelo entre Real Costa y Racing Sur',
    publishedAt: '2026-11-05T12:00:00+01:00',
    competitionSlug: 'liga-demo-a',
  },
  {
    slug: 'sporting-mesa-golpea-en-copa',
    kicker: 'Crónica',
    title: 'Sporting Mesa golpea en la Copa Demo con un doblete de Arce',
    publishedAt: '2026-11-05T18:10:00+01:00',
    competitionSlug: 'copa-demo',
  },
  {
    slug: 'previa-liga-continental-jornada',
    kicker: 'Previa',
    title: 'Previa de la jornada continental: horarios y dónde verla',
    publishedAt: '2026-11-05T09:30:00+01:00',
    competitionSlug: 'liga-continental-demo',
  },
];
