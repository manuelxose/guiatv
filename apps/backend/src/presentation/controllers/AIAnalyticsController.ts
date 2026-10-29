import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import { AIAnalyticsService } from '@/application/services/AIAnalyticsService';
import { successResponse } from '@/shared/types/ApiResponse';
import { NotFoundError, ValidationError } from '@/shared/errors';
import { AssistantOperationalTelemetryService } from '@/application/services/AssistantOperationalTelemetryService';

export class AIAnalyticsController {
  constructor(private readonly analyticsService: AIAnalyticsService, private readonly telemetry: AssistantOperationalTelemetryService) {}

  async getFailures(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(200).json(successResponse(await this.telemetry.listFailures(Number(req.query.limit) || 50)));
  }

  async getOverview(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await this.analyticsService.getOverview();
    res.status(200).json(successResponse(data));
  }

  async getTimeSeries(req: AuthenticatedRequest, res: Response): Promise<void> {
    const days = Number(req.query?.days) || 30;
    if (days < 1 || days > 365) {
      throw new ValidationError('days must be between 1 and 365', []);
    }
    const data = await this.analyticsService.getTimeSeries(days);
    res.status(200).json(successResponse(data));
  }

  async getConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
    const page = Number(req.query?.page) || 1;
    const limit = Number(req.query?.limit) || 20;
    if (page < 1 || limit < 1 || limit > 100) {
      throw new ValidationError('page must be >= 1 and limit between 1 and 100', []);
    }
    const userId = typeof req.query?.userId === 'string' ? req.query.userId : undefined;
    const search = typeof req.query?.search === 'string' && req.query.search.trim()
      ? req.query.search.trim()
      : undefined;
    const data = await this.analyticsService.listConversations(page, limit, userId, search);
    res.status(200).json(successResponse(data));
  }

  async getConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    const conversationId = String(req.params.id || '').trim();
    if (!conversationId) {
      throw new ValidationError('conversation id is required', []);
    }
    const data = await this.analyticsService.getConversation(conversationId);
    if (!data) {
      throw new NotFoundError('Assistant conversation not found');
    }
    res.status(200).json(successResponse(data));
  }
}
