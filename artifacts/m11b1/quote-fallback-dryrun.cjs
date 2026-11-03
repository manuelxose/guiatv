// M11-B1 dry run of the containsQuote digit-boundary fallback over every stored run file: same fresh snapshot,
// old rule (whitespace stripped only) vs new verifyBundle. Read-only: public GETs of the cited sources, writes one JSON.
//   node artifacts/m11b1/quote-fallback-dryrun.cjs <out.json> <runs dir>...
const { readdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const ev = require('../../apps/backend/dist/application/services/EditorialEvidence.js');

const UA = 'GuiaTV-Editorial-Agent/1.0 (+https://guiaprogramaciontv.com/politica-editorial)';
const oldContains = (text, needle) => {
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? '';
    const after = text.slice(at + needle.length, at + needle.length + 2);
    if (/^\d/.test(needle) && /[\d.,]/.test(before)) continue;
    if (/\d$/.test(needle) && /^(?:\d|[.,]\d)/.test(after)) continue;
    return true;
  }
  return false;
};
async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const raw = (await res.text()).slice(0, 2_000_000);
    return /json/.test(res.headers.get('content-type') || '') ? raw : raw.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  } catch { return null; }
}
(async () => {
  const [out, ...dirs] = process.argv.slice(2);
  const cache = new Map();
  const report = { at: new Date().toISOString(), files: 0, quotes: 0, compared: 0, oldTrueNewFalse: 0, flips: [] };
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let run; try { run = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      const bundle = run.provenance?.bundle; if (!bundle?.claims) continue;
      report.files++;
      const snapshots = new Map();
      for (const s of bundle.sources ?? []) {
        if (!cache.has(s.url)) cache.set(s.url, await fetchText(s.url));
        if (cache.get(s.url) != null) snapshots.set(s.id, cache.get(s.url));
      }
      const fresh = ev.verifyBundle(bundle, snapshots);
      const used = new Set([...String(run.provenance.draftMarkdown ?? '').matchAll(/\[\[([^\]]+)\]\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())));
      fresh.claims.forEach((c, i) => c.quotes.forEach((q, j) => {
        report.quotes++;
        const text = snapshots.get(q.sourceId); if (text == null) return;
        report.compared++;
        const needle = ev.normalizeForMatch(q.quote);
        const old = needle.length >= 12 && oldContains(ev.normalizeForMatch(text), needle);
        if (old && !q.verified) report.oldTrueNewFalse++;
        if (!old && q.verified) report.flips.push({ file: `${dir}/${f}`, claim: bundle.claims[i].id, usedInDraft: used.has(bundle.claims[i].id), quote: q.quote });
      }));
    }
  }
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`files ${report.files} quotes ${report.quotes} compared ${report.compared} old→new flips ${report.flips.length} (in drafts ${report.flips.filter((x) => x.usedInDraft).length}) regressions ${report.oldTrueNewFalse}`);
  for (const x of report.flips) console.log(`  ${x.file.split('/').slice(-3).join('/')} ${x.claim}${x.usedInDraft ? ' [draft]' : ''}: ${x.quote.slice(0, 90)}`);
})();
