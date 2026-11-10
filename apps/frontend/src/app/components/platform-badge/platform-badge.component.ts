import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';

@Component({
  selector: 'app-platform-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-badge.component.html',
  styleUrl: './platform-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformBadgeComponent {
  @Input({ required: true }) label = '';
  @Input() color = '#334155';
  @Input() logoUrl = '';

  /** Set when the logo URL 404s: the badge then falls back to initials
   * instead of rendering a broken image. */
  logoFailed = false;

  get toneClass(): string {
    return `platform-badge--${resolveBadgeTone(this.color, this.label)}`;
  }

  get resolvedLogoUrl(): string {
    return resolvePlatformLogoUrl(this.label, this.logoUrl);
  }

  get hasLogo(): boolean {
    return !this.logoFailed && Boolean(this.resolvedLogoUrl);
  }

  onLogoError(): void {
    this.logoFailed = true;
  }

  get initials(): string {
    const normalized = String(this.label || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');

    return normalized || '?';
  }
}


// Mirrors the 7 tone-variant colors hardcoded in platform-badge.component.scss
// (.platform-badge--red/blue/cyan/violet/green/amber/slate) — keep both in
// sync. Exported so other components that need the same platform→color
// mapping for interactive UI (e.g. clickable chips, which this read-only
// badge component doesn't support) can reuse the color source without
// duplicating a second brand-hex list.
export const PLATFORM_BADGE_TONE_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  slate: { bg: 'rgba(100, 116, 139, 0.08)', border: 'rgba(100, 116, 139, 0.3)', color: '#475569' },
  red: { bg: 'rgba(220, 38, 38, 0.08)', border: 'rgba(220, 38, 38, 0.3)', color: '#a91616' },
  blue: { bg: 'rgba(37, 99, 235, 0.08)', border: 'rgba(37, 99, 235, 0.3)', color: '#1746b3' },
  cyan: { bg: 'rgba(6, 182, 212, 0.08)', border: 'rgba(6, 182, 212, 0.3)', color: '#075f78' },
  violet: { bg: 'rgba(124, 58, 237, 0.08)', border: 'rgba(124, 58, 237, 0.3)', color: '#6630c7' },
  green: { bg: 'rgba(22, 163, 74, 0.08)', border: 'rgba(22, 163, 74, 0.3)', color: '#0d7431' },
  amber: { bg: 'rgba(217, 119, 6, 0.08)', border: 'rgba(217, 119, 6, 0.3)', color: '#965105' },
};

export function resolveBadgeTone(color: string, label: string): string {
  const safeColor = String(color || '').toLowerCase();
  const safeLabel = String(label || '').toLowerCase();

  if (
    safeLabel.includes('netflix') ||
    safeLabel.includes('rakuten') ||
    safeLabel.includes('atresplayer') ||
    safeColor.includes('e50914') ||
    safeColor.includes('ef4444') ||
    safeColor.includes('dc2626')
  ) {
    return 'red';
  }

  if (
    safeLabel.includes('prime') ||
    safeLabel.includes('max') ||
    safeLabel.includes('hbo') ||
    safeLabel.includes('movistar') ||
    safeColor.includes('3b82f6') ||
    safeColor.includes('2563eb') ||
    safeColor.includes('1d4ed8')
  ) {
    return 'blue';
  }

  if (
    safeLabel.includes('disney') ||
    safeLabel.includes('skyshowtime') ||
    safeColor.includes('06b6d4') ||
    safeColor.includes('0891b2')
  ) {
    return 'cyan';
  }

  if (
    safeLabel.includes('filmin') ||
    safeLabel.includes('apple') ||
    safeColor.includes('8b5cf6') ||
    safeColor.includes('7c3aed')
  ) {
    return 'violet';
  }

  if (
    safeLabel.includes('pluto') ||
    safeLabel.includes('rtve') ||
    safeLabel.includes('gratis') ||
    safeColor.includes('22c55e') ||
    safeColor.includes('16a34a')
  ) {
    return 'green';
  }

  if (
    safeLabel.includes('mubi') ||
    safeLabel.includes('starz') ||
    safeColor.includes('f59e0b') ||
    safeColor.includes('d97706')
  ) {
    return 'amber';
  }

  return 'slate';
}
