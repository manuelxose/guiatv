export type AdminGroupId =
  | 'overview'
  | 'analytics'
  | 'ai'
  | 'content'
  | 'monetization'
  | 'schedules'
  | 'users'
  | 'operations'
  | 'system'
  | 'seo';

export interface AdminNavItem {
  id: string;
  label: string;
  description?: string;
  badge?: string;
}

export interface AdminNavGroup {
  id: AdminGroupId;
  label: string;
  /** SVG <path d="..."> data (viewBox 0 0 24 24, stroke-based) — never a text monogram. */
  icon: string;
  items: AdminNavItem[];
}

/**
 * A navigation target for KPI drill-down and deep links. Beyond the section, it
 * can carry the filters that the destination view must apply on arrival, so a
 * number is never just a number: it opens the records that compose it.
 */
export interface AdminNavTarget {
  group: AdminGroupId;
  item: string;
  /** Editorial sub-tab (pipeline, topics, review, runs, ledger, generate, settings, search). */
  tab?: string;
  /** Ledger/job state filter (a `EditorialLedgerState`). */
  state?: string;
  /** Free-text search applied to the destination view. */
  q?: string;
  /** Pagination offset (skip) applied to the destination view. */
  skip?: number;
}
