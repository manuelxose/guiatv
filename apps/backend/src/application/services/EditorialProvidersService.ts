/**
 * Read-only provider health for the Admin. It performs a free model-list request per configured provider;
 * it never sends an editorial prompt, never bills a generation, and never returns a credential value.
 */
export type EditorialProviderId = 'deepseek' | 'anthropic' | 'openai';
export type EditorialProviderState = 'connected' | 'unauthorized' | 'unreachable' | 'error' | 'not-configured';

export interface EditorialProviderStatus {
  id: EditorialProviderId;
  label: string;
  configured: boolean;
  credentialEnv: string;
  baseUrlHost: string | null;
  state: EditorialProviderState;
  models: string[];
  latencyMs: number | null;
  checkedAt: string;
  error: string | null;
}

interface ProviderConfig {
  id: EditorialProviderId;
  label: string;
  key: string | undefined;
  baseUrl: string;
  healthUrl: string;
  auth: 'bearer' | 'x-api-key';
  credentialEnv: string;
}

const labels: Record<EditorialProviderId, string> = { deepseek: 'DeepSeek', anthropic: 'Anthropic', openai: 'OpenAI' };
const trimBase = (value: string) => value.replace(/\/+$/, '');
const hostOf = (value: string): string | null => {
  try { return new URL(value).host; } catch { return null; }
};

export function providerConfigs(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  const deepseekBase = trimBase(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/anthropic');
  const anthropicBase = trimBase(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  const openaiBase = trimBase(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const deepseekHealth = (() => { try { return new URL('/models', `${deepseekBase}/`).toString(); } catch { return 'https://api.deepseek.com/models'; } })();
  return [
    { id: 'deepseek', label: labels.deepseek, key: env.DEEPSEEK_API_KEY, credentialEnv: 'DEEPSEEK_API_KEY', baseUrl: deepseekBase, healthUrl: deepseekHealth, auth: 'bearer' },
    { id: 'anthropic', label: labels.anthropic, key: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN, credentialEnv: env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN', baseUrl: anthropicBase, healthUrl: `${anthropicBase}/v1/models`, auth: env.ANTHROPIC_API_KEY ? 'x-api-key' : 'bearer' },
    { id: 'openai', label: labels.openai, key: env.OPENAI_API_KEY, credentialEnv: 'OPENAI_API_KEY', baseUrl: openaiBase, healthUrl: `${openaiBase}/models`, auth: 'bearer' },
  ];
}

const safeError = (value: unknown): string => (value instanceof Error ? value.message : String(value)).slice(0, 240);

async function check(config: ProviderConfig, fetchImpl: typeof fetch): Promise<EditorialProviderStatus> {
  const checkedAt = new Date().toISOString();
  const base = {
    id: config.id, label: config.label, configured: Boolean(config.key), credentialEnv: config.credentialEnv,
    baseUrlHost: hostOf(config.baseUrl),
  };
  if (!config.key) return { ...base, state: 'not-configured', models: [], latencyMs: null, checkedAt, error: null };
  const started = Date.now();
  try {
    const response = await fetchImpl(config.healthUrl, {
      headers: config.auth === 'x-api-key' ? { 'x-api-key': config.key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(6000),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401 || response.status === 403) return { ...base, state: 'unauthorized', models: [], latencyMs, checkedAt, error: `HTTP ${response.status}` };
    if (!response.ok) return { ...base, state: 'error', models: [], latencyMs, checkedAt, error: `HTTP ${response.status}` };
    const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
    const models = Array.isArray(body?.data) ? body!.data!.map((m) => typeof m?.id === 'string' ? m.id : '').filter(Boolean).slice(0, 50) : [];
    return { ...base, state: 'connected', models, latencyMs, checkedAt, error: null };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = safeError(error);
    const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed out|timeout|aborted/i.test(message);
    return { ...base, state: unreachable ? 'unreachable' : 'error', models: [], latencyMs, checkedAt, error: message };
  }
}

export class EditorialProvidersService {
  private cached: { at: number; value: { checkedAt: string; providers: EditorialProviderStatus[] } } | null = null;
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly ttlMs = 60_000) {}

  async check(force = false): Promise<{ checkedAt: string; providers: EditorialProviderStatus[] }> {
    if (!force && this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    const providers = await Promise.all(providerConfigs().map((config) => check(config, this.fetchImpl)));
    const value = { checkedAt: new Date().toISOString(), providers };
    this.cached = { at: Date.now(), value };
    return value;
  }
}
