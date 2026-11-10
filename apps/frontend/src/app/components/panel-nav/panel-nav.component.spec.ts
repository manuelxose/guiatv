import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PanelNavComponent, PanelNavGroup } from './panel-nav.component';

describe(PanelNavComponent.name, () => {
  let fixture: ComponentFixture<PanelNavComponent>;

  const render = (groups: PanelNavGroup[]): HTMLElement => {
    fixture = TestBed.createComponent(PanelNavComponent);
    fixture.componentRef.setInput('title', 'Canales');
    fixture.componentRef.setInput('links', []);
    fixture.componentRef.setInput('groups', groups);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanelNavComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should render the given logo when a menu link carries one', () => {
    const el = render([{ title: 'Canales', links: [{ label: 'La 1', path: '/canales/la-1', logoUrl: '/storage/channel_icons/la_1.webp' }] }]);

    expect(el.querySelector('img')?.getAttribute('src')).toBe('/storage/channel_icons/la_1.webp');
  });

  it('should resolve the platform brand mark when the link label names a platform', () => {
    const el = render([{ title: 'Plataforma', links: [{ label: 'HBO Max', path: '/plataformas', active: false }] }]);

    expect(el.querySelector('img')?.getAttribute('src')).toBe('/assets/images/platforms/hbo-max.png');
  });

  it('should fall back to the initial when the logo fails to load', () => {
    const el = render([{ title: 'Canales', links: [{ label: 'La 1', path: '/canales/la-1', logoUrl: '/storage/channel_icons/missing.webp' }] }]);

    el.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.initial')?.textContent).toBe('L');
  });

  it('should keep the initial when the label matches no brand mark', () => {
    const el = render([{ title: 'Canales', links: [{ label: 'Cine', path: '/canales' }] }]);

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.initial')?.textContent).toBe('C');
  });

  it('should leave a filter option without a logo when the label matches no brand mark', () => {
    const el = render([{ title: 'Acceso', links: [{ label: 'Gratis', path: '/plataformas', active: false }] }]);

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.radio')).not.toBeNull();
  });
});
