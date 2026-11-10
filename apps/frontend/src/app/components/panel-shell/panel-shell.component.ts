import { DOCUMENT, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, PLATFORM_ID, TemplateRef, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FooterComponent } from '../footer/footer.component';
import { UnifiedTopNavComponent } from '../unified-top-nav/unified-top-nav.component';

/**
 * Three-panel page frame shared by every section, with the football layout's metrics:
 * header on top, section menu on the left (264px, 72px collapsed), content in the middle,
 * context panel on the right (360px) from 1200px, a drawer below that.
 *
 * Slots: [panelSide] the section menu, default content the page, [panelContext] the right panel,
 * [panelAfterFooter] small print below the footer. `searchTemplate` puts a section search in the header.
 *
 * shortcut: the grid rules are copied from sports-v2/shell/app-shell.scss; once every section
 * uses this frame, make the football shell use it too and delete the copy.
 */
@Component({
  selector: 'app-panel-shell',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, UnifiedTopNavComponent, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-shell.component.html',
  styleUrl: './panel-shell.component.scss',
})
export class PanelShellComponent {
  /** Accessible names of the side menu and of the context panel (e.g. "Inicio", "Ahora en emisión"). */
  readonly sideLabel = input.required<string>();
  readonly contextLabel = input.required<string>();
  /** Below desktop the context panel is a drawer; pages can open it (e.g. when an item is selected). */
  readonly contextOpen = model(false);
  /** A section's own header search instead of the global one (a template: slots cannot be re-projected into the header). */
  readonly searchTemplate = input<TemplateRef<unknown> | null>(null);
  /** No right panel (e.g. a full-page match view): the content takes its column. */
  readonly contextHidden = input(false);
  readonly collapsed = signal(false);

  constructor() {
    // app.component docks the assistant over the context column while a panel page is shown.
    const body = inject(DOCUMENT).body;
    body.classList.add('has-panel-shell');
    inject(DestroyRef).onDestroy(() => body.classList.remove('has-panel-shell'));

    // The page scrolls inside .main, not the window, so the router's anchor scrolling cannot reach it:
    // on a #fragment, wait for the target to render (content loads async) and scroll it into view.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const doc = inject(DOCUMENT);
      inject(ActivatedRoute)
        .fragment.pipe(takeUntilDestroyed())
        .subscribe((id) => {
          if (!id) return;
          let tries = 0;
          const seek = () => {
            const target = doc.getElementById(id);
            if (target) target.scrollIntoView({ block: 'start' });
            else if (++tries < 25) setTimeout(seek, 120);
          };
          setTimeout(seek);
        });
    }
  }

  @HostListener('document:keydown.escape')
  closeContext(): void {
    this.contextOpen.set(false);
  }
}
