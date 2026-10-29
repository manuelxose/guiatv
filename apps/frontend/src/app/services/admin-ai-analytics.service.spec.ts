import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, throwError } from 'rxjs';
import { AdminAIAnalyticsService } from './admin-ai-analytics.service';

describe('AdminAIAnalyticsService conversations', () => {
  it('propagates API failures instead of reporting an empty list or detail', async () => {
    const error = new Error('API unavailable');
    TestBed.configureTestingModule({ providers: [AdminAIAnalyticsService, { provide: HttpClient, useValue: { get: () => throwError(() => error) } }] });
    const service = TestBed.inject(AdminAIAnalyticsService);
    await expectAsync(firstValueFrom(service.getConversations())).toBeRejectedWith(error);
    await expectAsync(firstValueFrom(service.getConversation('id'))).toBeRejectedWith(error);
  });
});
