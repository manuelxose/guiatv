#!/usr/bin/env node
// ENGINE-03 confined gate for the M05 worktrees.
//   node scripts/test.mjs  [backend|frontend]
// Mirrors the npm scripts without needing the npm CLI inside the confined child.
import { spawnSync } from 'node:child_process';

const target = process.argv[2] ?? 'backend';

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
  process.exit(runIn('apps/backend', 'node', ['--require', './test-setup.cjs', '--test', 'dist/**/*.test.js']));
}

if (target === 'frontend') {
  const ng = 'node ../../node_modules/@angular/cli/bin/ng.js';
  process.exit(runIn('apps/frontend', `${ng} test --watch=false --browsers=ChromeHeadlessNoSandbox`, []));
}

console.error(`unknown target "${target}" (expected backend|frontend)`);
process.exit(2);
