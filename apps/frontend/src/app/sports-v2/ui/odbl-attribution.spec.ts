import { TestBed } from '@angular/core/testing';
import {
  ODBL_DATABASE_URL, ODBL_LICENSE_URL, ODBL_NOTICE_TEXT, Sv2OdblAttributionComponent,
} from './odbl-attribution';

describe('sports-v2 Sv2OdblAttributionComponent', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({ imports: [Sv2OdblAttributionComponent] });
    const fixture = TestBed.createComponent(Sv2OdblAttributionComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the exact ODbL 4.3 notice as real text inside a contentinfo landmark', () => {
    const footer = render().querySelector('footer');
    expect(footer?.getAttribute('role')).toBe('contentinfo');
    expect((footer?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(ODBL_NOTICE_TEXT);
  });

  it('links OpenLigaDB to the database URI and the licence label to the ODbL text URI', () => {
    const links = Array.from(render().querySelectorAll<HTMLAnchorElement>('footer a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['OpenLigaDB', 'Open Database License (ODbL)']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([ODBL_DATABASE_URL, ODBL_LICENSE_URL]);
  });
});
