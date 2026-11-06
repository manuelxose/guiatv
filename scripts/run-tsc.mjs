#!/usr/bin/env node
// ENGINE-03 confined gate: typecheck for the M05 worktrees.
import { spawnSync } from 'node:child_process';
process.exit(spawnSync('node', ['node_modules/typescript/bin/tsc', '-p', 'apps/backend/tsconfig.json', '--noEmit'], { stdio: 'inherit', shell: true }).status ?? 1);
