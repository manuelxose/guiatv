#!/usr/bin/env node
// ENGINE-04 stage: builds the backend (tsc + tsc-alias) then runs ONLY the M05
// sports test files.
//
// Why not the full suite: inside the Windows ACL sandbox `node --test` spawns one
// child process per file and the WRITE_RESTRICTED token refuses those spawns (EPERM),
// so the full 968-test backend suite cannot be measured there. Gated evidence is
// therefore scoped to the football/sports modules, and the captain runs the full
// suite unconfined. This script fails closed on any build error.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const backendDir = join('apps', 'backend');
const dist = join(backendDir, 'dist');

const step = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd });
  if ((r.status ?? 1) !== 0) {
    console.error(`stage failed: ${cmd} ${args.join(' ')} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};

step('.', 'node', ['node_modules/typescript/bin/tsc', '-p', join(backendDir, 'tsconfig.json')]);
step(backendDir, 'node', ['../../node_modules/tsc-alias/dist/bin/index.js', '-p', 'tsconfig.json']);

const roots = [
  join(dist, 'domain', 'sports'),
  join(dist, 'infrastructure', 'sports'),
  join(dist, 'application', 'sports'),
  join(dist, 'presentation', 'controllers', 'FootballController.test.js'),
  join(dist, 'presentation', 'routes', 'football.routes.test.js'),
  join(dist, 'scripts', 'validate-football-provider.test.js'),
];

const walk = (p, out = []) => {
  if (!existsSync(p)) return out;
  if (statSync(p).isFile()) {
    if (p.endsWith('.test.js')) out.push(p);
    return out;
  }
  for (const name of readdirSync(p)) walk(join(p, name), out);
  return out;
};

const files = roots.flatMap((r) => walk(r)).sort();
if (!files.length) {
  console.error('no sports test files found under apps/backend/dist');
  process.exit(1);
}

console.log(`running ${files.length} sports test file(s)`);
const r = spawnSync(
  'node',
  ['--require', './test-setup.cjs', '--test', ...files.map((f) => relative(backendDir, f))],
  { stdio: 'inherit', cwd: backendDir }
);
process.exit(r.status ?? 1);
