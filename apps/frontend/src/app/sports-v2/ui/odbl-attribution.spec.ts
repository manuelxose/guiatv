import { TestBed } from '@angular/core/testing';
import {
  FOOTBALL_DATA_ORG_ATTRIBUTION, FOOTBALL_DATA_ORG_URL, FOOTBALLDATA_IO_URL, ODBL_DATABASE_URL, ODBL_LICENSE_URL, ODBL_NOTICE_TEXT, SOURCES_NOTICE_TEXT, Sv2OdblAttributionComponent,
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
    const text = (footer?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toBe(SOURCES_NOTICE_TEXT);
    expect(text.startsWith(ODBL_NOTICE_TEXT)).toBeTrue();
  });

  it('links OpenLigaDB to the database URI, the licence label to the ODbL text URI, and credits footballdata.io and football-data.org', () => {
    const el = render();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('footer a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['OpenLigaDB', 'Open Database License (ODbL)', 'footballdata.io', 'Football-Data.org']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([ODBL_DATABASE_URL, ODBL_LICENSE_URL, FOOTBALLDATA_IO_URL, FOOTBALL_DATA_ORG_URL]);
    // football-data.org's terms require this exact wording.
    expect(el.querySelector('footer')?.textContent?.replace(/\s+/g, ' ')).toContain(FOOTBALL_DATA_ORG_ATTRIBUTION);
  });
});
