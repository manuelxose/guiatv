import axios, { AxiosInstance } from 'axios';

export interface EditorialAIModel {
  id: string;
  provider: 'deepseek' | 'anthropic';
  label: string;
}

export type EditorialAIAction = 'generate' | 'improve' | 'expand' | 'summarize' | 'seo';

export interface EditorialAIAssistRequest {
  model: string;
  action: EditorialAIAction;
  instruction?: string;
  title?: string;
  content?: string;
  language?: string;
}

export interface EditorialAIAssistResult {
  text: string;
  model: string;
  provider: EditorialAIModel['provider'];
}

const DEEPSEEK_MODELS: EditorialAIModel[] = [
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat (V3)' },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek Reasoner (R1)' },
];

const ANTHROPIC_MODELS: EditorialAIModel[] = [
  { id: 'claude-opus-4-1', provider: 'anthropic', label: 'Claude Opus 4.1' },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },
];

const SYSTEM_PROMPT = [
  'Eres el editor jefe de una guía española de televisión y streaming.',
  'Respondes SOLO con el contenido pedido, en HTML editorial limpio (p, h2, h3, ul, ol, li, strong, em, a, blockquote).',
  'Sin markdown, sin cercas de código, sin comentarios sobre tu trabajo.',
].join(' ');

const ACTION_PROMPTS: Record<EditorialAIAction, string> = {
  generate: 'Redacta el contenido HTML del artículo siguiendo la instrucción.',
  improve: 'Mejora el texto HTML dado: claridad, ritmo y corrección, sin cambiar el significado.',
  expand: 'Amplía el texto HTML dado con más detalle útil y ejemplos, manteniendo el tono.',
  summarize: 'Resume el texto HTML dado en un extracto breve (2-3 frases) dentro de un único <p>.',
  seo: 'Optimiza el texto HTML dado para SEO (títulos, keywords naturales, estructura) sin perder legibilidad.',
};

/**
 * Asistente editorial del Blog Studio. Usa las mismas API keys que el asistente
 * de la app (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY) y solo expone los modelos
 * de los proveedores configurados.
 */
export class EditorialAIAssistantService {
  private readonly deepseekClient?: AxiosInstance;
  private readonly anthropicClient?: AxiosInstance;

  constructor(options: { deepseekApiKey?: string; anthropicApiKey?: string } = {}) {
    if (options.deepseekApiKey) {
      this.deepseekClient = axios.create({
        baseURL: 'https://api.deepseek.com',
        timeout: 60000,
        headers: {
          Authorization: `Bearer ${options.deepseekApiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
    if (options.anthropicApiKey) {
      this.anthropicClient = axios.create({
        baseURL: 'https://api.anthropic.com/v1',
        timeout: 60000,
        headers: {
          'x-api-key': options.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      });
    }
  }

  listModels(): EditorialAIModel[] {
    const models: EditorialAIModel[] = [];
    if (this.deepseekClient) models.push(...DEEPSEEK_MODELS);
    if (this.anthropicClient) {
      const extra = process.env.AI_CHATBOT_ANTHROPIC_MODEL;
      const anthropic = [...ANTHROPIC_MODELS];
      if (extra && !anthropic.some((m) => m.id === extra)) {
        anthropic.unshift({ id: extra, provider: 'anthropic', label: extra });
      }
      models.push(...anthropic);
    }
    return models;
  }

  async assist(request: EditorialAIAssistRequest): Promise<EditorialAIAssistResult> {
    const model = this.listModels().find((m) => m.id === request.model);
    if (!model) throw new Error(`Model not available: ${request.model}`);

    const actionPrompt = ACTION_PROMPTS[request.action];
    const parts = [actionPrompt];
    if (request.title) parts.push(`Título del artículo: ${request.title}`);
    if (request.instruction) parts.push(`Instrucción: ${request.instruction}`);
    if (request.content && request.action !== 'generate') {
      parts.push(`Texto actual:\n${request.content}`);
    }

    const text =
      model.provider === 'deepseek'
        ? await this.callDeepSeek(model.id, parts.join('\n\n'))
        : await this.callAnthropic(model.id, parts.join('\n\n'));

    return { text: this.stripFences(text), model: model.id, provider: model.provider };
  }

  private async callDeepSeek(model: string, userPrompt: string): Promise<string> {
    if (!this.deepseekClient) throw new Error('DeepSeek is not configured');
    const response = await this.deepseekClient.post('/chat/completions', {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });
    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('DeepSeek returned an empty answer');
    return String(text);
  }

  private async callAnthropic(model: string, userPrompt: string): Promise<string> {
    if (!this.anthropicClient) throw new Error('Anthropic is not configured');
    const response = await this.anthropicClient.post('/messages', {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const blocks = Array.isArray(response.data?.content) ? response.data.content : [];
    const text = blocks
      .filter((b: { type?: string }) => b?.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .join('\n');
    if (!text) throw new Error('Anthropic returned an empty answer');
    return text;
  }

  private stripFences(text: string): string {
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/);
    return (fenced ? fenced[1] : text).trim();
  }
}
