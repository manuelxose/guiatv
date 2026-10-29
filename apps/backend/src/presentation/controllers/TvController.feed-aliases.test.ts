import test from 'node:test';
import assert from 'node:assert/strict';
import { TvController } from './TvController';

// M10-C: the read views (live guide, home "tonight", search) never list a verified second feed of a channel: it
// repeats that channel's airings and its page is a 301. An explicit channel filter still gets that channel's rows.
const row = (id: string, channelId: string) => ({ id, channel: { id: channelId } }) as any;
const summary = (channelId: string) => ({ channel: { id: channelId } }) as any;

function controller(current: () => Map<string, unknown>) {
  const reader = {
    query: async () => ({ items: [row('a', 'telemadrid'), row('b', 'telemadrid_tv')], channels: [summary('telemadrid'), summary('telemadrid_tv')], meta: {} }),
    getChannels: async () => ({ channels: [summary('telemadrid'), summary('telemadrid_tv')], meta: {} }),
    getSchedule: async () => ({ channels: [summary('telemadrid'), summary('telemadrid_tv')], meta: {} }),
  } as any;
  return new TvController(reader, {} as any, { current: current as any });
}
const call = async (c: TvController, method: 'read' | 'readChannels' | 'readSchedule', query: Record<string, string> = {}) => {
  let body: any;
  const res: any = { status: () => res, json: (b: unknown) => { body = b; } };
  await c[method]({ query, params: {} } as any, res);
  return body.data;
};
const aliases = () => new Map([['telemadrid_tv', { id: 'telemadrid' }]]);

test('M10-C TvController: read views hide verified aliases; an explicit channel filter keeps them', async () => {
  const c = controller(aliases);
  const read = await call(c, 'read');
  assert.deepEqual(read.items.map((i: any) => i.id), ['a']);
  assert.deepEqual(read.channels.map((e: any) => e.channel.id), ['telemadrid']);
  assert.deepEqual((await call(c, 'readChannels')).channels.map((e: any) => e.channel.id), ['telemadrid']);
  assert.deepEqual((await call(c, 'readSchedule')).channels.map((e: any) => e.channel.id), ['telemadrid']);
  assert.equal((await call(c, 'read', { channelId: 'telemadrid_tv' })).items.length, 2);
});

test('M10-C TvController: without the alias list everything is listed, as before', async () => {
  const c = controller(() => { throw new Error('down'); });
  assert.equal((await call(c, 'read')).items.length, 2);
});
