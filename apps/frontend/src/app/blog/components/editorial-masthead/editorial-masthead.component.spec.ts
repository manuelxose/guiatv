import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EditorialMastheadComponent } from './editorial-masthead.component';

describe('EditorialMastheadComponent', () => {
  it('gives the /guias heading words separated by a space (was "Guíasde streaming")', () => {
    TestBed.configureTestingModule({ imports: [EditorialMastheadComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(EditorialMastheadComponent);
    fixture.detectChanges();
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1')!;
    expect(heading.textContent!.replace(/\s+/g, ' ').trim()).toBe('Guías de streaming, fútbol y TV');
  });
});
