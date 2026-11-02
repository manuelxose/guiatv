import { test } from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { OpenAIEditorialModel } from './OpenAIEditorialModel';
import { ModelCallFailed, type ModelCall } from '../../application/services/EditorialAgentPipeline';

const reply = (over: Record<string, unknown> = {}) => ({
  model: 'gpt-6.1-terra', status: 'completed', output_text: '{"verdict":"pass","issues":[]}', output: [],
  usage: { input_tokens: 100, output_tokens: 50 }, ...over,
});
function fake(responses: unknown[]) {
  const sent: any[] = [];
  const client = { responses: { create: async (body: any) => { sent.push(structuredClone(body)); return responses.shift(); } } };
  return { client: client as unknown as Pick<OpenAI, 'responses'>, sent };
}
const call = (over: Partial<ModelCall> = {}): ModelCall => ({ role: 'critic', provider: 'openai', model: 'gpt-6.1-terra', effort: 'high', system: 's', prompt: 'p', schema: { type: 'object' }, ...over });

test('openai model: strict structured output and usage', async () => {
  const f = fake([reply()]);
  const result = await new OpenAIEditorialModel({ client: f.client }).call(call());
  assert.deepEqual(result.json, { verdict: 'pass', issues: [] });
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 50 });
  assert.deepEqual(f.sent[0].text.format, { type: 'json_schema', name: 'editorial_critic', strict: true, schema: { type: 'object' } });
});

test('openai model: web search and domain filters', async () => {
  const f = fake([reply({ output_text: '```json\n{"claims":[]}\n```', output: [{ type: 'web_search_call' }] })]);
  const result = await new OpenAIEditorialModel({ client: f.client }).call(call({ role: 'research', webSearches: 3, webSearchDomains: ['boe.es'] }));
  assert.deepEqual(result.json, { claims: [] });
  assert.equal(result.searches, 1);
  assert.deepEqual(f.sent[0].tools, [{ type: 'web_search', filters: { allowed_domains: ['boe.es'] } }]);
});

test('openai model: refusal, truncation, wrong model and bad JSON carry billed usage', async () => {
  for (const response of [
    reply({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }),
    reply({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    reply({ model: 'other-model' }),
    reply({ output_text: 'not-json' }),
  ]) {
    const error = await new OpenAIEditorialModel({ client: fake([response]).client }).call(call()).catch((e) => e);
    assert.ok(error instanceof ModelCallFailed);
    assert.deepEqual(error.usage, { input_tokens: 100, output_tokens: 50 });
  }
  await assert.rejects(new OpenAIEditorialModel({ client: fake([]).client }).call(call({ provider: 'anthropic' })), /routed to anthropic/);
});
