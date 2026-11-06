#!/usr/bin/env node
// ENGINE-03 confined gate for the M05 backend worktrees.
import { spawnSync } from 'node:child_process';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  return r.status ?? 1;
};
console.log('== backend typecheck: tsc --noEmit ==');
const tsc = run('node', ['node_modules/typescript/bin/tsc', '-p', 'apps/backend/tsconfig.json', '--noEmit']);
console.log('typecheck exit', tsc);
if (tsc !== 0) process.exit(tsc);
console.log('== backend build + unit tests ==');
process.exit(run('node', ['node_modules/npm/bin/npm-cli.js', 'run', 'test', '--prefix', 'apps/backend']));
