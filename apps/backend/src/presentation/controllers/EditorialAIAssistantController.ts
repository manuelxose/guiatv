import { Request, Response } from 'express';
import {
  EditorialAIAction,
  EditorialAIAssistantService,
} from '../../application/services/EditorialAIAssistantService';
import { logger } from '@/shared/utils/logger';

const VALID_ACTIONS: EditorialAIAction[] = ['generate', 'improve', 'expand', 'summarize', 'seo'];

export class EditorialAIAssistantController {
  constructor(private readonly service: EditorialAIAssistantService) {}

  getModels(_req: Request, res: Response): void {
    res.json({ models: this.service.listModels() });
  }

  async assist(req: Request, res: Response): Promise<void> {
    const { model, action, instruction, title, content } = req.body || {};

    if (typeof model !== 'string' || !model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    if (!VALID_ACTIONS.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    if (action !== 'generate' && (typeof content !== 'string' || !content.trim())) {
      res.status(400).json({ error: 'content is required for this action' });
      return;
    }

    try {
      const result = await this.service.assist({
        model,
        action,
        instruction: typeof instruction === 'string' ? instruction : undefined,
        title: typeof title === 'string' ? title : undefined,
        content: typeof content === 'string' ? content.slice(0, 50000) : undefined,
      });
      res.json(result);
    } catch (error) {
      logger.warn('Editorial AI assist failed', {
        model,
        action,
        error: error instanceof Error ? error.message : 'unknown',
      });
      res.status(502).json({ error: error instanceof Error ? error.message : 'AI provider error' });
    }
  }
}
