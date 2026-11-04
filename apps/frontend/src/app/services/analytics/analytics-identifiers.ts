/**
 * Removal of every analytics identifier this site can create: first-party `gtv_anon_id` / `gtv_session` and the
 * Google Analytics cookies (`_ga`, `_ga_<id>`, `_gid`) on the current host and its parent domains. Tiny and
 * dependency-free so the eager facade can apply a "denied" choice without loading the collector.
 */
export function removeAnalyticsIdentifiers(doc: Document | null = typeof document === 'undefined' ? null : document): void {
  try {
    localStorage.removeItem('gtv_anon_id');
    sessionStorage.removeItem('gtv_session');
  } catch {
    // storage blocked: nothing persisted
  }
  if (!doc) return;
  deleteGaCookies(doc);
}

export function deleteGaCookies(doc: Document): void {
  let raw = '';
  try {
    raw = doc.cookie || '';
  } catch {
    return;
  }
  const host = doc.location?.hostname || '';
  const parts = host.split('.');
  const domains = new Set(['', ...parts.map((_, i) => parts.slice(i).join('.')).filter((d) => d.includes('.'))]);
  for (const entry of raw.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (!name || !(name === '_ga' || name.startsWith('_ga_') || name === '_gid')) continue;
    for (const domain of domains) {
      doc.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=.${domain}` : ''}`;
    }
  }
}
