import { networkInterfaces } from 'node:os';
import { IpRule, canonicalIp, ipMatchesRule, parseIpRule } from '../../../infrastructure/analytics/ipPrivacy';

export interface ExclusionEntry {
  id?: string;
  value: string;
  label?: string;
  createdAt?: Date;
  createdBy?: string;
  /** manual = admin panel; env = ANALYTICS_EXCLUDED_IPS; server = this host's own addresses; loopback. */
  source: 'manual' | 'env' | 'server' | 'loopback';
}

export interface ExclusionStore {
  list(): Promise<Array<{ id: string; value: string; label?: string; createdAt?: Date; createdBy?: string }>>;
  add(entry: { value: string; label?: string; createdBy?: string }): Promise<{ id: string }>;
  remove(id: string): Promise<boolean>;
}

const REFRESH_MS = 30_000;
const MAX_MANUAL = 500;

/**
 * Which client addresses analytics never counts. Decided at ingestion on the transient full address, so a rule
 * applies to traffic from the moment it exists (stored data keeps only a truncated prefix and cannot be
 * re-evaluated). Sources:
 *   loopback (127.0.0.1, ::1) · this server's own interface addresses (its public IP on a VPS) ·
 *   ANALYTICS_EXCLUDED_IPS (comma-separated, addresses or CIDR) · rules managed in the admin panel (Mongo).
 * The rule set is held in memory and refreshed every 30 s (and immediately after an admin change), so the
 * ingestion loop never waits on the database.
 */
export class AnalyticsExclusionService {
  private manual: Array<ExclusionEntry & { rule: IpRule }> = [];
  private lastLoad = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly store: ExclusionStore,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly interfaces: () => ReturnType<typeof networkInterfaces> = networkInterfaces,
    private readonly now: () => number = Date.now
  ) {}

  /** Built-in rules (not editable from the panel). */
  builtIn(): Array<ExclusionEntry & { rule: IpRule }> {
    const out: Array<ExclusionEntry & { rule: IpRule }> = [];
    const push = (value: string, source: ExclusionEntry['source'], label: string) => {
      const rule = parseIpRule(value);
      if (rule && !out.some((entry) => entry.value === rule.value)) out.push({ value: rule.value, label, source, rule });
    };
    push('127.0.0.1', 'loopback', 'Este servidor (loopback)');
    push('::1', 'loopback', 'Este servidor (loopback IPv6)');
    for (const addresses of Object.values(this.interfaces() || {})) {
      for (const address of addresses || []) {
        if (address.internal || (address.family === 'IPv6' && /^fe80:/i.test(address.address))) continue;
        push(address.address, 'server', 'Dirección propia del servidor');
      }
    }
    for (const value of (this.env.ANALYTICS_EXCLUDED_IPS || '').split(',').map((item) => item.trim()).filter(Boolean)) {
      push(value, 'env', 'ANALYTICS_EXCLUDED_IPS');
    }
    return out;
  }

  async list(): Promise<ExclusionEntry[]> {
    await this.refresh(true);
    return [...this.builtIn(), ...this.manual].map(({ rule: _rule, ...entry }) => entry);
  }

  /** Synchronous check for the ingestion loop; triggers a background refresh when the cache is stale. */
  isExcluded(rawIp: string): boolean {
    const ip = canonicalIp(rawIp);
    if (!ip) return false;
    if (this.now() - this.lastLoad > REFRESH_MS) void this.refresh(false);
    return [...this.builtIn(), ...this.manual].some((entry) => ipMatchesRule(ip, entry.rule));
  }

  matching(rawIp: string): ExclusionEntry[] {
    const ip = canonicalIp(rawIp);
    return [...this.builtIn(), ...this.manual].filter((entry) => ip && ipMatchesRule(ip, entry.rule)).map(({ rule: _rule, ...entry }) => entry);
  }

  async add(value: string, label: string | undefined, createdBy: string | undefined): Promise<ExclusionEntry> {
    const rule = parseIpRule(value);
    if (!rule) throw new ExclusionError('Dirección IP o rango CIDR no válido (ej.: 203.0.113.7, 203.0.113.0/24, 2001:db8::/48).');
    if (rule.prefix < (rule.version === 4 ? 8 : 16)) throw new ExclusionError('El rango es demasiado amplio (mínimo /8 en IPv4 y /16 en IPv6).');
    await this.refresh(true);
    if (this.manual.some((entry) => entry.value === rule.value)) throw new ExclusionError('Esa dirección ya está excluida.');
    if (this.manual.length >= MAX_MANUAL) throw new ExclusionError(`Máximo ${MAX_MANUAL} exclusiones.`);
    const cleanLabel = label?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || undefined;
    const { id } = await this.store.add({ value: rule.value, label: cleanLabel, createdBy: createdBy?.slice(0, 80) });
    await this.refresh(true, true);
    return { id, value: rule.value, label: cleanLabel, source: 'manual' };
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.store.remove(id);
    await this.refresh(true, true);
    return removed;
  }

  private async refresh(wait: boolean, force = false): Promise<void> {
    if (!force && this.now() - this.lastLoad <= REFRESH_MS) return;
    if (!this.loading) {
      this.loading = this.store.list()
        .then((rows) => {
          this.manual = rows.flatMap((row) => {
            const rule = parseIpRule(row.value);
            return rule ? [{ id: row.id, value: rule.value, label: row.label, createdAt: row.createdAt, createdBy: row.createdBy, source: 'manual' as const, rule }] : [];
          });
          this.lastLoad = this.now();
        })
        .catch(() => {
          // Keep the previous rules; retry on the next check.
          this.lastLoad = this.now() - REFRESH_MS + 5_000;
        })
        .finally(() => { this.loading = null; });
    }
    const pending = this.loading;
    if (wait && pending) await pending;
  }
}

export class ExclusionError extends Error {}
