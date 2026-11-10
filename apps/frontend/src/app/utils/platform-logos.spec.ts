import { resolvePlatformLogoUrl } from './platform-logos';

const PLATFORM_LOGO_BASE = '/assets/images/platforms';

describe('resolvePlatformLogoUrl', () => {
  const platforms: ReadonlyArray<readonly [string, string]> = [
    ['Netflix', 'netflix'],
    ['Prime Video', 'prime-video'],
    ['Amazon Prime Video', 'prime-video'],
    ['Disney+', 'disney-plus'],
    ['HBO Max', 'hbo-max'],
    ['Max', 'hbo-max'],
    ['Movistar+', 'movistar-plus'],
    ['Movistar Plus+', 'movistar-plus'],
    ['SkyShowtime', 'skyshowtime'],
    ['Apple TV+', 'apple-tv-plus'],
    ['Filmin', 'filmin'],
    ['RTVE Play', 'rtve-play'],
    ['ATRESplayer', 'atresplayer'],
    ['Mitele', 'mitele'],
    ['Pluto TV', 'pluto-tv'],
    ['Rakuten TV', 'rakuten-tv'],
    ['MUBI', 'mubi'],
    ['Starz', 'starz'],
  ];

  for (const [label, file] of platforms) {
    it(`should resolve the self-hosted brand mark for ${label}`, () => {
      expect(resolvePlatformLogoUrl(label)).toBe(`${PLATFORM_LOGO_BASE}/${file}.png`);
    });
  }

  it('should prefer the provided logo URL over the keyword fallback', () => {
    expect(resolvePlatformLogoUrl('Netflix', 'https://cdn.example.test/netflix.png')).toBe(
      'https://cdn.example.test/netflix.png'
    );
  });

  it('should downsize a provided TMDB logo to the w92 variant', () => {
    expect(resolvePlatformLogoUrl('Netflix', 'https://image.tmdb.org/t/p/original/abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/w92/abc.jpg'
    );
  });

  it('should return an empty URL when the platform has no brand mark', () => {
    expect(resolvePlatformLogoUrl('Plataforma Desconocida')).toBe('');
  });
});
