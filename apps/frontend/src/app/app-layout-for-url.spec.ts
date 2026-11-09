import { layoutForUrl } from './app.component';
import { routes } from './app.routes';

describe('layoutForUrl (shell chosen before the router resolves)', () => {
  it('matches the layout the router would give, from the real route config', () => {
    expect(layoutForUrl('/', routes)).toBe('portal-page');
    expect(layoutForUrl('/deportes/futbol', routes)).toBe('minimal-shell');
    expect(layoutForUrl('/deportes/futbol/resultados?x=1', routes)).toBe('minimal-shell');
    expect(layoutForUrl('/perfil', routes)).toBe('private-shell');
    expect(layoutForUrl('/perfil/abc123', routes)).toBe('public-shell');
    expect(layoutForUrl('/canales/la-1', routes)).toBe('public-shell');
    expect(layoutForUrl('/admin', routes)).toBe('admin-shell');
    expect(layoutForUrl('/programacion-tv/en-directo', routes)).toBe('portal-page');
    expect(layoutForUrl('/privacidad', routes)).toBe('minimal-shell');
  });

  it('never lets a leaf route swallow a longer path, and falls back to the not-found layout', () => {
    expect(layoutForUrl('/canales/la-1/extra', routes)).toBe('public-shell'); // '**'
    expect(layoutForUrl('/no-existe', routes)).toBe('public-shell');
  });
});
