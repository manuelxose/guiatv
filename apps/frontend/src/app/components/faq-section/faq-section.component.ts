import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { generateFAQSchema, serializeJsonLd } from '../../utils/utils';

export interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-faq-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section *ngIf="items.length" class="mt-10" [attr.itemscope]="structuredData ? '' : null" [attr.itemtype]="structuredData ? 'https://schema.org/FAQPage' : null">
      <h2 class="text-lg font-bold text-[var(--portal-text)] mb-4">{{ heading }}</h2>
      <div class="space-y-2">
        <details
          *ngFor="let item of items; let i = index"
          class="group border border-[var(--portal-border)] rounded-lg bg-[var(--portal-surface-soft)]"
          [attr.itemscope]="structuredData ? '' : null" [attr.itemprop]="structuredData ? 'mainEntity' : null" [attr.itemtype]="structuredData ? 'https://schema.org/Question' : null"
        >
          <summary
            class="flex items-center justify-between gap-4 cursor-pointer select-none px-4 py-3 text-sm font-medium text-[var(--portal-text-soft)] hover:text-[var(--portal-text)] transition-colors min-h-[44px]"
          >
            <span [attr.itemprop]="structuredData ? 'name' : null">{{ item.question }}</span>
            <svg
              class="w-4 h-4 shrink-0 text-[var(--portal-text-muted)] group-open:rotate-180 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div class="px-4 pb-4 text-sm text-[var(--portal-text-muted)] leading-relaxed"
               [attr.itemscope]="structuredData ? '' : null" [attr.itemprop]="structuredData ? 'acceptedAnswer' : null" [attr.itemtype]="structuredData ? 'https://schema.org/Answer' : null">
            <p [attr.itemprop]="structuredData ? 'text' : null">{{ item.answer }}</p>
          </div>
        </details>
      </div>
      <div [innerHTML]="safeLdJson"></div>
    </section>
  `,
})
export class FaqSectionComponent implements OnChanges {
  @Input() heading = 'Preguntas frecuentes';
  @Input() items: FaqItem[] = [];
  @Input() structuredData = true;
  safeLdJson: SafeHtml = '';

  constructor(private readonly sanitizer: DomSanitizer) {}

  ngOnChanges(): void {
    if (!this.structuredData || !this.items.length) {
      this.safeLdJson = '';
      return;
    }
    const schema = generateFAQSchema(this.items);
    this.safeLdJson = this.sanitizer.bypassSecurityTrustHtml(
      `<script type="application/ld+json">${serializeJsonLd(schema)}</script>`
    );
  }
}
