import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Match, Team } from '../domain/models';
import { SPORTS_NOW } from '../data/football-data';
import { Sv2FollowButtonComponent } from './follow-button';
import { Sv2MatchRowComponent } from './match-row';
import { Sv2ScoreDisplayComponent } from './score-display';
import { Sv2TabsComponent } from './tabs';

const home: Team = { slug: 'a', name: 'Alfa', shortName: 'ALF', hue: 10 };
const away: Team = { slug: 'b', name: 'Beta', shortName: 'BET', hue: 200 };
const match = (over: Partial<Match> = {}): Match => ({
  slug: 'a-b-2026-11-05', competitionSlug: 'c', homeSlug: 'a', awaySlug: 'b', status: 'live', kickoff: '2026-11-05T19:00:00Z', minute: 55, homeScore: 1, awayScore: 0, events: [], stats: [], broadcasts: [], ...over,
});

describe('sports-v2 Sv2MatchRowComponent', () => {
  let now = new Date('2026-11-05T12:00:00Z');
  beforeEach(() => {
    now = new Date('2026-11-05T12:00:00Z');
    TestBed.configureTestingModule({ providers: [{ provide: SPORTS_NOW, useValue: () => now }] });
  });

  function render(m: Match) {
    const fixture = TestBed.createComponent(Sv2MatchRowComponent);
    fixture.componentRef.setInput('match', m);
    fixture.componentRef.setInput('home', home);
    fixture.componentRef.setInput('away', away);
    fixture.componentRef.setInput('competitionName', 'Liga');
    fixture.detectChanges();
    return fixture;
  }

  it('shows minute and both scores for a live match, with a full spoken description', () => {
    const el = render(match()).nativeElement as HTMLElement;
    expect(el.querySelector('.clock')?.textContent).toContain("55'");
    expect(Array.from(el.querySelectorAll('.scores b')).map((b) => b.textContent)).toEqual(['1', '0']);
    expect(el.querySelector('.body')?.getAttribute('aria-label')).toBe('Liga. Alfa 1, Beta 0, en vivo, minuto 55. Ver detalle del partido');
  });

  it('shows kickoff time and empty (but present) score cells for a scheduled match', () => {
    const el = render(match({ status: 'scheduled', minute: undefined, homeScore: undefined, awayScore: undefined })).nativeElement as HTMLElement;
    expect(el.querySelector('.clock')?.textContent).toMatch(/\d\d:\d\d/);
    expect(el.querySelectorAll('.scores b').length).toBe(2); // cells keep their width: no layout shift when scores arrive
    expect(el.querySelector('.scores')?.textContent?.trim()).toBe('');
  });

  it('says "Sin resultado" for a match no provider has confirmed hours after kickoff', () => {
    now = new Date('2026-11-06T10:00:00Z');
    const el = render(match({ status: 'scheduled', minute: undefined, homeScore: undefined, awayScore: undefined })).nativeElement as HTMLElement;
    expect(el.querySelector('.clock')?.textContent).toContain('Sin resultado');
  });

  it('marks postponed matches without a score', () => {
    const el = render(match({ status: 'postponed', minute: undefined, homeScore: undefined, awayScore: undefined })).nativeElement as HTMLElement;
    expect(el.querySelector('.clock')?.textContent).toContain('Aplazado');
  });

  it('emits select and save from two sibling buttons (no nested interactive elements)', () => {
    const fixture = render(match());
    const events: string[] = [];
    fixture.componentInstance.matchSelect.subscribe((s) => events.push(`select:${s}`));
    fixture.componentInstance.saveToggle.subscribe((s) => events.push(`save:${s}`));
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.body') as HTMLElement).click();
    (el.querySelector('.save') as HTMLElement).click();
    expect(events).toEqual(['select:a-b-2026-11-05', 'save:a-b-2026-11-05']);
    expect(el.querySelector('button button')).toBeNull();
  });

  it('reflects saved state in aria-pressed and its label', () => {
    const fixture = render(match());
    fixture.componentRef.setInput('saved', true);
    fixture.detectChanges();
    const save = (fixture.nativeElement as HTMLElement).querySelector('.save') as HTMLElement;
    expect(save.getAttribute('aria-pressed')).toBe('true');
    expect(save.getAttribute('aria-label')).toContain('Quitar de guardados');
  });
});

describe('sports-v2 Sv2ScoreDisplayComponent', () => {
  it('reserves a minimum width per digit so score changes do not shift layout', () => {
    const fixture = TestBed.createComponent(Sv2ScoreDisplayComponent);
    fixture.componentRef.setInput('home', 1);
    fixture.componentRef.setInput('away', 0);
    fixture.componentRef.setInput('status', 'live');
    fixture.detectChanges();
    const n = (fixture.nativeElement as HTMLElement).querySelector('.n') as HTMLElement;
    expect(getComputedStyle(n).minWidth).not.toBe('0px');
    expect(getComputedStyle(fixture.nativeElement).fontVariantNumeric).toContain('tabular-nums');
  });
});

describe('sports-v2 Sv2TabsComponent', () => {
  @Component({
    standalone: true,
    imports: [Sv2TabsComponent],
    template: `<app-sv2-tabs [tabs]="tabs" [selected]="sel()" label="Demo" prefix="t" (tabSelect)="sel.set($event)" />`,
  })
  class Host {
    tabs = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    sel = signal('a');
  }
  const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  it('follows the tablist pattern: roving tabindex and aria-selected', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const tabs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]'));
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=tablist]')?.getAttribute('aria-label')).toBe('Demo');
  });

  it('moves with arrows, wraps around and supports Home/End', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tab = (id: string) => el.querySelector<HTMLElement>(`#t-tab-${id}`) as HTMLElement;
    key(tab('a'), 'ArrowLeft');
    fixture.detectChanges();
    expect(fixture.componentInstance.sel()).toBe('c');
    key(tab('c'), 'ArrowRight');
    fixture.detectChanges();
    expect(fixture.componentInstance.sel()).toBe('a');
    key(tab('a'), 'End');
    fixture.detectChanges();
    expect(fixture.componentInstance.sel()).toBe('c');
    key(tab('c'), 'Home');
    fixture.detectChanges();
    expect(fixture.componentInstance.sel()).toBe('a');
  });
});

describe('sports-v2 Sv2FollowButtonComponent', () => {
  it('names its subject and flips state', () => {
    const fixture = TestBed.createComponent(Sv2FollowButtonComponent);
    fixture.componentRef.setInput('subject', 'Alfa');
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('Seguir Alfa');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fixture.componentRef.setInput('following', true);
    fixture.detectChanges();
    expect(btn.getAttribute('aria-label')).toBe('Dejar de seguir Alfa');
    expect(btn.textContent).toContain('Siguiendo');
  });
});
