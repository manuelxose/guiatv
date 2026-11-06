import { TestBed } from '@angular/core/testing';
import { SportsStore } from '../state/sports-store';
import { sv2TestProviders, TEST_TODAY } from '../testing/providers';
import { ODBL_DATABASE_URL, ODBL_LICENSE_URL, ODBL_NOTICE_TEXT } from '../ui/odbl-attribution';
import { Sv2AppShellComponent } from './app-shell';

describe('sports-v2 Sv2AppShellComponent', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [Sv2AppShellComponent], providers: sv2TestProviders() });
    const fixture = TestBed.createComponent(Sv2AppShellComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the required landmarks and navigation', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('header')).toBeTruthy();
    expect(el.querySelector('main#sv2-main')).toBeTruthy();
    expect(el.querySelector('a.skip')).toBeTruthy();
    expect(el.querySelectorAll('nav[aria-label="Mi fútbol"] ul:first-of-type a').length).toBe(8);
    expect(el.querySelectorAll('nav.tabbar a').length).toBe(5);
  });

  it('labels demo data visibly', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('.demo')?.textContent).toContain('ficticios');
  });

  it('shows the selected live match in the Match Center, with a link to the full page', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const panel = el.querySelector('app-sv2-context-panel') as HTMLElement;
    expect(panel.textContent).toContain('Real Costa');
    expect(panel.querySelector('a[aria-label^="Abrir el partido"]')?.getAttribute('href')).toContain(`/partido/real-costa-racing-sur-${TEST_TODAY}`);
  });

  it('replaces the sidebar with the full page when the match page is open', async () => {
    const fixture = await render();
    TestBed.inject(SportsStore).matchPageOpen.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-sv2-context-panel')).toBeNull();
    expect(el.querySelector('.shell')?.classList.contains('expanded')).toBeTrue();
  });

  it('toggles the collapsed sidebar class', async () => {
    const fixture = await render();
    TestBed.inject(SportsStore).toggleSidebar();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.shell')?.classList.contains('collapsed')).toBeTrue();
  });

  it('shows the live tracker only after tracking a match', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tracker')).toBeNull();
    TestBed.inject(SportsStore).toggleTracked(`real-costa-racing-sur-${TEST_TODAY}`);
    fixture.detectChanges();
    expect(el.querySelector('.tracker')).toBeTruthy();
  });

  it('closes the Match Center drawer on Escape', async () => {
    const fixture = await render();
    const store = TestBed.inject(SportsStore);
    store.contextOpen.set(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(store.contextOpen()).toBeFalse();
  });

  it('renders the exact ODbL notice on every page, with both required links', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    const footer = el.querySelector('footer[role="contentinfo"]');
    expect((footer?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(ODBL_NOTICE_TEXT);
    const links = Array.from(footer?.querySelectorAll('a') ?? []) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([ODBL_DATABASE_URL, ODBL_LICENSE_URL]);
  });

  it('shows no ODbL attribution for demo (fictitious) data', async () => {
    // The shell test store renders demo data, so attributing it to OpenLigaDB
    // would be a false statement. The full-page Match Center renders OUTSIDE the
    // shell and carries its own notice (see match-page.ts).
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('.demo')).toBeTruthy();
    expect(el.querySelector('footer[role="contentinfo"]')).toBeNull();
  });
});
