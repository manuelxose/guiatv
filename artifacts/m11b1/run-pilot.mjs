// M11-B1 pilot: one live pipeline run of the Netflix ranking revision as a LOCAL run file (no --report, no publish).
// Same env as editorial-scheduled.mjs: secrets from ~/.guiatv/{gateway,runner}.env, never printed; the human review key
// is blanked. Spend goes to the machine-wide journal (artifacts/m11b/runs/spend.jsonl) like every other run.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const envFile = (name) => {
  const file = join(homedir(), '.guiatv', name);
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^(export\s+)?\w+=/.test(l))
    .map((l) => l.replace(/^export\s+/, '')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
};
const secrets = { ...envFile('gateway.env'), ...envFile('runner.env') };
const repo = fileURLToPath(new URL('../..', import.meta.url));
const r = spawnSync(process.execPath, ['scripts/editorial-agents.mjs', 'run', 'artifacts/m11b1/topic-netflix.json', '--out', 'artifacts/m11b1/runs'], {
  cwd: repo, stdio: 'inherit',
  env: { ...process.env, ...secrets, EDITORIAL_SPEND_DIR: join(repo, 'artifacts', 'm11b', 'runs'), EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '',
    ANTHROPIC_MODEL_PREFIX: secrets.ANTHROPIC_MODEL_PREFIX ?? 'cc/', EDITORIAL_BUDGET: secrets.EDITORIAL_BUDGET ?? 'unlimited' },
  timeout: 2 * 3600e3,
});
process.exitCode = r.status ?? 1;
