import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorialProvidersService, providerConfigs } from './EditorialProvidersService';

test('provider configs never expose credential values and map DeepSeek to its models endpoint', () => {
  const configs = providerConfigs({ DEEPSEEK_API_KEY: 'secret-value', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic' } as NodeJS.ProcessEnv);
  const deepseek = configs.find((c) => c.id === 'deepseek')!;
  assert.equal(deepseek.key, 'secret-value');
  assert.equal(deepseek.healthUrl, 'https://api.deepseek.com/models');
  assert.equal(deepseek.credentialEnv, 'DEEPSEEK_API_KEY');
  assert.ok(!JSON.stringify(configs.map(({ id, label, credentialEnv, healthUrl, auth }) => ({ id, label, credentialEnv, healthUrl, auth }))).includes('secret-value'));
});

test('provider health classifies connected, unauthorized, unreachable and missing credentials', async () => {
  const seen: string[] = [];
  const fakeFetch = (async (url: string) => {
    seen.push(String(url));
    if (String(url).includes('deepseek')) return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }), { status: 200 });
    if (String(url).includes('anthropic')) return new Response('{}', { status: 401 });
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const previous = { ...process.env };
  Object.assign(process.env, { DEEPSEEK_API_KEY: 'SECRET_VALUE', ANTHROPIC_API_KEY: 'SECRET_VALUE', OPENAI_API_KEY: 'SECRET_VALUE' });
  try {
    const result = await new EditorialProvidersService(fakeFetch, 0).check(true);
    const byId = Object.fromEntries(result.providers.map((p) => [p.id, p]));
    assert.equal(byId.deepseek.state, 'connected');
    assert.deepEqual(byId.deepseek.models, ['deepseek-flash']);
    assert.equal(byId.anthropic.state, 'unauthorized');
    assert.equal(byId.openai.state, 'unreachable');
    assert.ok(seen.every((url) => !url.includes('SECRET_VALUE')));
  } finally {
    for (const key of ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
