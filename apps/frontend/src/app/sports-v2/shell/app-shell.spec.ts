import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DemoFootballData, FootballData } from '../data/football-data';
import { SportsStore } from '../state/sports-store';
import { Sv2AppShellComponent } from './app-shell';

describe('sports-v2 Sv2AppShellComponent', () => {
  async function render() {
    TestBed.configureTestingModule({
      imports: [Sv2AppShellComponent],
      providers: [provideRouter([]), { provide: FootballData, useClass: DemoFootballData }, SportsStore],
    });
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
    expect(el.querySelectorAll('nav[aria-label="Mi fútbol"] ul:first-of-type a').length).toBe(6);
    expect(el.querySelectorAll('nav.tabbar a').length).toBe(5);
  });

  it('shows the selected live match in the Match Center', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(el.querySelector('app-sv2-context-panel')?.textContent).toContain('Real Costa');
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
    TestBed.inject(SportsStore).toggleTracked('real-costa-racing-sur-demo-01');
    fixture.detectChanges();
    expect(el.querySelector('.tracker')).toBeTruthy();
  });
});
