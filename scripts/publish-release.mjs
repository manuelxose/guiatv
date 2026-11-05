import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

function buildReleaseId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function fingerprintDirectory(rootDir) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      hash.update(absolutePath.replace(rootDir, ''));
      hash.update('\0');
      hash.update(readFileSync(absolutePath));
      hash.update('\0');
    }
  };
  walk(rootDir);
  return hash.digest('hex');
}

function getGitSha(projectRoot) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function removePathIfExists(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }
  rmSync(targetPath, { recursive: true, force: true });
}

function pruneLegacyUnifiedReleases(releasesRoot, protectedReleaseIds) {
  const releaseDirs = readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}$/.test(entry.name))
    .map((entry) => entry.name);

  for (const releaseId of releaseDirs) {
    if (protectedReleaseIds.has(releaseId)) {
      continue;
    }

    const releaseDir = join(releasesRoot, releaseId);
    if (!existsSync(join(releaseDir, 'release.json'))) {
      rmSync(releaseDir, { recursive: true, force: true });
    }
  }
}

function pruneReleases(releasesRoot, keepCount, protectedReleaseIds) {
  const releaseIds = readdirSync(releasesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^\d{14}$/.test(entry.name) &&
        existsSync(join(releasesRoot, entry.name, 'release.json'))
    )
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const releaseId of releaseIds.slice(keepCount)) {
    if (protectedReleaseIds.has(releaseId)) {
      continue;
    }
    rmSync(join(releasesRoot, releaseId), { recursive: true, force: true });
  }
}

