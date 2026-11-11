import OpenAI from 'openai';
import { ModelCallFailed, type EditorialModel, type ModelCall, type ModelResult } from '../../application/services/EditorialAgentPipeline';
import { parseJson as parsePromptJson } from './AnthropicEditorialModel';

const MAX_OUTPUT_TOKENS = 32000;

export class OpenAIEditorialModel implements EditorialModel {
  readonly provider = 'openai';
  readonly webSearch = true;
  readonly maxOutputTokens = MAX_OUTPUT_TOKENS;
  private readonly client: Pick<OpenAI, 'responses'>;

  constructor(options: { apiKey?: string; maxRetries?: number; client?: Pick<OpenAI, 'responses'> } = {}) {
    this.client = options.client ?? new OpenAI({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: options.maxRetries ?? 1 });
  }

  async call(request: ModelCall): Promise<ModelResult> {
    if (request.provider !== this.provider) throw new Error(`${request.role}: routed to ${request.provider}, not ${this.provider}`);
    const research = Boolean(request.webSearches);
    // M15: with web search the answer is prose plus JSON, so the schema must travel in the prompt (as for Anthropic and
    // DeepSeek); without it the research role answered in prose and every OpenAI research call failed.
    const input = research ? `${request.prompt}\n\nTermina con un único bloque \`\`\`json que cumpla este esquema:\n${JSON.stringify(request.schema)}` : request.prompt;
    const strict = { format: { type: 'json_schema' as const, name: `editorial_${request.role}`, strict: true, schema: request.schema } };
    const response = await this.client.responses.create({
      model: request.model,
      instructions: request.system,
      input,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      ...(research ? {
        tools: [{ type: 'web_search', ...(request.webSearchDomains?.length ? { filters: { allowed_domains: request.webSearchDomains } } : {}) }],
        tool_choice: 'auto',
        include: ['web_search_call.action.sources'],
      } : { text: strict }),
    });
    const usage = { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 };
    const searches = response.output.filter((item) => item.type === 'web_search_call').length;
    const fail = (message: string) => new ModelCallFailed(`${request.role}: ${message}`, usage, searches);
    if (response.model && !response.model.startsWith(request.model)) throw fail(`answered by ${response.model}, routed to ${request.model}`);
    if (response.status === 'incomplete') throw fail(`answer incomplete (${response.incomplete_details?.reason ?? 'unknown'})`);
    if (response.status === 'failed' || response.status === 'cancelled') throw fail(`response ${response.status}`);
    if (response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'))) throw fail('the model declined');
    const text = response.output_text;
    try {
      return { json: research ? parsePromptJson(text, true) : JSON.parse(text), usage, searches };
    } catch {
      if (!research) throw fail('no valid JSON in the answer');
    }
    // One billed repair turn: the same conversation, no tools, strict structured output, so the block cannot be prose.
    const repair = await this.client.responses.create({
      model: request.model,
      instructions: request.system,
      input: [
        { role: 'user', content: input },
        { role: 'assistant', content: text || '(sin texto)' },
        { role: 'user', content: 'Tu respuesta no terminó con el bloque JSON pedido. Devuelve ahora solo ese objeto, con el esquema indicado, usando únicamente lo que ya has consultado.' },
      ],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      text: strict,
    });
    usage.input_tokens += repair.usage?.input_tokens ?? 0;
    usage.output_tokens += repair.usage?.output_tokens ?? 0;
    if (repair.model && !repair.model.startsWith(request.model)) throw fail(`answered by ${repair.model}, routed to ${request.model}`);
    if (repair.status !== 'completed') throw fail(`repair turn ${repair.status ?? 'without status'}`);
    try {
      return { json: JSON.parse(repair.output_text), usage, searches };
    } catch {
      throw fail('no valid JSON in the answer');
    }
  }
}
