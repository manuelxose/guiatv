import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/**
 * One consistent semantic status vocabulary for Admin (spec §29): each
 * status maps to exactly one tone. Never color alone — label text always
 * renders alongside the dot, and an icon reinforces it for anyone relying
 * on shape rather than color.
 */
export type AdminStatusTone = 'positive' | 'warning' | 'critical' | 'neutral' | 'unknown';

const STATUS_TONE: Record<string, AdminStatusTone> = {
  healthy: 'positive',
  current: 'positive',
  active: 'positive',
  configured: 'positive',
  completed: 'positive',
  resolved: 'positive',
  warning: 'warning',
  stale: 'warning',
  reviewing: 'warning',
  pending: 'warning',
  degraded: 'warning',
  critical: 'critical',
  failed: 'critical',
  missing: 'critical',
  unavailable: 'critical',
  unconfigured: 'critical',
  dismissed: 'critical',
  queued: 'neutral',
  running: 'neutral',
  info: 'neutral',
  unknown: 'unknown',
};

// Mapped to the Spotify accent tokens (design-tokens.scss) instead of raw
// Tailwind palette hues, so status colors stay in lockstep with the rest of
// the reskin across both themes.
const TONE_CLASSES: Record<AdminStatusTone, string> = {
  // Text uses the text-safe accent aliases (WCAG 1.4.3): the raw accents measure 1.65–2.80:1 on the
  // light admin surfaces; borders and fills keep the original tokens.
  positive: 'border-[var(--accent-discover)]/40 text-[var(--accent-discover-text)] bg-[var(--accent-discover)]/10',
  warning: 'border-[var(--spotify-warning)]/40 text-[var(--spotify-warning-text)] bg-[var(--spotify-warning)]/10',
  critical: 'border-[var(--spotify-negative)]/40 text-[var(--spotify-negative-text)] bg-[var(--spotify-negative)]/10',
  neutral: 'border-[var(--accent-streaming)]/40 text-[var(--accent-streaming-text)] bg-[var(--accent-streaming)]/10',
  unknown: 'border-[var(--portal-border-strong)] text-[var(--portal-text-soft)] bg-[var(--portal-surface-strong)]',
};

@Component({
  selector: 'app-admin-status-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-status-badge.component.html',
  styleUrls: ['./admin-status-badge.component.scss'],
})
export class AdminStatusBadgeComponent {
  /** Any raw status string from a backend payload — case-insensitive. */
  @Input() status = 'unknown';
  /** Override the displayed text; defaults to a capitalized `status`. */
  @Input() label?: string;

  get tone(): AdminStatusTone {
    return STATUS_TONE[(this.status || '').toLowerCase()] || 'unknown';
  }

  get toneClasses(): string {
    return TONE_CLASSES[this.tone];
  }

  get displayLabel(): string {
    if (this.label) return this.label;
    const raw = this.status || 'unknown';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
}
