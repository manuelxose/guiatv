import { TestBed } from '@angular/core/testing';
import { DataAvailability } from '../data/availability';
import { Match, MatchEvent, MatchStat } from '../domain/models';
import { sv2TestProviders } from '../testing/providers';
import { Sv2MatchDataStatusComponent } from './match-data-status';
import { Sv2MatchEventsTimelineComponent } from './match-events-timeline';
import { Sv2MatchLineupsComponent } from './match-lineups';
import { Sv2MatchStatisticsComponent } from './match-statistics';

const matchBase = (over: Partial<Match> = {}): Match => ({
  slug: 's', competitionSlug: 'c', homeSlug: 'a', awaySlug: 'b', status: 'live', kickoff: '2026-11-05T20:00:00Z', minute: 60, homeScore: 1, awayScore: 0, broadcasts: [], ...over,
});

describe('sports-v2 match data components', () => {
  describe('Sv2MatchDataStatusComponent', () => {
    const render = (availability: DataAvailability, noun = 'estadísticas') => {
      const fixture = TestBed.createComponent(Sv2MatchDataStatusComponent);
      fixture.componentRef.setInput('availability', availability);
      fixture.componentRef.setInput('noun', noun);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('renders an explicit message for every availability state', () => {
      expect(render('loading').textContent).toContain('Cargando datos');
      expect(render('fresh').textContent).toContain('Datos actualizados');
      expect(render('stale').textContent).toContain('Datos desactualizados');
      expect(render('provider_unavailable').textContent).toContain('Proveedor no disponible');
      expect(render('unavailable', 'estadísticas').textContent).toContain('No hay estadísticas disponibles');
      expect(render('competition_not_covered').textContent).toContain('Competición sin cobertura');
    });
  });

  describe('Sv2MatchStatisticsComponent', () => {
    const render = (stats: readonly MatchStat[] | undefined, availability: DataAvailability = 'fresh') => {
      const fixture = TestBed.createComponent(Sv2MatchStatisticsComponent);
      fixture.componentRef.setInput('match', matchBase({ stats }));
      fixture.componentRef.setInput('availability', availability);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('never renders an absent statistic as 0 and keeps a real 0', () => {
      const el = render([
        { label: 'Posesión', home: 54, away: 46, unit: '%' },
        { label: 'Fueras de juego', home: 0, away: 3 },
        { label: 'Remates', home: 12 },
      ]);
      const rows = Array.from(el.querySelectorAll('.srow'));
      expect(rows[0].textContent).toContain('54%');
      expect(rows[1].textContent).toContain('0');
      expect(rows[1].textContent).not.toContain('n/d');
      expect(rows[2].textContent).toContain('n/d');
      expect(rows[2].textContent).not.toContain('0');
      expect(rows[2].querySelector('[aria-label="No disponible"]')).toBeTruthy();
    });

    it('renders the unavailable message when there are no statistics', () => {
      const el = render(undefined, 'unavailable');
      expect(el.textContent).toContain('No hay estadísticas disponibles');
    });
  });

  describe('Sv2MatchEventsTimelineComponent', () => {
    it('renders events in order with injury time, own goals and disallowed goals distinguished', () => {
      TestBed.configureTestingModule({ imports: [Sv2MatchEventsTimelineComponent], providers: sv2TestProviders() });
      const fixture = TestBed.createComponent(Sv2MatchEventsTimelineComponent);
      fixture.componentRef.setInput('match', matchBase({
        events: [
          { minute: 12, type: 'own_goal', side: 'away', player: 'Vidal' },
          { minute: 40, type: 'goal_disallowed', side: 'home', player: 'Ortega' },
          { minute: 90, addedMinute: 2, type: 'goal', side: 'home', player: 'L. Prieto' },
        ],
      }));
      fixture.componentRef.setInput('availability', 'fresh');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const mins = Array.from(el.querySelectorAll('.min')).map((m) => m.textContent?.trim());
      expect(mins).toEqual(["12'", "40'", "90' +2"]);
      const items = Array.from(el.querySelectorAll('.timeline li'));
      expect(items[0].textContent).toContain('Gol en propia puerta');
      expect(items[1].textContent).toContain('Gol anulado');
      expect(items[2].textContent).toContain('+2');
      expect(items[0].classList.contains('away')).toBeTrue();
    });

    it('renders the unavailable message when there are no events', () => {
      TestBed.configureTestingModule({ imports: [Sv2MatchEventsTimelineComponent], providers: sv2TestProviders() });
      const fixture = TestBed.createComponent(Sv2MatchEventsTimelineComponent);
      fixture.componentRef.setInput('match', matchBase({ status: 'finished', homeScore: 1, awayScore: 0, events: undefined }));
      fixture.componentRef.setInput('availability', 'unavailable');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No hay eventos disponibles');
    });
  });

  describe('Sv2MatchLineupsComponent', () => {
    it('renders coach, formation, starters and bench', () => {
      TestBed.configureTestingModule({ imports: [Sv2MatchLineupsComponent], providers: sv2TestProviders() });
      const fixture = TestBed.createComponent(Sv2MatchLineupsComponent);
      fixture.componentRef.setInput('match', matchBase({
        lineups: {
          home: { formation: '4-3-3', coach: 'C. Táctico', starters: [{ number: 9, name: 'Ortega', position: 'DEL' }], bench: [{ name: 'Rey' }] },
          away: { formation: '4-4-2' },
        },
      }));
      fixture.componentRef.setInput('availability', 'fresh');
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('4-3-3');
      expect(el.textContent).toContain('Entrenador: C. Táctico');
      expect(el.textContent).toContain('Ortega');
      expect(el.textContent).toContain('Banquillo');
    });

    it('renders the unavailable message when there are no lineups', () => {
      TestBed.configureTestingModule({ imports: [Sv2MatchLineupsComponent], providers: sv2TestProviders() });
      const fixture = TestBed.createComponent(Sv2MatchLineupsComponent);
      fixture.componentRef.setInput('match', matchBase({ status: 'finished', homeScore: 1, awayScore: 0, lineups: undefined }));
      fixture.componentRef.setInput('availability', 'unavailable');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No hay alineaciones disponibles');
    });
  });
});
