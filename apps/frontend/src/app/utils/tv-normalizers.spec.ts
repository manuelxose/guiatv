import { CatalogItem } from '../services/catalog.service';
import { TvReadItemDTO } from '../api/models';
import { computeProgress, isTvReadItem, normalizeCategory, normalizeToCard } from './tv-normalizers';

describe('tv-normalizers', () => {
  it('formats card subtitles in Madrid across the daylight-saving boundary', () => {
    expect(normalizeToCard(makeTvItem({ start: '2026-10-25T00:30:00Z', end: '2026-10-25T02:30:00Z' })).subtitle).toContain('02:30 - 03:30');
    expect(normalizeToCard(makeTvItem({ start: '2026-07-01T18:00:00Z', end: '2026-07-01T19:00:00Z' })).subtitle).toContain('20:00 - 21:00');
  });
  it('detects TvRead items with the type guard', () => {
    expect(isTvReadItem(makeTvItem())).toBeTrue();
    expect(
      isTvReadItem({
        catalogId: 'tmdb:movie:1',
        source: 'tmdb',
        contentType: 'movie',
        title: 'Movie',
        genres: [],
        primaryPlatforms: [],
      } as CatalogItem)
    ).toBeFalse();
  });

  it('normalizes TV items into unified card data with live badges and progress', () => {
    const start = '2026-03-26T20:00:00.000Z';
    const end = '2026-03-26T22:00:00.000Z';
    const tvItem = makeTvItem({ start, end, liveNow: true, editorialCategory: 'Deportes', sportFacet: 'Fútbol' });

    const normalized = normalizeToCard(tvItem);

    expect(normalized.title).toBe('Partido estelar');
    expect(normalized.contentType).toBe('program');
    expect(normalized.channelName).toBe('La 1');
    expect(normalized.channelId).toBe('la-1');
    expect(normalized.channelPath).toBe('/canales/la-1');
    expect(normalized.badges).toContain('LIVE');
    expect(normalized.badges).toContain('Fútbol');
    expect(normalized.badges).toContain('Deportes');
    expect(normalized.detailPath).toBe('/canales/la-1');
    expect(
      computeProgress(start, end, new Date('2026-03-26T21:00:00.000Z'))
    ).toBe(50);
  });

  it('normalizes catalog items with graceful fallbacks', () => {
    const catalogItem: CatalogItem = {
      catalogId: 'tmdb:movie:55',
      source: 'tmdb',
      contentType: 'movie',
      title: 'La película',
      genres: ['Drama'],
      primaryPlatforms: ['Netflix'],
      liveNow: false,
      image: '',
      backdrop: 'https://img.example.com/backdrop.jpg',
    };

    const normalized = normalizeToCard(catalogItem);

    expect(normalized.contentType).toBe('movie');
    expect(normalized.image).toBe('https://img.example.com/backdrop.jpg');
    // The platform and the content type have their own place on the card (platform badge, eyebrow), so the
    // poster chips deliberately do not repeat them (see buildCatalogBadges).
    expect(normalized.platforms).toContain('Netflix');
    expect(normalized.badges).not.toContain('Netflix');
    expect(normalized.badges).not.toContain('Película');
    expect(normalized.detailPath).toContain('/peliculas/');
  });

  it('M10-C: a TMDB title whose work page is known not to show it gets no link (the /plataformas 404)', () => {
    const item: CatalogItem = { catalogId: 'tmdb:tv:1', source: 'tmdb', contentType: 'series', genres: [], primaryPlatforms: ['Disney+'],
      title: "20/20 Britain's Most Notorious Crime Investigations" };
    expect(normalizeToCard(item).detailPath).toBe('/series/2020-britains-most-notorious-crime-investigations');
    expect(normalizeToCard({ ...item, workPathUnresolved: true }).detailPath).toBe('');
  });

  it('keeps base letters of accented characters in movie/series slugs (regression)', () => {
    const catalogItem: CatalogItem = {
      catalogId: 'tmdb:movie:999',
      source: 'tmdb',
      contentType: 'movie',
      title: 'Avatar Aang, el último maestro del aire',
      genres: [],
      primaryPlatforms: [],
    };

    const normalized = normalizeToCard(catalogItem);

    // Legacy slugify dropped the accented vowel entirely ("ltimo"); the
    // movie/series slugifier must keep the base letter so the backend slug
    // lookup and the TMDB search derived from it can resolve the title.
    expect(normalized.detailPath).toBe('/peliculas/avatar-aang-el-ultimo-maestro-del-aire');

    // Program slugs (EPG-sourced) intentionally keep the legacy slugifier to
    // preserve already-indexed public URLs (accented letters are dropped:
    // "fútbol" -> "ftbol", "región" -> "regin").
    const tvItem = makeTvItem({ editorialCategory: 'Deportes', title: 'Fútbol por la región' });
    const program = normalizeToCard(tvItem);
    expect(program.detailPath).toBe('/canales/la-1');
  });

  it('uses resolved episode targets and never guesses URLs from older guide responses', () => {
    const episode = makeTvItem({ editorialCategory: 'Series', title: 'Friends T3 E13' });
    expect(normalizeToCard({ ...episode, detailPath: '/series/friends' }).detailPath).toBe('/series/friends');
    expect(normalizeToCard(episode).detailPath).toBe('/canales/la-1');
    const program: CatalogItem = { catalogId: 'program:1', source: 'program', contentType: 'series', title: 'Friends T3 E13', genres: [], primaryPlatforms: [], channel: { id: 'la-1', name: 'La 1' } };
    expect(normalizeToCard({ ...program, detailPath: '/series/friends' }).detailPath).toBe('/series/friends');
    expect(normalizeToCard(program).detailPath).toBe('/canales/la-1');
  });

  it('prefers the API-verified work page over the noindex airing page (M10)', () => {
    const airing = { ...makeTvItem({ editorialCategory: 'Cine', title: 'Heat' }), detailPath: '/contenido/program:airing-1' };
    expect(normalizeToCard(airing).detailPath).toBe('/contenido/program:airing-1');
    expect(normalizeToCard({ ...airing, program: { ...airing.program, workPath: '/peliculas/heat' } }).detailPath).toBe('/peliculas/heat');
    const program: CatalogItem = { catalogId: 'program:1', source: 'program', contentType: 'movie', title: 'Heat', genres: [], primaryPlatforms: [], detailPath: '/contenido/program:1' };
    expect(normalizeToCard({ ...program, workPath: '/peliculas/heat' }).detailPath).toBe('/peliculas/heat');
  });

  it('links channels by their canonical slug, not the internal id (M10: /canales/dmax -> /canales/discovery)', () => {
    const item = makeTvItem();
    const dmax = { ...item, channel: { ...item.channel, id: 'dmax', normalizedName: 'discovery' } };
    expect(normalizeToCard(dmax).channelPath).toBe('/canales/discovery');
    expect(normalizeToCard(dmax).detailPath).toBe('/canales/discovery');
    expect(normalizeToCard(item).channelPath).toBe('/canales/la-1');
  });

  it('never links /sin-titulo for a title with no slug characters (M10)', () => {
    const hindi: CatalogItem = { catalogId: 'tmdb:tv:1', source: 'tmdb', contentType: 'series', title: 'चार यार', genres: [], primaryPlatforms: [] };
    expect(normalizeToCard(hindi).detailPath).toBe('');
    expect(normalizeToCard({ ...hindi, title: "Ocean's Eleven", contentType: 'movie' }).detailPath).toBe('/peliculas/oceans-eleven');
  });

  it('normalizes editorial labels consistently', () => {
    expect(normalizeCategory('película romántica')).toBe('Cine');
    expect(normalizeCategory('serie de suspense')).toBe('Series');
    expect(normalizeCategory('fútbol internacional')).toBe('Deportes');
    expect(normalizeCategory('')).toBe('Contenido');
  });
});

