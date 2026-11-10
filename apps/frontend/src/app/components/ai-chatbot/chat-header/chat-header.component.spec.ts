import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatHeaderComponent } from './chat-header.component';

describe('ChatHeaderComponent', () => {
  let fixture: ComponentFixture<ChatHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChatHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChatHeaderComponent);
    fixture.componentInstance.isAuthenticated = true;
    fixture.componentInstance.profileIncomplete = true;
    fixture.componentInstance.knowledge = 40;
    fixture.detectChanges();
  });

  const labels = () => fixture.debugElement.queryAll(By.css('button')).map((button) => button.attributes['aria-label']);

  it('keeps the primary assistant actions directly accessible', () => {
    expect(labels()).toContain('Tus conversaciones');
    expect(labels()).toContain('Nueva conversación');
    expect(labels()).toContain('Más opciones');
    expect(labels()).toContain('Cerrar asistente');
  });

  it('shows how well the assistant knows the user and opens the AI profile from it', () => {
    let opened = false;
    fixture.componentInstance.openAiProfile.subscribe(() => (opened = true));

    fixture.debugElement.query(By.css('.ch__status')).nativeElement.click();

    expect(labels()).toContain('Te conoce al 40 %. Personalizar');
    expect(opened).toBeTrue();
  });

  it('lists the AI profile and the quick questions in the menu', () => {
    fixture.debugElement.query(By.css('[aria-label="Más opciones"]')).nativeElement.click();
    fixture.detectChanges();

    const items = fixture.debugElement.queryAll(By.css('[role="menuitem"] strong')).map((el) => el.nativeElement.textContent);
    expect(items).toEqual(['Mi perfil IA', 'Preguntas rápidas', 'Chat con personas']);
  });
});
