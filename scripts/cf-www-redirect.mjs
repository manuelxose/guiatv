// M09-C: one-hop redirect www (http or https) -> https://guiaprogramaciontv.com, as a Cloudflare Single Redirect rule.
// usage: node cf-www-redirect.mjs status|apply|rollback   (token from ~/.guiatv/cloudflare.env, never printed)
// ACME http-01 paths are excluded so certificate renewal on www keeps reaching the origin.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ZONE = 'guiaprogramaciontv.com';
const REF = 'm09c_www_to_apex';
const PHASE = 'http_request_dynamic_redirect';
const RULE = {
  ref: REF,
  description: 'M09-C: www -> https apex in one hop (keeps path and query; ACME excluded)',
  expression: '(http.host eq "www.guiaprogramaciontv.com" and not starts_with(http.request.uri.path, "/.well-known/acme-challenge/"))',
  action: 'redirect',
  action_parameters: { from_value: { status_code: 301, preserve_query_string: true, target_url: { expression: 'concat("https://guiaprogramaciontv.com", http.request.uri.path)' } } },
};

const env = readFileSync(join(homedir(), '.guiatv', 'cloudflare.env'), 'utf8');
const token = (env.match(/^CLOUDFLARE_API_TOKEN=(.+)$/m) || [])[1]?.trim();
if (!token) { console.error('CLOUDFLARE_API_TOKEN missing in ~/.guiatv/cloudflare.env'); process.exit(2); }
const cf = async (method, path, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: j.success === true, result: j.result, errors: (j.errors || []).map((e) => `${e.code} ${e.message}`) };
};

const cmd = process.argv[2] || 'status';
const zones = await cf('GET', `/zones?name=${ZONE}`);
if (!zones.ok || !zones.result?.length) { console.error('zone lookup failed', zones.status, zones.errors); process.exit(1); }
const zoneId = zones.result[0].id;
const entry = await cf('GET', `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
const rules = entry.ok ? entry.result.rules || [] : [];
const mine = rules.find((r) => r.ref === REF);
console.log(`zone ok; ${PHASE}: ${entry.ok ? `${rules.length} rule(s)` : `no entrypoint (${entry.status})`}; m09c rule: ${mine ? `present (${mine.id}, enabled=${mine.enabled})` : 'absent'}`);
for (const r of rules) console.log(`  - ${r.ref || r.id} enabled=${r.enabled} ${r.expression}`);

if (cmd === 'apply') {
  if (mine) { console.log('nothing to do'); process.exit(0); }
  const keep = rules.map(({ id, version, last_updated, ...r }) => r);
  const res = await cf('PUT', `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`, { rules: [...keep, RULE] });
  console.log(res.ok ? 'applied' : `apply failed ${res.status} ${res.errors.join('; ')}`);
  process.exit(res.ok ? 0 : 1);
}
if (cmd === 'rollback') {
  if (!mine) { console.log('nothing to roll back'); process.exit(0); }
  const res = await cf('DELETE', `/zones/${zoneId}/rulesets/${entry.result.id}/rules/${mine.id}`);
  console.log(res.ok ? 'rolled back' : `rollback failed ${res.status} ${res.errors.join('; ')}`);
  process.exit(res.ok ? 0 : 1);
}
