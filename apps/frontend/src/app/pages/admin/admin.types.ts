export type AdminGroupId =
  | 'overview'
  | 'analytics'
  | 'ai'
  | 'content'
  | 'monetization'
  | 'schedules'
  | 'futbol'
  | 'users'
  | 'operations'
  | 'system';

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
