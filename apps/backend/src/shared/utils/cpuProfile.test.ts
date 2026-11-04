import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startStartupCpuProfile } from './cpuProfile';

test('the CPU profile is off by default and needs both the switch and an explicit directory', () => {
  assert.equal(startStartupCpuProfile({}), null);
  assert.equal(startStartupCpuProfile({ DIAG_CPU_PROFILE: 'on', DIAG_CPU_PROFILE_DIR: tmpdir() }), null, 'only the exact value "startup" enables it');
  assert.equal(startStartupCpuProfile({ DIAG_CPU_PROFILE: 'startup' }), null, 'no directory, no profile');
});

test('when enabled it writes exactly one .cpuprofile with sampled nodes into the given directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guiatv-cpuprof-'));
  try {
    const handle = startStartupCpuProfile({ DIAG_CPU_PROFILE: 'startup', DIAG_CPU_PROFILE_DIR: dir, DIAG_CPU_PROFILE_SECONDS: '5' });
    assert.ok(handle);
    const end = performance.now() + 30;
    while (performance.now() < end) { /* give the sampler something to see */ }
    const file = await handle!.stop();
    assert.ok(file && file.startsWith(dir) && file.endsWith('.cpuprofile'), String(file));
    const profile = JSON.parse(readFileSync(file!, 'utf8'));
    assert.ok(Array.isArray(profile.nodes) && profile.nodes.length > 0);
    assert.equal(await handle!.stop(), file, 'a second stop() returns the same file and writes nothing more');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unwritable directory is logged and swallowed: the app never sees the failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guiatv-cpuprof-'));
  try {
    const blocker = join(dir, 'file-not-dir');
    writeFileSync(blocker, 'x');
    const handle = startStartupCpuProfile({ DIAG_CPU_PROFILE: 'startup', DIAG_CPU_PROFILE_DIR: join(blocker, 'sub') });
    assert.ok(handle);
    assert.equal(await handle!.stop(), undefined);
    assert.equal(existsSync(join(blocker, 'sub')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
