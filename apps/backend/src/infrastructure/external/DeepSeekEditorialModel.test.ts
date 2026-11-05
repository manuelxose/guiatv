import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { DeepSeekEditorialModel } from './DeepSeekEditorialModel';
import type { ModelCall } from '../../application/services/EditorialAgentPipeline';

const reply = {
  stop_reason: 'end_turn',
  stop_details: null,
  model: 'deepseek-flash',
  content: [{ type: 'text', text: 'nota\n```json\n{"claims":[]}\n```' }],
  usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
};
function fake(answer: unknown = reply) {
  const sent: any[] = [];
  const client = { messages: { stream: (body: any) => { sent.push(structuredClone(body)); return { finalMessage: async () => answer }; } } };
  return { client: client as unknown as Pick<Anthropic, 'messages'>, sent };
}
const call = (over: Partial<ModelCall> = {}): ModelCall => ({
  role: 'research', provider: 'deepseek', model: 'deepseek-flash', effort: 'high', system: 's', prompt: 'p',
  schema: { type: 'object' }, webSearches: 3, ...over,
});

test('deepseek model: server-owned provider, search without the unsupported web_fetch tool', async () => {
  const f = fake();
  const model = new DeepSeekEditorialModel({ apiKey: 'test-key', client: f.client });
  assert.equal(model.provider, 'deepseek');
  assert.equal(model.webSearch, true);
  const result = await model.call(call());
  assert.deepEqual(result.json, { claims: [] });
  assert.equal(f.sent[0].model, 'deepseek-flash');
  assert.deepEqual(f.sent[0].tools.map((t: any) => `${t.type}:${t.max_uses}`), ['web_search_20260209:2']);
  assert.equal(f.sent[0].max_tokens, 32000);
  // DeepSeek ignores output_config.format; the schema must travel in the prompt and be parsed from a fence.
  assert.deepEqual(f.sent[0].output_config, { effort: 'high' });
  assert.match(f.sent[0].messages[0].content, /```json/);
});

test('deepseek model: non-research roles get the schema in the prompt, not in output_config.format', async () => {
  const f = fake({ ...reply, content: [{ type: 'text', text: '{"verdict":"pass","issues":[]}' }], usage: { input_tokens: 10, output_tokens: 5 } });
  const model = new DeepSeekEditorialModel({ apiKey: 'test-key', client: f.client });
  const result = await model.call(call({ role: 'critic', webSearches: undefined }));
  assert.deepEqual(result.json, { verdict: 'pass', issues: [] });
  assert.deepEqual(f.sent[0].output_config, { effort: 'high' });
  assert.match(f.sent[0].messages[0].content, /```json/);
});

test('deepseek model: an unbounded stream is aborted instead of consuming the worker', async () => {
  const client = { messages: { stream: () => ({
    on: (event: string, cb: (event: unknown) => void) => { if (event === 'streamEvent') cb({ type: 'content_block_delta', delta: { text: 'x'.repeat(9 * 1024 * 1024) } }); },
    abort: () => undefined,
    finalMessage: async () => { throw new Error('aborted'); },
  }) } } as unknown as Pick<Anthropic, 'messages'>;
  const model = new DeepSeekEditorialModel({ apiKey: 'test-key', client });
  await assert.rejects(model.call(call()), /response exceeded/);
});

test('deepseek model: refuses a route for another provider and a missing credential', async () => {
  const f = fake();
  const model = new DeepSeekEditorialModel({ apiKey: 'test-key', client: f.client });
  await assert.rejects(model.call(call({ provider: 'anthropic' })), /routed to anthropic/);
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try { assert.throws(() => new DeepSeekEditorialModel(), /DEEPSEEK_API_KEY is not configured/); }
  finally { if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous; }
});
