import test from 'node:test';
import assert from 'node:assert/strict';
import { SingleFlight } from './SingleFlight';
import { setTimeout as delay } from 'node:timers/promises';

test('collapses concurrent identical requests into one upstream call', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const fetch = async (): Promise<string> => {
    calls += 1;
    await delay(10);
    return 'value';
  };

  const [a, b, c] = await Promise.all([
    flight.do('openligadb:season', fetch),
    flight.do('openligadb:season', fetch),
    flight.do('openligadb:season', fetch),
  ]);

  assert.equal(calls, 1);
  assert.equal(a, 'value');
  assert.equal(b, 'value');
  assert.equal(c, 'value');
});

test('different keys do not dedupe', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const fetch = async (): Promise<number> => {
    calls += 1;
    return calls;
  };

  const [a, b] = await Promise.all([
    flight.do('openligadb:bl1', fetch),
    flight.do('openligadb:bl2', fetch),
  ]);

  assert.equal(calls, 2);
  assert.equal(a, 1);
  assert.equal(b, 2);
});

test('a settled request can be issued again', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const fetch = async (): Promise<number> => {
    calls += 1;
    return calls;
  };

  assert.equal(await flight.do('k', fetch), 1);
  assert.equal(await flight.do('k', fetch), 2);
});

test('dedupe hits are counted and reported through the callback', async () => {
  let reported = 0;
  const flight = new SingleFlight({ onDedupe: () => (reported += 1) });
  const fetch = async (): Promise<string> => {
    await delay(10);
    return 'value';
  };

  await Promise.all([
    flight.do('k', fetch),
    flight.do('k', fetch),
    flight.do('k', fetch),
  ]);

  assert.equal(flight.dedupeCount(), 2); // one real call, two avoided
  assert.equal(reported, 2);
});
