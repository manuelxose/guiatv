import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createIsolatedJobRunner, listScheduledJobs, runScheduledJob, type SpawnProcess } from './index';

test('isolated job runner spawns the heavy job outside the API process', async () => {
  const child = new EventEmitter();
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const spawnProcess: SpawnProcess = ((command: string, args: string[]) => {
    calls.push({ command, args });
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  }) as unknown as SpawnProcess;
  const run = createIsolatedJobRunner('/runtime/sync.js', spawnProcess);

  assert.equal(await run(), true);
  assert.deepEqual(calls, [{ command: process.execPath, args: ['/runtime/sync.js'] }]);
});

test('isolated job runner skips overlapping executions', async () => {
  const child = new EventEmitter();
  let spawnCount = 0;
  const run = createIsolatedJobRunner('/runtime/sync.js', (() => {
    spawnCount += 1;
    return child;
  }) as unknown as SpawnProcess);

  const firstRun = run();
  assert.equal(await run(), false);
  assert.equal(spawnCount, 1);

  child.emit('exit', 0, null);
  assert.equal(await firstRun, true);
});

test('isolated job runner reports child failures and permits the next run', async () => {
  const firstChild = new EventEmitter();
  const secondChild = new EventEmitter();
  const children = [firstChild, secondChild];
  const run = createIsolatedJobRunner(
    '/runtime/sync.js',
    (() => children.shift()) as unknown as SpawnProcess
  );

  const failedRun = run();
  firstChild.emit('exit', 1, null);
  await assert.rejects(failedRun, /exited with code 1/);

  const nextRun = run();
  secondChild.emit('exit', 0, null);
  assert.equal(await nextRun, true);
});

test('an unregistered scheduled job cannot be run on demand and is not listed', async () => {
  assert.deepEqual(listScheduledJobs().filter((job) => job.name === 'nope'), []);
  await assert.rejects(runScheduledJob('nope'), /Unknown or non-runnable/);
});
