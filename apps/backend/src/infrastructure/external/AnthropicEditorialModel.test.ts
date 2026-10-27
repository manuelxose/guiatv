import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicEditorialModel, parseJson } from './AnthropicEditorialModel';
import type { ModelCall } from '../../application/services/EditorialAgentPipeline';

const reply = (stop_reason: string, text: string, searches = 0) => ({
  stop_reason,
  stop_details: stop_reason === 'refusal' ? { category: 'cyber' } : null,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } },
});
function fake(replies: unknown[]) {
  const sent: any[] = [];
  const client = { messages: { stream: (body: any) => { sent.push(structuredClone(body)); return { finalMessage: async () => replies.shift() }; } } };
  return { client: client as unknown as Pick<Anthropic, 'messages'>, sent };
}
const call = (over: Partial<ModelCall> = {}): ModelCall => ({ role: 'critic', model: 'claude-opus-5-5', effort: 'high', system: 's', prompt: 'p', schema: { type: 'object' }, ...over });

test('anthropic model: structured output for review roles, usage summed', async () => {
  const f = fake([reply('end_turn', '{"verdict":"pass","issues":[]}')]);
  const r = await new AnthropicEditorialModel({ client: f.client }).call(call());
  assert.deepEqual(r, { json: { verdict: 'pass', issues: [] }, usage: { input_tokens: 110, output_tokens: 50 }, searches: 0 });
  assert.deepEqual(f.sent[0].output_config, { effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } });
  assert.equal(f.sent[0].tools, undefined);
});

test('anthropic model: research uses web tools, resumes paused turns and reads the last JSON block', async () => {
  const f = fake([reply('pause_turn', 'buscando…', 2), reply('end_turn', 'nota\n```json\n{"a":1}\n```\n```json\n{"claims":[]}\n```', 1)]);
  const r = await new AnthropicEditorialModel({ client: f.client }).call(call({ role: 'research', webSearches: 3 }));
  assert.deepEqual(r.json, { claims: [] });
  assert.equal(r.searches, 3);
  assert.equal(r.usage.output_tokens, 100);
  assert.deepEqual(f.sent[0].tools.map((t: any) => `${t.type}:${t.max_uses}`), ['web_search_20260209:3', 'web_fetch_20260209:6']);
  assert.equal(f.sent[1].messages.at(-1).role, 'assistant');
});

test('anthropic model: refusals and truncation stop the job', async () => {
  await assert.rejects(new AnthropicEditorialModel({ client: fake([reply('refusal', '')]).client }).call(call()), /declined \(cyber\)/);
  await assert.rejects(new AnthropicEditorialModel({ client: fake([reply('max_tokens', '{"a"')]).client }).call(call()), /truncated/);
  assert.throws(() => parseJson('sin json', true), /no JSON/);
});
