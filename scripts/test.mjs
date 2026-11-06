#!/usr/bin/env node
// ENGINE-03 confined gate for the backend worktrees.
//
// The ACL sandbox refuses the per-file child processes that `node --test` spawns
// (EPERM), so this gate runs every test file in-process on a single Node event loop.
// Each file therefore loses its process isolation: a file that leaves a handle open or
// mutates global state can affect a later file. Use it as a fast inner signal; the
// authoritative full-suite run is `node scripts/suite.mjs` unconfined.
//
// M05_GATE_TARGET=backend (default) | frontend
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const target = process.env.M05_GATE_TARGET ?? 'backend';

const runIn = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd });
  return r.status ?? 1;
};

if (target === 'backend') {
  const tsc = runIn('.', 'node', ['node_modules/typescript/bin/tsc', '-p', 'apps/backend/tsconfig.json', '--noEmit']);
  console.log('backend typecheck exit', tsc);
  if (tsc !== 0) process.exit(tsc);
  const build = runIn('apps/backend', 'node', ['../../node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  console.log('backend build exit', build);
  if (build !== 0) process.exit(build);
  const alias = runIn('apps/backend', 'node', ['../../node_modules/tsc-alias/dist/bin/index.js', '-p', 'tsconfig.json']);
  console.log('backend tsc-alias exit', alias);
  if (alias !== 0) process.exit(alias);

  // Sports-module tests first: they are the regression gate for this milestone.
  const dist = join('apps', 'backend', 'dist');
  const walk = (p, out = []) => {
    if (!existsSync(p)) return out;
    if (statSync(p).isFile()) {
      if (p.endsWith('.test.js')) out.push(p);
      return out;
    }
    for (const name of readdirSync(p)) walk(join(p, name), out);
    return out;
  };
  const sportsRoots = [
    join(dist, 'domain', 'sports'),
    join(dist, 'infrastructure', 'sports'),
    join(dist, 'application', 'sports'),
    join(dist, 'presentation', 'controllers', 'FootballController.test.js'),
  ];
  const sports = [...new Set(sportsRoots.flatMap((r) => walk(r)))].sort();
  if (!sports.length) {
    console.error('no sports test files found');
    process.exit(1);
  }
  console.log(`== in-process sports gate: ${sports.length} file(s) ==`);
  const r = spawnSync('node', ['--require', './test-setup.cjs', '--test', ...sports], {
    stdio: 'inherit',
    cwd: join('apps', 'backend'),
  });
  process.exit(r.status ?? 1);
}

if (target === 'frontend') {
  const ng = 'node ../../node_modules/@angular/cli/bin/ng.js';
  process.exit(runIn('apps/frontend', `${ng} test --watch=false --browsers=ChromeHeadlessNoSandbox`, []));
}

console.error(`unknown M05_GATE_TARGET "${target}" (expected backend|frontend)`);
process.exit(2);
