import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicEditorialModel } from './AnthropicEditorialModel';

/** Official Anthropic-format endpoint (https://api-docs.deepseek.com/quick_start/pricing). */
export const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';

export interface DeepSeekEditorialModelOptions {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  client?: Pick<Anthropic, 'messages'>;
  modelPrefix?: string;
  timeoutMs?: number;
}

/**
 * Production-owned DeepSeek provider through its Anthropic-compatible Messages API.
 * Credentials come from the server environment (DEEPSEEK_API_KEY), never from the owner's PC.
 * DeepSeek implements the web_search server tool but not web_fetch, so research uses search only;
 * source pages are still fetched and verified by the pipeline's own deterministic fetchSource.
 */
export class DeepSeekEditorialModel extends AnthropicEditorialModel {
  constructor(options: DeepSeekEditorialModelOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey && !options.client) throw new Error('DEEPSEEK_API_KEY is not configured');
    super({
      provider: 'deepseek',
      apiKey,
      // The inherited gateway token would otherwise be sent as a second Authorization header and rejected.
      authToken: null,
      baseURL: options.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_ANTHROPIC_BASE_URL,
      maxRetries: options.maxRetries,
      client: options.client,
      modelPrefix: options.modelPrefix ?? '',
      webFetch: false,
      structuredOutput: 'prompt',
      maxWebSearches: 2,
      timeoutMs: options.timeoutMs ?? 300_000,
      maxOutputTokens: 64_000,
      // Thinking tokens count against max_tokens; a 1,400-word article must not be truncated by reasoning.
      thinking: (role) => role === 'editorial' || role === 'seo' ? 'disabled' : 'enabled',
    });
  }
}
