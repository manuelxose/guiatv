#!/usr/bin/env node
// Publishes editorial drafts (docs/seo/editorial-drafts/publish.json) through the API's own gate:
// save as draft, then POST /:id/approve with the HUMAN review key. This is meant to be run by the person
// named as reviewer after reading the drafts; it is the approval act, so it is not automated elsewhere.
// Secrets come from the environment (ANALYTICS_ADMIN_KEY, EDITORIAL_REVIEW_KEY) and are never printed.
// Usage (on the server, where /etc/guiatv/api.env holds the keys):
//   set -a; . /etc/guiatv/api.env; set +a
//   node scripts/editorial-publish.mjs --reviewer "Arturo Baroja" [--base http://127.0.0.1:4000] [--only slug] [--dry-run]
//     [--acknowledge unverified-claims,near-duplicate]   (a refused approval lists the findings to read first)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { marked } from 'marked';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const dryRun = process.argv.includes('--dry-run');
const reviewer = arg('reviewer');
const base = arg('base', 'http://127.0.0.1:4000').replace(/\/$/, '');
const dir = resolve(arg('dir', 'docs/seo/editorial-drafts'));
const only = arg('only');
// Judgement findings the reviewer has read and accepts (e.g. unverified-claims,near-duplicate); the API refuses approval otherwise.
const acknowledge = String(arg('acknowledge', '')).split(',').map((s) => s.trim()).filter(Boolean);
if (!reviewer) { console.error('--reviewer is required (a name from EDITORIAL_HUMAN_REVIEWERS)'); process.exit(2); }

function toHtml(md, reviewerName) {
  let body = md.replace(/^---[\s\S]*?---\s*/, '').replace(/^# .*\n/, '');
  body = body.split(/^## Notas para el revisor/m)[0].trim();
  const disclosure = `<p><em>Elaborado con asistencia de IA a partir de las fuentes oficiales citadas y verificado el 19 de octubre de 2026. Revisión editorial: ${reviewerName}. Consulta nuestra <a href="/politica-editorial">política editorial</a>.</em></p>`;
  return `<div class="editorial-body">${marked.parse(body)}${disclosure}</div>`;
}

const entries = JSON.parse(readFileSync(resolve(dir, 'publish.json'), 'utf8')).filter((e) => !only || e.slug === only);
const headers = { 'content-type': 'application/json', 'x-admin-key': process.env.ANALYTICS_ADMIN_KEY || '' };
const call = async (method, path, body, extra = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

for (const e of entries) {
  const content = toHtml(readFileSync(resolve(dir, e.file), 'utf8'), reviewer);
  const payload = {
    title: e.title, slug: e.slug, status: 'draft', origin: 'ai-assisted', excerpt: e.excerpt, content,
    categories: e.categories, contentType: e.contentType || 'guide', evergreen: true, targetQuery: e.targetQuery, primaryIntent: e.targetQuery,
    relatedPlatformKeys: e.relatedPlatformKeys, relatedRouteKeys: e.relatedRouteKeys,
    metaTitle: e.metaTitle, metaDescription: e.metaDescription, keywords: e.keywords,
    canonicalUrl: `/guias/${e.slug}`, authorName: 'Equipo editorial Guía TV', authorId: 'guiatv-editorial',
  };
  if (dryRun) {
    const external = (content.match(/href="https?:\/\/(?!(?:www\.)?guiaprogramaciontv)/g) || []).length;
    console.log(`[dry-run] ${e.slug}: ${content.length} chars, ${external} external links`);
    continue;
  }
  const found = await call('GET', `/v2/blog?slug=${encodeURIComponent(e.slug)}&status=all`);
  const id = found[0]?.id;
  const saved = id ? await call('PUT', `/v2/blog/${id}`, payload) : await call('POST', '/v2/blog', payload);
  const postId = saved.data?.post?.id || id;
  const approved = await call('POST', `/v2/blog/${postId}/approve`, { reviewer, acknowledge, notes: 'Drafted and checked against primary sources by Claude (AI); approved by the named reviewer.' },
    { 'x-editorial-review-key': process.env.EDITORIAL_REVIEW_KEY || '', 'x-editorial-reviewer': reviewer });
  console.log(`published ${e.slug} (${postId}) reviewer=${reviewer}`);
  for (const f of approved.data?.qualityFindings ?? []) console.log(`  ${f.severity} ${f.code}: ${f.message}`);
}
