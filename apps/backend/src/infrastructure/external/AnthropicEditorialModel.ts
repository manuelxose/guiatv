import Anthropic from '@anthropic-ai/sdk';
import type { EditorialModel, ModelCall, ModelResult } from '../../application/services/EditorialAgentPipeline';

/**
 * EditorialModel over the Claude Messages API. Research gets web search and fetch (server tools, so
 * its JSON comes back as text); every other role uses structured outputs against the role's schema.
 * A refusal or an unparseable answer throws: the job stops rather than switching model mid-fact-check.
 */
export class AnthropicEditorialModel implements EditorialModel {
  private readonly client: Pick<Anthropic, 'messages'>;

  constructor(options: { apiKey?: string; maxRetries?: number; client?: Pick<Anthropic, 'messages'> } = {}) {
    // Zero-arg resolution (ANTHROPIC_API_KEY, auth token, `ant auth login` profile) unless a key is injected.
    this.client = options.client ?? new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: options.maxRetries ?? 1 });
  }

  async call(request: ModelCall): Promise<ModelResult> {
    const research = Boolean(request.webSearches);
    const messages: Anthropic.MessageParam[] = [{
      role: 'user',
      content: research
        ? `${request.prompt}\n\nTermina con un único bloque \`\`\`json que cumpla este esquema:\n${JSON.stringify(request.schema)}`
        : request.prompt,
    }];
    const usage = { input_tokens: 0, output_tokens: 0 };
    let searches = 0;

    // Server tools can pause a long turn; resume it a bounded number of times.
    for (let turn = 0; turn < 4; turn++) {
      const message = await this.client.messages.stream({
        model: request.model,
        max_tokens: 32000,
        system: request.system,
        messages,
        output_config: research ? { effort: request.effort } : { effort: request.effort, format: { type: 'json_schema', schema: request.schema } },
        ...(research
          ? { tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: request.webSearches },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: request.webSearches! * 2 },
          ] as Anthropic.ToolUnion[] }
          : {}),
      }).finalMessage();

      usage.input_tokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
      usage.output_tokens += message.usage.output_tokens;
      searches += message.usage.server_tool_use?.web_search_requests ?? 0;

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'refusal') throw new Error(`${request.role}: the model declined (${message.stop_details?.category ?? 'sin categoría'})`);
      if (message.stop_reason === 'max_tokens') throw new Error(`${request.role}: answer truncated at max_tokens`);
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      return { json: parseJson(text, research), usage, searches };
    }
    throw new Error(`${request.role}: too many paused turns`);
  }
}

export function parseJson(text: string, fenced: boolean): unknown {
  const body = fenced ? [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop()?.[1] : text;
  if (!body) throw new Error('no JSON block in the answer');
  return JSON.parse(body);
}
