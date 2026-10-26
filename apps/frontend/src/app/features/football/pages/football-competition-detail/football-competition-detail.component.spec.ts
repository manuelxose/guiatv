import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { groupByRound, FootballCompetitionDetailComponent } from './football-competition-detail.component';
import { FootballFacade } from '@app/features/football/football.facade';
import { FootballCompetitionDetailDTO, FootballMatchDTO } from '@app/features/football/football.models';
import { MetaService } from '@app/services/meta.service';
import { AffiliateService } from '@app/services/affiliate.service';
import { FootballBroadcastListComponent } from '@app/features/football/components/football-broadcast-list/football-broadcast-list.component';

function match(id: string, round?: string): FootballMatchDTO {
  return {
    id,
    slug: id,
    providerIds: {},
    competition: { id: 'c1', slug: 'laliga', name: 'LaLiga' },
    round,
    kickoffAt: '2026-08-21T19:00:00.000Z',
    status: 'scheduled',
    homeTeam: { id: 'h', slug: 'h', name: 'Home', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    awayTeam: { id: 'a', slug: 'a', name: 'Away', aliases: [], providerIds: {}, lastUpdatedAt: '' },
    score: { home: null, away: null },
    broadcasts: [],
    sourceProvenance: { source: 'test', confidence: 'high' },
    lastUpdatedAt: '',
  };
}

describe('groupByRound', () => {
  it('groups matches under their round label', () => {
    const groups = groupByRound([match('1', 'Jornada 1'), match('2', 'Jornada 1'), match('3', 'Jornada 2')]);
    expect(groups.length).toBe(2);
    expect(groups.find((g) => g.round === 'Jornada 1')?.matches.length).toBe(2);
  });

  it('falls back to a single "Partidos" bucket when round is missing (EPG-sourced matches)', () => {
    const groups = groupByRound([match('1'), match('2')]);
    expect(groups.length).toBe(1);
    expect(groups[0].round).toBe('Partidos');
  });

  it('returns an empty array for no matches', () => {
    expect(groupByRound([])).toEqual([]);
  });
});

function detail(): FootballCompetitionDetailDTO {
  return {
    competition: { id: 'c1', slug: 'laliga', name: 'LaLiga', type: 'league', providerIds: {}, lastUpdatedAt: '' },
    matches: [],
    standings: [],
    news: [],
    meta: {},
  };
}

describe('FootballCompetitionDetailComponent (SEO/meta regression)', () => {
  // Same bug class fixed in football-match-detail: meta must never default
  // to noindex before the real found/not-found outcome is known.
  function setup(result: FootballCompetitionDetailDTO | null, fragment = new BehaviorSubject<string | null>(null)) {
    const setMetaTags = jasmine.createSpy('setMetaTags');
    TestBed.configureTestingModule({
      imports: [FootballCompetitionDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'laliga' })), fragment } },
        { provide: FootballFacade, useValue: { getCompetition: () => of(result) } },
        { provide: MetaService, useValue: { setMetaTags } },
      ],
    });
    const fixture = TestBed.createComponent(FootballCompetitionDetailComponent);
    fixture.detectChanges();
    return { setMetaTags, fixture };
  }

  it('a found competition never ends up noindex', () => {
    const { setMetaTags } = setup(detail());
    const lastCall = setMetaTags.calls.mostRecent().args[0];
    expect(lastCall.robots).toBeUndefined();
    expect(lastCall.title).toContain('LaLiga');
  });

  it('a genuinely missing competition ends up noindex', () => {
    const { setMetaTags } = setup(null);
    const lastCall = setMetaTags.calls.mostRecent().args[0];
    expect(lastCall.robots).toBe('noindex, follow');
  });

  it('opens the linked standings tab after rendering and handles supported fragment changes without altering canonical', async () => {
    const fragment = new BehaviorSubject<string | null>('clasificacion');
    const { fixture, setMetaTags } = setup(detail(), fragment);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('clasificacion');
    expect(fixture.nativeElement.querySelector('app-football-standings-table')).toBeTruthy();
    fragment.next('calendario');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-football-filter-bar')).toBeTruthy();
    fragment.next('unsupported');
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('resumen');
    expect(setMetaTags.calls.mostRecent().args[0].canonicalUrl).toBe('/deportes/futbol/competiciones/laliga');
  });
});

