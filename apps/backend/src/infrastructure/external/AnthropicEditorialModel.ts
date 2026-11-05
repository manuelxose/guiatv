import Anthropic from '@anthropic-ai/sdk';
import { ModelCallFailed, type EditorialModel, type ModelCall, type ModelResult } from '../../application/services/EditorialAgentPipeline';

const MAX_OUTPUT_TOKENS = 32000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** The writer's actual article text is far below this; the cap only stops a runaway text stream. */
const MAX_TEXT_BYTES = 1 * 1024 * 1024;

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
  /** Per-role thinking mode; DeepSeek's thinking tokens count against max_tokens. */
  thinking?: (role: ModelCall['role']) => 'enabled' | 'disabled' | undefined;
  /** Provider-specific output cap (DeepSeek supports more than Anthropic). */
  maxOutputTokens?: number;
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
  readonly maxOutputTokens: number;
  readonly maxWebSearches: number | undefined;
  private readonly timeoutMs: number;
  private readonly thinking: ((role: ModelCall['role']) => 'enabled' | 'disabled' | undefined) | undefined;
  private readonly client: Pick<Anthropic, 'messages'>;
  /** Gateway model namespace (e.g. `cc/` for the owner's subscription gateway); routes, prices and provenance keep the canonical id. */
  private readonly modelPrefix: string;
  private readonly webFetch: boolean;
  readonly structuredOutput: 'json_schema' | 'prompt';

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
    this.thinking = options.thinking;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = options.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  }

  async call(request: ModelCall): Promise<ModelResult> {
    request.signal?.throwIfAborted();
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
    const fail = (message: string, unresolved = false) => new ModelCallFailed(`${request.role}: ${message}`, usage, searches, undefined, unresolved);
    // One absolute deadline per call, not per paused turn: four resumed turns must not each get the full budget.
    const callDeadline = Date.now() + this.timeoutMs;

    // Server tools can pause a long turn; resume it a bounded number of times.
    for (let turn = 0; turn < 4; turn++) {
      const remaining = callDeadline - Date.now();
      if (remaining <= 0) throw fail(`model request exceeded ${this.timeoutMs} ms`, true);
      const thinkingMode = this.thinking?.(request.role);
      const stream = this.client.messages.stream({
        model: `${this.modelPrefix}${request.model}`,
        max_tokens: this.maxOutputTokens,
        system: request.system,
        messages,
        ...(thinkingMode === 'enabled' ? { thinking: { type: 'enabled' as const, budget_tokens: 16_000 } }
          : thinkingMode === 'disabled' ? { thinking: { type: 'disabled' as const } } : {}),
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
      let textBytes = 0;
      let tooLarge = false;
      let timedOut = false;
      let cancelled = false;
      const abortStream = () => {
        try { (stream as unknown as { abort: () => void }).abort(); } catch { /* already finished */ }
      };
      if (typeof (stream as { on?: unknown }).on === 'function') {
        (stream as unknown as { on: (event: string, cb: (event: unknown) => void) => void }).on('streamEvent', (event) => {
          streamBytes += Buffer.byteLength(JSON.stringify(event));
          const delta = (event as { delta?: { text?: unknown } }).delta;
          if (typeof delta?.text === 'string') textBytes += Buffer.byteLength(delta.text);
          if (streamBytes > MAX_RESPONSE_BYTES || textBytes > MAX_TEXT_BYTES) { tooLarge = true; abortStream(); }
        });
      }
      const abort = () => { cancelled = true; abortStream(); };
      if (request.signal?.aborted) abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      // The SDK timeout only covers response headers; a streamed body needs its own wall-clock deadline.
      const deadline = setTimeout(() => { timedOut = true; abortStream(); }, Math.max(1, remaining));
      deadline.unref?.();
      const message = await stream.finalMessage().catch((error: unknown) => {
        // Streamed tokens are billed even when the client aborts: charge what is known and keep the rest unresolved.
        if (cancelled) throw fail('cancelled', true);
        if (tooLarge) throw fail('response exceeded the byte cap', true);
        if (timedOut) throw fail(`model request exceeded ${this.timeoutMs} ms`, true);
        // An HTTP error response is not billed; a stream cut mid-answer may be, so it stays unresolved.
        if (error instanceof Anthropic.APIError && typeof error.status === 'number') throw fail(error.message);
        throw error;
      }).finally(() => {
        clearTimeout(deadline);
        request.signal?.removeEventListener('abort', abort);
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
  const candidates = fenced
    ? [
      ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]).reverse(),
      ...(/^\s*[{[]/.test(text) ? [text] : []),
    ]
    : [text];
  for (const candidate of candidates) {
    const value = parseCandidate(candidate);
    if (value !== undefined) return value;
  }
  throw new Error('no JSON block in the answer');
}

/** Some providers append prose or a second object after the JSON: parse the first balanced value, never a prefix. */
function parseCandidate(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* try the first balanced JSON value */ }
  const start = trimmed.search(/[{[]/);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return undefined; }
      }
    }
  }
  return undefined;
}
