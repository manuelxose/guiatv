import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatbotRecommendation } from '../../../interfaces/chatbot.interface';
import { ChatRecommendationListComponent } from './chat-recommendation-list.component';

describe('ChatRecommendationListComponent', () => {
  let fixture: ComponentFixture<ChatRecommendationListComponent>;

  const recommendation = (index: number): ChatbotRecommendation => ({
    title: `Título ${index}`,
    type: 'series',
    platform: index % 2 ? 'Netflix' : 'Max',
    reason: 'Encaja con tus preferencias',
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChatRecommendationListComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChatRecommendationListComponent);
    fixture.componentInstance.recommendations = [1, 2, 3].map(recommendation);
    fixture.componentInstance.moreRecommendations = [4, 5, 6, 7, 8].map(recommendation);
    fixture.detectChanges();
  });

  it('shows five platform results in a readable list before progressive expansion', () => {
    expect(fixture.debugElement.queryAll(By.css('app-chat-recommendation-card')).length).toBe(5);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ver 3 opciones más');
    expect(fixture.debugElement.query(By.css('[aria-label="Vista carrusel"]'))).toBeNull();
  });

  it('reveals every loaded result from the explicit expansion control', () => {
    const expand = fixture.debugElement.query(By.css('section > div:last-child button'));
    expand.triggerEventHandler('click');
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('app-chat-recommendation-card')).length).toBe(8);
  });
});
