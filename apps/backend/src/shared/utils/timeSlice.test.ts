import assert from 'node:assert/strict';
import test from 'node:test';
import { TimeSlice } from './timeSlice';

test('TimeSlice yields only once its budget is spent, and a yield lets timers run (a microtask await would not)', async () => {
  let t = 0;
  let yielded = 0;
  const slice = new TimeSlice(8, async () => { yielded += 1; }, () => t);
  await slice.tick();
  t = 7; await slice.tick();
  assert.equal(yielded, 0, 'within budget: no yield');
  t = 8; await slice.tick();
  assert.equal(yielded, 1);
  t = 10; await slice.tick();
  assert.equal(yielded, 1, 'the budget restarts after a yield');
  t = 16; await slice.tick();
  assert.equal(slice.yields, 2);

  let timer = false;
  setTimeout(() => { timer = true; }, 0);
  await Promise.resolve().then(() => undefined); // microtasks alone never reach the timers phase
  assert.equal(timer, false);
  await new TimeSlice(0).tick(); // the default yielder is setImmediate
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(timer, true);
});
