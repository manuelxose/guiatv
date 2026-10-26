import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TvReadChannelSummaryDTO } from '../../api/models';
import { formatMadridHM } from '../../utils/madrid-time';
import { computeProgress } from '../../utils/tv-normalizers';
import { channelCanonicalPath } from '../../config/route-map';

@Component({
  selector: 'app-channel-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './channel-card.component.html',
  styleUrl: './channel-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelCardComponent {
  protected readonly channelCanonicalPath = channelCanonicalPath;
  readonly entry = input.required<TvReadChannelSummaryDTO>();
  readonly headingLevel = input<2 | 3>(2);

  formatTime(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatMadridHM(date);
  }

  formatTimeRange(start?: string, end?: string): string {
    const startLabel = this.formatTime(start);
    const endLabel = this.formatTime(end);
    if (!startLabel && !endLabel) return '';
    return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
  }

  currentProgress(): number {
    const current = this.entry().current;
    if (!current) return 0;
    return computeProgress(current.airing.start, current.airing.end);
  }

  accessLabel(): string {
    const access = this.entry().channel.access;
    if (access === 'free') return 'En abierto';
    if (access === 'pay') return 'De pago';
    return 'Acceso sin confirmar';
  }

  logoFailed = false;

  handleLogoError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (image) image.hidden = true;
    this.logoFailed = true;
  }
}
