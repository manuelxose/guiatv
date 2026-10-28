#!/usr/bin/env node
// M11-F unattended entry point for the OS scheduler (Windows Task Scheduler on the runner machine, see
// docs/roadmap/M11F-DELIVERY.md): runs one `editorial-agents.mjs cycle` against production and appends its output to
// <state>/m11b/runs/cycle-logs/<day>.log. No terminal needed. Overlaps are refused by the runner lock.
//
// Secrets come from ~/.guiatv/runner.env (ANALYTICS_ADMIN_KEY, EDITORIAL_PIPELINE_SIGNING_KEY, EDITORIAL_POLICY_KEY) and
// ~/.guiatv/gateway.env (the model gateway: ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN); never printed. The human review
// key is blanked: the scheduler can publish by policy only. GUIATV_EDITORIAL_STATE (runner.env) = the folder holding
// the spend journal, queue and run files (default: this checkout's artifacts/).
//   node scripts/editorial-scheduled.mjs [cycle|discover]
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = (name) => {
  const file = join(homedir(), '.guiatv', name);
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^(export\s+)?\w+=/.test(l))
    .map((l) => l.replace(/^export\s+/, '')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
};
const secrets = { ...envFile('gateway.env'), ...envFile('runner.env') };
const missing = ['ANALYTICS_ADMIN_KEY', 'EDITORIAL_PIPELINE_SIGNING_KEY', 'EDITORIAL_POLICY_KEY'].filter((k) => !secrets[k]);
if (missing.length) { console.error(`runner.env lacks ${missing.join(', ')}`); process.exit(2); }
const state = secrets.GUIATV_EDITORIAL_STATE || join(repo, 'artifacts');
const logDir = join(state, 'm11b', 'runs', 'cycle-logs');
mkdirSync(logDir, { recursive: true });
const log = openSync(join(logDir, `${new Date().toISOString().slice(0, 10)}.log`), 'a');
const command = process.argv[2] === 'discover' ? 'discover' : 'cycle';
const r = spawnSync(process.execPath, ['scripts/editorial-agents.mjs', command, '--report', 'https://guiaprogramaciontv.com', '--confirm-production-write', '--out', join(state, 'm11d', 'runs')], {
  cwd: repo,
  stdio: ['ignore', log, log],
  env: {
    ...process.env, ...secrets, EDITORIAL_SPEND_DIR: join(state, 'm11b', 'runs'),
    EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '', ANTHROPIC_MODEL_PREFIX: secrets.ANTHROPIC_MODEL_PREFIX ?? 'cc/',
    EDITORIAL_BUDGET: secrets.EDITORIAL_BUDGET ?? 'unlimited',
  },
  // A cycle is at most one article with bounded revisions; a hung one is killed and its lock recovered next time.
  timeout: 3 * 3600e3,
});
closeSync(log);
process.exitCode = r.status ?? 1;