function makeTvItem(overrides: {
  start?: string;
  end?: string;
  liveNow?: boolean;
  editorialCategory?: string;
  sportFacet?: TvReadItemDTO['program']['sportFacet'];
  title?: string;
} = {}): TvReadItemDTO {
  return {
    id: 'airing-1',
    channel: {
      id: 'la-1',
      name: 'La 1',
      icon: 'https://img.example.com/channel.png',
      sortOrder: 1,
      type: 'TDT',
      group: 'tdt',
    },
    program: {
      brandKey: 'brand-1',
      title: overrides.title || 'Partido estelar',
      normalizedTitle: (overrides.title || 'Partido estelar').toLowerCase(),
      titleAliases: [],
      editorialCategory: overrides.editorialCategory || 'Deportes',
      sportFacet: overrides.sportFacet,
      genre: 'Deportes',
      description: 'Evento en directo',
      isResolvedTitle: true,
    },
    airing: {
      id: 'airing-1',
      date: '20260326',
      start: overrides.start || '2026-03-26T20:00:00.000Z',
      end: overrides.end || '2026-03-26T22:00:00.000Z',
      durationMinutes: 120,
      liveNow: overrides.liveNow ?? false,
      partOfDay: 'noche',
      timeSlotKey: 'prime',
    },
    assets: {
      fallbackChain: [],
      poster: {
        kind: 'poster',
        role: 'primary',
        source: 'tmdb',
        url: 'https://img.example.com/poster.jpg',
      },
      channelLogo: {
        kind: 'channelLogo',
        role: 'primary',
        source: 'channel',
        url: 'https://img.example.com/channel.png',
      },
    },
    availability: {
      live: true,
      catchup: false,
      streaming: false,
    },
    sourceProvenance: {
      schedule: [],
      metadata: [],
      assets: [],
    },
    timingContext: {
      liveNow: overrides.liveNow ?? false,
    },
    relevance: {
      score: 1,
      reason: 'test',
    },
  };
}
