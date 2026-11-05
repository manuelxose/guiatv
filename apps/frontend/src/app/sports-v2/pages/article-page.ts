import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { longStamp } from '../domain/calendar';
import { sv2Link } from '../sports-v2.paths';
import { SportsStore } from '../state/sports-store';
import { Sv2ArticleCardComponent } from '../ui/article-card';
import { Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent } from '../ui/states';
import { breadcrumbs, SPORTS_SITE_URL, sv2Path, useNotFound, useSeo } from './seo';

/** Article detail: byline, date, body and links to the teams, competition and match it covers. */
@Component({
  selector: 'app-sv2-article-page',
  standalone: true,
  imports: [RouterLink, Sv2ArticleCardComponent, Sv2EmptyStateComponent, Sv2ErrorStateComponent, Sv2LoadingSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (store.loadState()) {
      @case ('error') { <app-sv2-error-state (retry)="store.retry()" /> }
      @case ('ready') {
        @if (article(); as a) {
          <nav class="crumbs" aria-label="Ruta de navegación"><a [routerLink]="newsLink">← Noticias</a></nav>
          <article>
            <header>
              <p class="kick">{{ a.kicker }}</p>
              <h1>{{ a.title }}</h1>
              <p class="by">Por {{ a.author }} · <time [attr.datetime]="a.publishedAt">{{ longStamp(a.publishedAt) }}</time></p>
            </header>
            <div class="art" aria-hidden="true" [style.--hue]="a.hue ?? 210">
              @if (a.image; as img) { <img [src]="img.url" alt="" /> }
            </div>
            <p class="lead">{{ a.summary }}</p>
            @for (p of a.body; track $index) { <p>{{ p }}</p> }
            @if (a.canonicalPath) { <p><a [href]="a.canonicalPath">Ver el artículo en Guía TV</a></p> }
            @if (store.isDemo) { <p class="demo" role="note">Artículo ficticio de demostración: no es información real.</p> }
          </article>

          <aside aria-labelledby="links-h">
            <h2 id="links-h">Enlaces relacionados</h2>
            <ul class="links">
              @if (competition(); as c) { <li><a [routerLink]="link('competiciones', c.slug)">{{ c.name }}</a></li> }
              @for (t of teams(); track t.slug) { <li><a [routerLink]="link('equipos', t.slug)">{{ t.name }}</a></li> }
              @if (a.matchSlug && store.match(a.matchSlug)) { <li><a class="match" [routerLink]="link('partido', a.matchSlug)">Ver el partido en Match Center</a></li> }
            </ul>
          </aside>

          @if (more().length) {
            <section aria-labelledby="more-h">
              <h2 id="more-h">Más noticias</h2>
              <div class="grid">@for (n of more(); track n.slug) { <app-sv2-article-card [item]="n" /> }</div>
            </section>
          }
        } @else if (store.resolving()) {
          <app-sv2-loading-skeleton [count]="3" />
        } @else {
          <app-sv2-empty-state title="No encontramos esta noticia" hint="Puede que el enlace sea antiguo." actionLabel="Ver noticias" [actionLink]="newsLink" />
        }
      }
      @default { <app-sv2-loading-skeleton [count]="3" /> }
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-content: start; max-width: 760px; width: 100%; margin: 0 auto; }
    .crumbs a { color: var(--sv2-text-muted); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    .crumbs a:hover { color: var(--sv2-text); }
    article { display: grid; gap: 16px; }
    .kick { margin: 0; font-size: var(--sv2-fs-xs); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sv2-accent); }
    h1 { margin: 4px 0 8px; font-size: 2rem; line-height: 1.15; letter-spacing: -.02em; }
    .by { margin: 0; font-size: var(--sv2-fs-sm); color: var(--sv2-text-muted); }
    .art { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--sv2-r-lg); border: 1px solid var(--sv2-border); background: radial-gradient(120% 140% at 0% 0%, hsl(var(--hue) 55% 34%), hsl(calc(var(--hue) + 40) 40% 14%) 70%); }
    .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    article p { margin: 0; font-size: 1.0625rem; line-height: 1.65; max-width: 68ch; }
    article .lead { font-size: 1.1875rem; font-weight: 600; color: var(--sv2-text); }
    .demo { padding: 10px 14px; border-radius: var(--sv2-r-sm); background: var(--sv2-surface-2); font-size: var(--sv2-fs-sm) !important; color: var(--sv2-text-muted); }
    h2 { margin: 0 0 12px; font-size: var(--sv2-fs-lg); }
    .links { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .links a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: 999px; background: var(--sv2-surface-2); border: 1px solid var(--sv2-border); color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 600; text-decoration: none; }
    .links a:hover { background: var(--sv2-surface-3); }
    .links a.match { background: var(--sv2-accent); border-color: var(--sv2-accent); color: var(--sv2-accent-ink); }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    a:focus-visible { outline: 2px solid var(--sv2-focus); outline-offset: 2px; }
    @media (max-width: 767px) { h1 { font-size: 1.625rem; } }
  `,
})
export class Sv2ArticlePageComponent {
  protected readonly store = inject(SportsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly site = inject(SPORTS_SITE_URL);
  protected readonly newsLink = sv2Link('noticias');
  protected readonly longStamp = longStamp;
  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), { initialValue: this.route.snapshot.paramMap.get('slug') ?? '' });

  protected readonly article = computed(() => this.store.article(this.slug()));
  protected readonly competition = computed(() => (this.article()?.competitionSlug ? this.store.competition(this.article()?.competitionSlug as string) : undefined));
  protected readonly teams = computed(() => (this.article()?.teamSlugs ?? []).flatMap((s) => this.store.team(s) ?? []));
  protected readonly more = computed(() => this.store.news().filter((n) => n.slug !== this.slug()).slice(0, 3));

  constructor() {
    effect(() => {
      if (this.store.loadState() === 'ready' && this.slug()) untracked(() => void this.store.ensureArticle(this.slug()));
    });
    useNotFound(() => this.store.loadState() === 'ready' && !this.store.resolving() && !this.article());
    useSeo(() => {
      const a = this.article();
      if (!a) return { title: 'Noticia' };
      const segments = ['noticias', a.slug];
      const canonicalPath = a.canonicalPath;
      const url = this.site + (canonicalPath ?? sv2Path(segments));
      return {
        title: a.title,
        description: a.summary || undefined,
        segments,
        canonicalPath,
        jsonLd: [
          { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: a.title, datePublished: a.publishedAt, author: { '@type': 'Organization', name: a.author }, mainEntityOfPage: url },
          breadcrumbs(this.site, [['Fútbol', sv2Path()], ['Noticias', sv2Path(['noticias'])], [a.title, canonicalPath ?? sv2Path(segments)]]),
        ],
      };
    });
  }

  protected link(...segments: string[]): string[] {
    return sv2Link(...segments);
  }
}
