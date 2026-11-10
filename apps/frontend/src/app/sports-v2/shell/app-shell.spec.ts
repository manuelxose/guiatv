import { TestBed } from '@angular/core/testing';
import { SportsStore } from '../state/sports-store';
import { sv2TestProviders, TEST_TODAY } from '../testing/providers';
import { NAV_ITEMS } from './nav-items';
import { ODBL_DATABASE_URL, ODBL_LICENSE_URL, ODBL_NOTICE_TEXT, SOURCES_NOTICE_TEXT } from '../ui/odbl-attribution';
import { Sv2AppShellComponent } from './app-shell';
import { Sv2OdblAttributionComponent } from '../ui/odbl-attribution';

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
    expect(el.querySelector('main#panel-main')).toBeTruthy();
    expect(el.querySelector('a.skip')).toBeTruthy();
    expect(el.querySelectorAll('nav.subnav[aria-label="Mi fútbol"] a').length).toBe(NAV_ITEMS.length);
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
    expect(el.querySelector('.shell')?.classList.contains('no-ctx')).toBeTrue();
  });

  it('toggles the collapsed sidebar class', async () => {
    const fixture = await render();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.side-toggle')!.click();
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

  it('renders the exact ODbL notice component with both required links, then the footballdata.io credit', () => {
    // The shell only shows the notice for REAL ingested data (never for demo), so
    // this asserts the component contract itself: exact 4.3 wording + both links.
    TestBed.configureTestingModule({ imports: [Sv2OdblAttributionComponent] });
    const fixture = TestBed.createComponent(Sv2OdblAttributionComponent);
    fixture.detectChanges();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer[role="contentinfo"]');
    const text = (footer?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text.startsWith(ODBL_NOTICE_TEXT)).toBeTrue();
    expect(text).toBe(SOURCES_NOTICE_TEXT);
    const links = Array.from(footer?.querySelectorAll('a') ?? []) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href')).slice(0, 2)).toEqual([ODBL_DATABASE_URL, ODBL_LICENSE_URL]);
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

