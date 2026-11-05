import Anthropic from '@anthropic-ai/sdk';
import { ModelCallFailed, type EditorialModel, type ModelCall, type ModelResult } from '../../application/services/EditorialAgentPipeline';

const MAX_OUTPUT_TOKENS = 32000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface AnthropicEditorialModelOptions {
  apiKey?: string;
  /** Explicit null prevents the SDK from reading ANTHROPIC_AUTH_TOKEN (a gateway token must not win over an API key). */
  authToken?: string | null;
  maxRetries?: number;
  client?: Pick<Anthropic, 'messages'>;
  modelPrefix?: string;
  /** Provenance backend. Defaults to `anthropic`; a compatible provider (DeepSeek) supplies its own id. */
  provider?: string;
  /** Anthropic-compatible API root, e.g. https://api.deepseek.com/anthropic. */
  baseURL?: string;
  /** Anthropic server tools include web_fetch; DeepSeek's compatible endpoint only implements web_search. */
  webFetch?: boolean;
  /** DeepSeek accepts only `effort` in output_config, so the schema is requested in the prompt instead. */
  structuredOutput?: 'json_schema' | 'prompt';
  /** Hard per-request timeout. A provider that streams forever must fail the job, not own the worker. */
  timeoutMs?: number;
  /** Provider-specific cap on server-side searches (DeepSeek returns much larger result blocks). */
  maxWebSearches?: number;
}

/**
 * EditorialModel over the Claude Messages API. Research gets web search and fetch (server tools, so
 * its JSON comes back as text); every other role uses structured outputs against the role's schema.
 * A refusal or an unparseable answer throws: the job stops rather than switching model mid-fact-check.
 * The same adapter serves Anthropic-compatible providers (DeepSeek) through `provider` and `baseURL`.
 */
export class AnthropicEditorialModel implements EditorialModel {
  readonly provider: string;
  readonly webSearch = true;
  readonly maxOutputTokens = MAX_OUTPUT_TOKENS;
  readonly maxWebSearches: number | undefined;
  private readonly client: Pick<Anthropic, 'messages'>;
  /** Gateway model namespace (e.g. `cc/` for the owner's subscription gateway); routes, prices and provenance keep the canonical id. */
  private readonly modelPrefix: string;
  private readonly webFetch: boolean;
  private readonly structuredOutput: 'json_schema' | 'prompt';

  constructor(options: AnthropicEditorialModelOptions = {}) {
    this.provider = options.provider ?? 'anthropic';
    const timeoutMs = options.timeoutMs ?? (Number(process.env.EDITORIAL_MODEL_TIMEOUT_MS) || 300_000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) throw new Error('invalid model request timeout');
    // Zero-arg resolution (ANTHROPIC_API_KEY, auth token, `ant auth login` profile) unless a key is injected.
    this.client = options.client ?? new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      timeout: timeoutMs,
      maxRetries: options.maxRetries ?? 1,
    });
    this.modelPrefix = options.modelPrefix ?? process.env.ANTHROPIC_MODEL_PREFIX ?? '';
    this.webFetch = options.webFetch ?? true;
    this.structuredOutput = options.structuredOutput ?? 'json_schema';
    this.maxWebSearches = options.maxWebSearches;
  }

  async call(request: ModelCall): Promise<ModelResult> {
    if (request.provider !== this.provider) throw new Error(`${request.role}: routed to ${request.provider}, not ${this.provider}`);
    const webSearches = Math.min(request.webSearches ?? 0, this.maxWebSearches ?? Number.POSITIVE_INFINITY);
    const research = webSearches > 0;
    const promptSchema = research || this.structuredOutput === 'prompt';
    const messages: Anthropic.MessageParam[] = [{
      role: 'user',
      content: promptSchema
        ? `${request.prompt}\n\nTermina con un único bloque \`\`\`json que cumpla este esquema:\n${JSON.stringify(request.schema)}`
        : request.prompt,
    }];
    const usage = { input_tokens: 0, output_tokens: 0 };
    let searches = 0;
    // Every failure after a billed turn carries what was billed, so the ledger can charge it.
    const fail = (message: string) => new ModelCallFailed(`${request.role}: ${message}`, usage, searches);

    // Server tools can pause a long turn; resume it a bounded number of times.
    for (let turn = 0; turn < 4; turn++) {
      const stream = this.client.messages.stream({
        model: `${this.modelPrefix}${request.model}`,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.system,
        messages,
        output_config: promptSchema ? { effort: request.effort } : { effort: request.effort, format: { type: 'json_schema', schema: request.schema } },
        ...(research
          ? { tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: webSearches },
            ...(this.webFetch ? [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: webSearches * 2 }] : []),
          ] as Anthropic.ToolUnion[] }
          : {}),
      });
      // A provider that streams an unbounded tool result must not consume the worker's memory.
      let streamBytes = 0;
      let tooLarge = false;
      if (typeof (stream as { on?: unknown }).on === 'function') {
        (stream as unknown as { on: (event: string, cb: (event: unknown) => void) => void }).on('streamEvent', (event) => {
          streamBytes += Buffer.byteLength(JSON.stringify(event));
          if (streamBytes > MAX_RESPONSE_BYTES) { tooLarge = true; (stream as unknown as { abort: () => void }).abort(); }
        });
      }
      const message = await stream.finalMessage().catch((error: unknown) => {
        if (tooLarge) throw fail(`response exceeded ${MAX_RESPONSE_BYTES} bytes`);
        // An HTTP error response is not billed; a stream cut mid-answer may be, so it stays unresolved.
        if (error instanceof Anthropic.APIError && typeof error.status === 'number') throw fail(error.message);
        throw error;
      });

      usage.input_tokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
      usage.output_tokens += message.usage.output_tokens;
      // DeepSeek reports successful searches as tool_search; Anthropic reports every request as web_search_requests.
      const toolUse = message.usage.server_tool_use as { web_search_requests?: number; tool_search?: number } | undefined;
      searches += toolUse?.tool_search ?? toolUse?.web_search_requests ?? 0;
      // A gateway must not answer with another model than the routed one: provenance and prices name it.
      if (message.model && !message.model.startsWith(request.model)) throw fail(`answered by ${message.model}, routed to ${request.model}`);

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'refusal') throw fail(`the model declined (${message.stop_details?.category ?? 'sin categoría'})`);
      if (message.stop_reason === 'max_tokens') throw fail('answer truncated at max_tokens');
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      try {
        return { json: parseJson(text, promptSchema), usage, searches };
      } catch (error) {
        throw fail(error instanceof Error ? error.message : String(error));
      }
    }
    throw fail('too many paused turns');
  }
}

export function parseJson(text: string, fenced: boolean): unknown {
  // Prompt-mode providers usually wrap the object in a fence but sometimes answer with bare JSON.
  const body = fenced
    ? [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop()?.[1] ?? (/^\s*[{[]/.test(text) ? text : undefined)
    : text;
  if (!body) throw new Error('no JSON block in the answer');
  return JSON.parse(body);
}
