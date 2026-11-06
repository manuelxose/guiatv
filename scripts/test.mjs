#!/usr/bin/env node
// ENGINE-03 confined gate for the backend worktrees.
//
// Behaviour problem, stated plainly: the Windows ACL sandbox refuses the file-level
// child processes that `node --test` spawns (EPERM), whatever the argument shape.
// So inside confinement this gate can prove BUILD INTEGRITY (typecheck, tsc, tsc-alias)
// and RUN TESTS IN THIS ONE PROCESS ONLY when each file is loaded directly.
//
// Loading `.test.js` files directly does NOT register `node:test` tests (they call
// `test(...)` from the module at load time and are only discovered by the runner), so
// that path reports "0 tests" and is NOT accepted as evidence. To avoid a false green
// the gate REFUSES to run tests confined and exits 3 with that explanation.
//
// Authoritative runs are unconfined:
//   node scripts/test.mjs                     (full suite, per-file isolation)
//   node scripts/suite.mjs                    (same, explicit)
import { spawnSync } from 'node:child_process';

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
  console.log('BUILD OK: typecheck, tsc and tsc-alias all passed.');
  console.error(
    [
      'REFUSED: unit tests are not executed here.',
      'The ACL sandbox denies the per-file spawns node --test needs (EPERM), and loading',
      'dist test files in-process registers no node:test cases (0 tests counted), which',
      'would be a false green. Run the suite unconfined: node scripts/suite.mjs',
    ].join('\n')
  );
  process.exit(3);
}

console.error(`unknown M05_GATE_TARGET "${target}" (expected backend)`);
process.exit(2);
