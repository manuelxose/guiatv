import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { ChatService } from '../../services/chat.service';
import { ThemeService } from '../../services/theme.service';
import { UserService } from '../../services/user.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { UnifiedSearchComponent } from '../unified-search/unified-search.component';
import { UnifiedTopNavComponent } from './unified-top-nav.component';

@Component({
  standalone: true,
  imports: [UnifiedTopNavComponent],
  template: `<app-unified-top-nav brandSuffix="Sports"><form utnSearch class="custom-search"></form></app-unified-top-nav>`,
})
class ProjectedSearchHostComponent {}

describe('UnifiedTopNavComponent', () => {
  const authenticated = new BehaviorSubject(false);
  const theme = { resolved: 'dark', toggle: jasmine.createSpy('toggle') };

  beforeEach(() => {
    authenticated.next(false);
    theme.toggle.calls.reset();
    TestBed.configureTestingModule({
      imports: [UnifiedTopNavComponent, ProjectedSearchHostComponent],
      providers: [
        provideRouter([]),
        { provide: ThemeService, useValue: theme },
        { provide: ChatService, useValue: { requestToggleAssistant: jasmine.createSpy('requestToggleAssistant') } },
        { provide: UserService, useValue: { isAuthenticated$: authenticated, getProfile: () => of({ name: 'Ana' }) } },
      ],
    }).overrideComponent(UnifiedTopNavComponent, {
      remove: { imports: [UnifiedSearchComponent, NotificationBellComponent] },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    });
  });

  function render() {
    const fixture = TestBed.createComponent(UnifiedTopNavComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links the logo home and every top-level section', () => {
    const el = render();
    expect(el.querySelector('.utn__brand')?.getAttribute('href')).toBe('/');
    const links = Array.from(el.querySelectorAll('#utn-sections a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Inicio', 'TV', 'Qué ver', 'Plataformas', 'Fútbol', 'Guías']);
  });

  it('toggles the theme', () => {
    const el = render();
    (el.querySelector('[aria-label="Cambiar a tema claro"]') as HTMLButtonElement).click();
    expect(theme.toggle).toHaveBeenCalled();
  });

  it('sends anonymous visitors from the bell to login, and shows the real bell once signed in', () => {
    const fixture = TestBed.createComponent(UnifiedTopNavComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[aria-label^="Notificaciones"]')?.getAttribute('href')).toBe('/iniciar-sesion');
    expect(el.querySelector('app-notification-bell')).toBeNull();

    authenticated.next(true);
    fixture.detectChanges();
    expect(el.querySelector('app-notification-bell')).toBeTruthy();
    expect(el.querySelector('a[aria-label="Mi cuenta: Ana"]')?.getAttribute('href')).toBe('/perfil');
  });

  it('opens the collapsed sections menu', () => {
    const fixture = TestBed.createComponent(UnifiedTopNavComponent);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector('.utn__more') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses a projected search instead of the global one, and shows the sub-brand', () => {
    const fixture = TestBed.createComponent(ProjectedSearchHostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.utn__search .custom-search')).toBeTruthy();
    expect(el.querySelector('app-unified-search')).toBeNull();
    expect(el.querySelector('.utn__word b')?.textContent).toBe('Sports');
  });
});
