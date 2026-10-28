import { catalogRobotsPolicy } from './catalog-indexability';

describe('catalogRobotsPolicy', () => {
  it('indexes first-party TV program detail pages', () => {
    expect(catalogRobotsPolicy({ source: 'program', contentType: 'program' })).toContain('index, follow');
  });

  it('M09-C: an applied work policy decides, with or without airings', () => {
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'movie', airings: [], seo: { applied: true } })).toContain('index, follow');
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'series', seo: { applied: true } })).not.toContain('noindex');
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'movie', airings: [{}], seo: { applied: true, robots: 'noindex, follow' } })).toBe('noindex, follow');
  });

  it('without the work policy, indexes film and series pages only when GuíaTV contributes a current airing', () => {
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'movie', airings: [{}] })).toContain('index, follow');
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'series', airings: [] })).toBe('noindex, follow');
    expect(catalogRobotsPolicy({ source: 'tmdb', contentType: 'movie' })).toBe('noindex, follow');
  });
});
