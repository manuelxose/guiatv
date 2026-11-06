import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Sv2IconComponent } from './icon';

/** Real competition logo when the provider supplies one; neutral trophy icon otherwise or if the image fails. */
@Component({
  selector: 'app-sv2-competition-logo',
  standalone: true,
  imports: [Sv2IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url() && !failed()) {
      <img [src]="url()" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" (error)="failed.set(true)" />
    } @else {
      <app-sv2-icon name="trophy" />
    }
  `,
  styles: `
    :host { display: grid; place-items: center; width: 100%; height: 100%; }
    img { width: 100%; height: 100%; object-fit: contain; padding: 4px; box-sizing: border-box; }
  `,
})
export class Sv2CompetitionLogoComponent {
  readonly url = input<string | undefined>();
  protected readonly failed = signal(false);
}
