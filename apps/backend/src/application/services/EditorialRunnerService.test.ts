import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditorialRunnerService } from './EditorialRunnerService';

test('editorial runner process starts, reports, logs and stops only the configured command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'editorial-runner-service-'));
  const script = join(dir, 'runner.js');
  writeFileSync(script, "console.log('runner ready'); setInterval(() => {}, 1000);\n");
  const service = new EditorialRunnerService({ command: process.execPath, args: [script], cwd: dir, stateDir: dir, envKeys: ['PATH', 'HOME'] });
  try {
    assert.deepEqual([service.state().configured, service.state().running], [true, false]);
    const started = await service.start();
    assert.ok(started.running && started.pid);
    assert.equal((await service.start()).pid, started.pid, 'a second start is idempotent');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !service.logs().lines.some((line) => line.includes('runner ready'))) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(service.logs().lines.some((line) => line.includes('runner ready')));
    assert.equal((await service.stop()).running, false);
    assert.equal(service.state().pid, null);
  } finally {
    await service.stop().catch(() => undefined);
    // Windows releases the child's file handles asynchronously after stop(): the immediate rmSync raised EPERM
    // whenever the process had just been killed. Retry briefly; the cleanup is asserted by the test outcome,
    // not by the first attempt (nothing about the service under test changes).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
});

test('editorial runner management refuses to pretend it is available without server configuration', async () => {
  const service = new EditorialRunnerService({ command: undefined, stateDir: mkdtempSync(join(tmpdir(), 'editorial-runner-disabled-')) });
  assert.deepEqual([service.state().configured, service.state().running], [false, false]);
  await assert.rejects(() => service.start(), /EDITORIAL_RUNNER_COMMAND/);
});