describe('FootballCompetitionDetailComponent — "where to watch" is scoped to the single next match', () => {
  it('shows live and halftime matches in the summary instead of an empty state', () => {
    TestBed.configureTestingModule({
      imports: [FootballCompetitionDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'laliga' })), fragment: of(null) } },
        { provide: FootballFacade, useValue: { getCompetition: () => of({ ...detail(), matches: [
          { ...match('live'), status: 'live' }, { ...match('halftime'), status: 'halftime' },
        ] }) } },
        { provide: MetaService, useValue: { setMetaTags: () => {} } },
      ],
    });
    const fixture = TestBed.createComponent(FootballCompetitionDetailComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.liveMatches().map((item) => item.id)).toEqual(['live', 'halftime']);
    expect(fixture.nativeElement.querySelector('.block--live')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Sin información disponible por ahora');
    fixture.componentInstance.selectTab('calendario');
    fixture.componentInstance.onFilterChange('finished');
    fixture.detectChanges();
    const reset = fixture.nativeElement.querySelector('.empty button') as HTMLButtonElement;
    expect(reset.textContent).toContain('Ver todos');
    reset.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-football-match-row').length).toBe(2);
  });

  function nextMatch(): FootballMatchDTO {
    return {
      id: 'next-1',
      slug: 'next-1',
      providerIds: {},
      competition: { id: 'c1', slug: 'laliga', name: 'LaLiga' },
      kickoffAt: '2026-08-21T19:00:00.000Z',
      status: 'scheduled',
      homeTeam: { id: 'h', slug: 'h', name: 'Home', aliases: [], providerIds: {}, lastUpdatedAt: '' },
      awayTeam: { id: 'a', slug: 'a', name: 'Away', aliases: [], providerIds: {}, lastUpdatedAt: '' },
      score: { home: null, away: null },
      broadcasts: [{ channelId: 'c', channelName: 'DAZN', availability: 'streaming', provenance: 'airing', confidence: 'high' }],
      sourceProvenance: { source: 'test', confidence: 'high' },
      lastUpdatedAt: '',
    };
  }

  it('renders the broadcast list, enabled for affiliate CTAs, only for upcomingPreview()[0]', () => {
    TestBed.configureTestingModule({
      imports: [FootballCompetitionDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'laliga' })), fragment: of(null) } },
        {
          provide: FootballFacade,
          useValue: { getCompetition: () => of({ ...detail(), matches: [nextMatch()] }) },
        },
        { provide: MetaService, useValue: { setMetaTags: () => {} } },
        { provide: AffiliateService, useValue: { resolveMany: () => of([]), buildOutboundUrl: () => null } },
      ],
    });

    const fixture = TestBed.createComponent(FootballCompetitionDetailComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.nextMatch()?.id).toBe('next-1');

    const broadcastList = fixture.debugElement.query(
      (de) => de.componentInstance instanceof FootballBroadcastListComponent
    );
    expect(broadcastList).toBeTruthy();
    expect((broadcastList!.componentInstance as FootballBroadcastListComponent).enableAffiliateCta).toBe(true);
  });

  it('renders no broadcast list when the competition has no upcoming match', () => {
    TestBed.configureTestingModule({
      imports: [FootballCompetitionDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'laliga' })), fragment: of(null) } },
        { provide: FootballFacade, useValue: { getCompetition: () => of(detail()) } },
        { provide: MetaService, useValue: { setMetaTags: () => {} } },
      ],
    });

    const fixture = TestBed.createComponent(FootballCompetitionDetailComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.nextMatch()).toBeNull();
  });
});
