#!/usr/bin/env node
/**
 * M06-R1 backend suite runner — reproducible evidence under the installed Windows sandbox.
 *
 * Why this file exists
 * --------------------
 * `npm run test -w apps/backend` uses `node --test` (default `--test-isolation=process`),
 * which spawns one worker per test file over a **pipe**. The Windows sandbox in this
 * environment denies a child the ability to open a pipe, so the default runner aborts
 * every file at worker creation with `spawn EPERM`. An independent reviewer hit exactly
 * this and could not execute the suite (docs/sports-v2/M06-INDEPENDENT-REVIEW.md §1).
 *
 * Measured facts behind this script (see M06-R1-REMEDIATION.md):
 *   1. `--test-isolation=none` runs all test files inside the runner process, so no
 *      per-file worker (and no pipe) is created — the suite actually executes.
 *   2. Shell redirection of *this* process's stdout works, but the spec-style reporter's
 *      summary line is suppressed for non-TTY stdout.
 *   3. The JUnit reporter writes a structured file directly, independent of stdio.
 *
 * So results are emitted as JUnit XML and parsed here. This is a runner adaptation to a
 * verified environment limit — NO assertion is relaxed, and a non-zero exit is a real
 * failure. A run that executes zero tests is reported as a failure, never a pass.
 *
 * Usage
 *   node scripts/m06-r1-run-backend-suite.mjs                       # full suite
 *   node scripts/m06-r1-run-backend-suite.mjs --only <regex>        # subset by path
 *   node scripts/m06-r1-run-backend-suite.mjs --out <dir>           # evidence directory
 *
 * Exit: 0 = every test passed; 1 = at least one failure; 2 = could not run; 3 = zero tests.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(decodeURIComponent(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))), '..');
const DIST = join(ROOT, 'apps', 'backend', 'dist');
const BACKEND = join(ROOT, 'apps', 'backend');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const only = arg('only', null);
const outDir = arg('out', join(ROOT, 'artifacts', 'm06-r1', 'evidence', 'backend'));
const junitPath = join(outDir, 'junit.xml');

if (!existsSync(DIST)) {
  console.error(`error: ${DIST} missing — build the backend first`);
  process.exit(2);
}

function collect(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) collect(abs, acc);
    else if (entry.endsWith('.test.js')) acc.push('apps/backend/' + relative(BACKEND, abs).split('\\').join('/'));
  }
  return acc;
}

let files = collect(DIST).sort();
if (only) files = files.filter((f) => new RegExp(only).test(f));
if (files.length === 0) {
  console.error('error: no test files matched — refusing to report a zero-test success');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    '--require', './apps/backend/test-setup.cjs',
    '--test', '--test-isolation=none',
    '--test-reporter=junit', `--test-reporter-destination=${junitPath}`,
    ...files,
  ],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, TZ: 'Europe/Madrid' }, windowsHide: true },
);

if (result.error) {
  console.error(`error: could not start the test runner: ${result.error.code ?? result.error}`);
  process.exit(2);
}
if (!existsSync(junitPath)) {
  console.error('error: the runner produced no JUnit report; treating as a failed run');
  process.exit(2);
}

const xml = readFileSync(junitPath, 'utf8');

/** Parse <testcase> elements: name, file, and whether a failure was recorded. */
function parseCases(source) {
  const cases = [];
  const rx = /<testcase\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = rx.exec(source)) !== null) {
    const attrs = m[1];
    const attr = (n) => {
      const a = attrs.match(new RegExp(`${n}="([^"]*)"`));
      return a ? a[1] : undefined;
    };
    // Self-closing testcase = passed; otherwise scan to the closing tag for a failure.
    let failed = false;
    let message;
    if (!m[2]) {
      const close = source.indexOf('</testcase>', rx.lastIndex);
      const body = source.slice(rx.lastIndex, close === -1 ? undefined : close);
      failed = /<failure\b/.test(body);
      if (failed) {
        const fm = body.match(/<failure\b[^>]*?(?:message="([^"]*)")?[^>]*>/);
        message = fm?.[1]?.replace(/&#10;/g, ' ').slice(0, 300);
      }
    }
    const sk = /<skipped\b/.test(source.slice(rx.lastIndex, rx.lastIndex + 200));
    cases.push({ name: decode(attr('name')), file: attr('file'), failed, skipped: sk, message });
  }
  return cases;
}
function decode(s) {
  return s ? s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ') : s;
}

const cases = parseCases(xml);
const tests = cases.length;
const failed = cases.filter((c) => c.failed);
const skipped = cases.filter((c) => c.skipped);
const pass = tests - failed.length - skipped.length;

const summary = {
  ranAt: new Date().toISOString(),
  runnerExitCode: result.status,
  isolation: 'none',
  testFiles: files.length,
  tests,
  pass,
  fail: failed.length,
  skipped: skipped.length,
  failingTests: failed.map((c) => ({ name: c.name, file: c.file ? relative(join(BACKEND, 'dist'), c.file) : undefined, message: c.message })),
  junit: relative(ROOT, junitPath),
  zeroTestGuard: tests > 0,
};

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ tests, pass, fail: failed.length, skipped: skipped.length, runnerExitCode: result.status }, null, 0));

if (tests === 0) {
  console.error('error: zero tests executed — not a pass');
  process.exit(3);
}
const ok = result.status === 0 && failed.length === 0;
if (!ok) console.error(`failures: ${failed.length} (see ${summary.junit})`);
process.exit(ok ? 0 : 1);