function carryForwardBrowserAssets(releasesRoot, destinationBrowserRoot, releaseLimit) {
  const previousReleaseIds = readdirSync(releasesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^\d{14}$/.test(entry.name) &&
        existsSync(join(releasesRoot, entry.name, 'release.json'))
    )
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, releaseLimit);

  let copied = 0;
  for (const previousReleaseId of previousReleaseIds) {
    const previousBrowserRoot = join(
      releasesRoot,
      previousReleaseId,
      'apps/frontend/dist/guiatv/browser'
    );
    if (!existsSync(previousBrowserRoot)) continue;

    for (const entry of readdirSync(previousBrowserRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:css|js|mjs)$/.test(entry.name)) continue;
      try {
        copyFileSync(
          join(previousBrowserRoot, entry.name),
          join(destinationBrowserRoot, entry.name),
          fsConstants.COPYFILE_EXCL
        );
        copied += 1;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
  }
  return copied;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const releasesRoot = resolve(projectRoot, 'releases');
const currentLink = resolve(projectRoot, 'current');
const backendDistRoot = resolve(projectRoot, 'apps/backend/dist');
const frontendDistRoot = resolve(projectRoot, 'apps/frontend/dist/guiatv');
const frontendServerScript = resolve(projectRoot, 'apps/frontend/scripts/ssr-server.mjs');
const editorialRunnerScript = resolve(projectRoot, 'scripts/editorial-agents.mjs');
const editorialLedgerScript = resolve(projectRoot, 'scripts/editorial-job-ledger.mjs');
const editorialDrafts = resolve(projectRoot, 'docs/seo/editorial-drafts/publish.json');
const legacyFrontendReleasesRoot = resolve(projectRoot, 'apps/frontend/releases');
const cliArgs = process.argv.slice(2);
const checkOnly = cliArgs.includes('--check');
const unsupportedOption = cliArgs.find((arg) => arg.startsWith('--') && arg !== '--check');
const positionalArgs = cliArgs.filter((arg) => !arg.startsWith('--'));
const explicitReleaseId = positionalArgs[0];
const releaseId = explicitReleaseId || buildReleaseId();
const keepCountInput = process.env.GUIATV_RELEASE_KEEP ?? '5';
const keepCount = Number.parseInt(keepCountInput, 10);
const releaseDir = join(releasesRoot, releaseId);
const releaseBackendRoot = join(releaseDir, 'apps/backend');
const releaseFrontendRoot = join(releaseDir, 'apps/frontend');

if (unsupportedOption) {
  console.error(`[publish-release] Unsupported option: ${unsupportedOption}`);
  process.exit(1);
}

if (positionalArgs.length > 1) {
  console.error('[publish-release] Provide at most one release ID.');
  process.exit(1);
}

if (!/^\d{14}$/.test(releaseId)) {
  console.error('[publish-release] Release ID must contain exactly 14 digits (YYYYMMDDhhmmss).');
  process.exit(1);
}

if (!/^\d+$/.test(keepCountInput) || keepCount < 1) {
  console.error('[publish-release] GUIATV_RELEASE_KEEP must be a positive integer.');
  process.exit(1);
}

if (!existsSync(backendDistRoot)) {
  console.error(`[publish-release] Backend build output not found at ${backendDistRoot}`);
  console.error('[publish-release] Run `npm run build:backend` or `npm run build` before publishing a release.');
  process.exit(1);
}

if (!existsSync(frontendDistRoot)) {
  console.error(`[publish-release] Frontend build output not found at ${frontendDistRoot}`);
  console.error('[publish-release] Run `npm run build:frontend` or `npm run build` before publishing a release.');
  process.exit(1);
}

if (!existsSync(frontendServerScript)) {
  console.error(`[publish-release] SSR server entrypoint not found at ${frontendServerScript}`);
  process.exit(1);
}

if (!existsSync(editorialRunnerScript)) {
  console.error(`[publish-release] Editorial runner entrypoint not found at ${editorialRunnerScript}`);
  process.exit(1);
}

if (!existsSync(editorialDrafts)) {
  console.error(`[publish-release] Editorial maintenance data not found at ${editorialDrafts}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(JSON.stringify({
    status: 'ready',
    mode: 'check',
    releaseId,
    gitSha: getGitSha(projectRoot),
    backendFingerprint: fingerprintDirectory(backendDistRoot),
    frontendFingerprint: fingerprintDirectory(frontendDistRoot),
    keepCount,
  }, null, 2));
  process.exit(0);
}

mkdirSync(releasesRoot, { recursive: true });
// The active release may still contain an executing runner and must remain available for rollback.
const previousRelease = existsSync(currentLink) ? realpathSync(currentLink) : null;
const protectedReleaseIds = new Set([releaseId]);
if (previousRelease && dirname(previousRelease) === realpathSync(releasesRoot)) protectedReleaseIds.add(basename(previousRelease));

if (existsSync(releaseDir)) {
  console.error(`[publish-release] Release directory already exists: ${releaseDir}`);
  process.exit(1);
}

mkdirSync(releaseBackendRoot, { recursive: true });
mkdirSync(join(releaseFrontendRoot, 'scripts'), { recursive: true });
mkdirSync(join(releaseDir, 'scripts'), { recursive: true });
mkdirSync(join(releaseDir, 'docs/seo/editorial-drafts'), { recursive: true });

cpSync(backendDistRoot, join(releaseBackendRoot, 'dist'), { recursive: true });
cpSync(frontendDistRoot, join(releaseFrontendRoot, 'dist/guiatv'), { recursive: true });
cpSync(frontendServerScript, join(releaseFrontendRoot, 'scripts/ssr-server.mjs'));
cpSync(editorialRunnerScript, join(releaseDir, 'scripts/editorial-agents.mjs'));
cpSync(editorialLedgerScript, join(releaseDir, 'scripts/editorial-job-ledger.mjs'));
cpSync(editorialDrafts, join(releaseDir, 'docs/seo/editorial-drafts/publish.json'));
// Imported by ssr-server.mjs.
for (const helper of ['ssr-canonical.mjs', 'ssr-cache.mjs']) {
  cpSync(resolve(projectRoot, 'apps/frontend/scripts', helper), join(releaseFrontendRoot, 'scripts', helper));
}
const carriedBrowserAssetCount = carryForwardBrowserAssets(
  releasesRoot,
  join(releaseFrontendRoot, 'dist/guiatv/browser'),
  keepCount
);

const metadata = {
  app: 'guiatv',
  releaseId,
  releasedAt: new Date().toISOString(),
  gitSha: getGitSha(projectRoot),
  backendFingerprint: fingerprintDirectory(backendDistRoot),
  frontendFingerprint: fingerprintDirectory(frontendDistRoot),
  carriedBrowserAssetCount,
};

writeFileSync(join(releaseDir, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

const tempLink = `${currentLink}.tmp`;
removePathIfExists(tempLink);
symlinkSync(releaseDir, tempLink);
rmSync(currentLink, { recursive: true, force: true });
renameSync(tempLink, currentLink);

removePathIfExists(join(releasesRoot, 'current'));
removePathIfExists(join(legacyFrontendReleasesRoot, 'current'));
pruneLegacyUnifiedReleases(releasesRoot, protectedReleaseIds);
removePathIfExists(legacyFrontendReleasesRoot);

pruneReleases(releasesRoot, keepCount, protectedReleaseIds);

console.log(`[publish-release] Published unified release ${releaseId}`);
console.log(`[publish-release] Current -> ${releaseDir}`);
console.log(`[publish-release] Metadata -> ${join(releaseDir, 'release.json')}`);
console.log(`[publish-release] Carried browser assets -> ${carriedBrowserAssetCount}`);
