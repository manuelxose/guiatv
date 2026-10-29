import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { environment } from '../../../../../environments/environment';
import { FALLBACK_CATALOG_PLATFORMS } from '../../../../data/catalog-platforms.data';
import {
  AdminBlogAffiliatePlacementMode,
  AdminBlogCategory,
  AdminBlogContentType,
  AdminBlogCreatePayload,
  AdminBlogFaqItem,
  AdminBlogPost,
  AdminBlogService,
} from '../../../../services/admin-blog.service';
import { AffiliateService } from '../../../../services/affiliate.service';
import { AffiliateResolvedOffer } from '../../../../interfaces/affiliate.interface';
import { AffiliateCTAComponent } from '../../../../components/affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from '../../../../components/affiliate-disclosure/affiliate-disclosure.component';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import {
  calculateReadingTime,
  generateExcerpt,
  slugify,
  stripHtml,
  truncateTitle,
} from '../../../../utils/utils';

type BlogStatusFilter = 'all' | 'draft' | 'publish';
type BlogTypeFilter = 'all' | AdminBlogContentType;
export type BlogStudioTab = 'posts' | 'content' | 'seo';

interface BlogRouteOption {
  key: string;
  label: string;
  description: string;
}

@Component({
  selector: 'app-admin-blog-section',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AffiliateCTAComponent, AffiliateDisclosureComponent, AdminConfirmDialogComponent],
  templateUrl: './admin-blog-section.component.html',
  styleUrls: ['./admin-blog-section.component.scss'],
})
export class AdminBlogSectionComponent implements OnInit {
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  public blogPosts: AdminBlogPost[] = [];
  public blogCategories: AdminBlogCategory[] = [];
  public blogLoading = false;
  public blogError: string | null = null;
  public blogLastLoaded: Date | null = null;
  public blogSaving = false;
  public blogDeletingId: string | null = null;
  public blogSaveError: string | null = null;
  public blogSaveSuccess: string | null = null;
  public selectedBlogPostId: string | null = null;
  public confirmDeletePostOpen = false;
  public pendingDeletePost: AdminBlogPost | null = null;

  public activeBlogTab: BlogStudioTab = 'posts';
  public blogView: 'table' | 'cards' = 'table';
  public readonly blogTabs: Array<{ id: BlogStudioTab; label: string }> = [
    { id: 'posts', label: 'Artículos' },
    { id: 'content', label: 'Contenido' },
    { id: 'seo', label: 'SEO y monetización' },
  ];
  public blogStatusFilter: BlogStatusFilter = 'all';
  public blogTypeFilter: BlogTypeFilter = 'all';
  public blogCategoryFilter = 'all';
  public blogSearchTerm = '';
  public readonly blogStatusOptions = [
    { id: 'all', label: 'Todos' },
    { id: 'draft', label: 'Borradores' },
    { id: 'publish', label: 'Publicados' },
  ];
  public readonly blogTypeOptions = [
    { id: 'all', label: 'Todos' },
    { id: 'guide', label: 'Guias' },
    { id: 'ranking', label: 'Rankings' },
    { id: 'trend', label: 'Tendencias' },
  ] as const;
  public readonly routeOptions: BlogRouteOption[] = [
    { key: 'platforms', label: 'Plataformas', description: 'CTA o rail al catalogo filtrado por plataformas.' },
    { key: 'guide', label: 'Guia TV', description: 'Acceso a la guia de canales y a emisiones en curso.' },
    { key: 'explore', label: 'Que ver hoy', description: 'Descubrimiento rapido orientado a usuarios de la app.' },
    { key: 'stats', label: 'Tendencias', description: 'Bloque de senales y contenido en tendencia.' },
    { key: 'comparison', label: 'Comparador', description: 'CTA directo al comparador de plataformas.' },
  ];
  public readonly platformOptions = FALLBACK_CATALOG_PLATFORMS.map((platform) => ({
    key: platform.key,
    label: platform.name,
  }));

  /** AffiliateOffer.category is intentionally open-ended (see AffiliateOffer.ts) — this is a
   * curated shortlist for the checkbox UI, not an allowlist the backend enforces. */
  public readonly affiliateCategoryOptions = [
    { key: 'streaming', label: 'Streaming' },
    { key: 'smart-tv', label: 'Smart TV' },
    { key: 'device', label: 'Dispositivos / sticks' },
    { key: 'ticketing', label: 'Entradas' },
    { key: 'event', label: 'Eventos' },
    { key: 'retail', label: 'Retail' },
  ];
  public readonly affiliatePlacementModeOptions: Array<{ id: AdminBlogAffiliatePlacementMode; label: string; description: string }> = [
    { id: 'auto', label: 'Automático', description: 'Resuelve ofertas segun plataformas, categorias y merchants relacionados.' },
    { id: 'manual', label: 'Manual', description: 'Solo muestra las ofertas fijadas abajo; nunca resuelve automaticamente.' },
    { id: 'off', label: 'Desactivado', description: 'Sin bloque de monetizacion en este articulo.' },
  ];

  public readonly seoTitleMax = 60;
  public readonly seoDescriptionMax = 160;
  public blogForm: FormGroup;
  public readonly siteUrl = environment.SITE_URL;

  public affiliatePreviewOffers: AffiliateResolvedOffer[] = [];
  public affiliatePreviewLoading = false;
  public affiliatePreviewError: string | null = null;
  public affiliatePreviewRequested = false;

  constructor(
    private readonly blogService: AdminBlogService,
    private readonly affiliateService: AffiliateService,
    private readonly fb: FormBuilder
  ) {
    this.blogForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(6)]],
      slug: [''],
      status: ['draft'],
      origin: ['human'],
      authorName: ['', Validators.required],
      authorId: ['', Validators.required],
      contentType: ['guide'],
      featured: [false],
      evergreen: [true],
      primaryIntent: [''],
      targetQuery: [''],
      excerpt: [''],
      content: [''],
      categories: [''],
      relatedPlatformKeys: [[] as string[]],
      relatedRouteKeys: [[] as string[]],
      faqItems: [''],
      affiliatePlacementMode: ['auto' as AdminBlogAffiliatePlacementMode],
      relatedOfferCategories: [[] as string[]],
      relatedMerchantKeys: [''],
      manualAffiliateOfferIds: [''],
      coverImage: [''],
      metaTitle: [''],
      metaDescription: [''],
      keywords: [''],
      ogImage: [''],
      canonicalUrl: [''],
      publishedAt: [''],
    });
  }

  ngOnInit(): void {
    this.loadBlogCategories();
    this.loadBlogPosts(true);
  }

  get isEditingBlogPost(): boolean {
    return Boolean(this.selectedBlogPostId);
  }

  get blogPreviewSlug(): string {
    return slugify(this.getTrimmedValue('slug') || this.blogTitleValue);
  }

  get blogPreviewTitle(): string {
    const title = this.getTrimmedValue('metaTitle') || this.blogTitleValue;
    return truncateTitle(title || 'Articulo editorial', this.seoTitleMax);
  }

  get blogPreviewDescription(): string {
    const content = this.getRawTextValue('content');
    const excerpt =
      this.getRawTextValue('metaDescription') ||
      this.getRawTextValue('excerpt') ||
      generateExcerpt(content, this.seoDescriptionMax);
    return truncateTitle(excerpt, this.seoDescriptionMax);
  }

  get blogPreviewUrl(): string {
    const slug = this.blogPreviewSlug || 'nuevo-articulo';
    return `${this.siteUrl}/guias/${slug}`;
  }

  get blogTitleValue(): string {
    return this.getTrimmedValue('title');
  }

  get blogSeoTitleLength(): number {
    return (this.getTrimmedValue('metaTitle') || this.blogTitleValue).length;
  }

  get blogSeoDescriptionLength(): number {
    return this.blogPreviewDescription.length;
  }

  get blogWordCount(): number {
    const text = stripHtml(this.getRawTextValue('content')).trim();
    return text ? text.split(/\s+/).length : 0;
  }

  get blogReadingTime(): number {
    return calculateReadingTime(this.getRawTextValue('content'));
  }

  get affiliatePlacementModeDescription(): string {
    const current = this.getTrimmedValue('affiliatePlacementMode');
    return this.affiliatePlacementModeOptions.find((mode) => mode.id === current)?.description || '';
  }

  setBlogTab(tab: BlogStudioTab): void {
    this.activeBlogTab = tab;
  }

  startNewDraft(): void {
    this.resetBlogForm(true);
    this.activeBlogTab = 'content';
  }

  onBlogSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.blogSearchTerm = target?.value || '';
  }

  setBlogStatus(status: BlogStatusFilter): void {
    this.blogStatusFilter = status;
    this.loadBlogPosts(true);
  }

  setBlogType(type: BlogTypeFilter): void {
    this.blogTypeFilter = type;
    this.loadBlogPosts(true);
  }

  setBlogCategory(slug: string): void {
    this.blogCategoryFilter = slug;
    this.loadBlogPosts(true);
  }

  applyBlogFilters(): void {
    this.loadBlogPosts(true);
  }

  refreshBlog(): void {
    this.loadBlogCategories();
    this.loadBlogPosts(true);
  }

  submitBlogPost(): void {
    if (this.blogSaving) return;

    if (this.blogForm.invalid) {
      this.blogForm.markAllAsTouched();
      this.blogSaveError = 'Completa los campos obligatorios antes de guardar.';
      return;
    }

    const payload = this.buildBlogPayload();
    this.blogSaving = true;
    this.blogSaveError = null;
    this.blogSaveSuccess = null;

    const request$ = this.selectedBlogPostId
      ? this.blogService.updatePost(this.selectedBlogPostId, payload)
      : this.blogService.createPost(payload);

    request$.subscribe({
      next: () => {
        this.blogSaving = false;
        this.blogSaveSuccess = this.selectedBlogPostId
          ? 'Articulo editorial actualizado.'
          : 'Articulo editorial creado.';
        this.resetBlogForm();
        this.loadBlogPosts(true);
        this.activeBlogTab = 'posts';
      },
      error: () => {
        this.blogSaving = false;
        this.blogSaveError = 'No se pudo guardar el articulo editorial.';
      },
    });
  }

  editBlogPost(post: AdminBlogPost): void {
    this.selectedBlogPostId = post.id ? String(post.id) : null;
    this.activeBlogTab = 'content';
    this.blogSaveError = null;
    this.blogSaveSuccess = null;
    this.resetAffiliatePreview();
    this.blogForm.reset({
      title: this.getPostTitle(post),
      slug: post.slug || '',
      status: 'draft',
      origin: post.origin || 'legacy',
      authorName: post.author?.name || '',
      authorId: post.author?.id || '',
      contentType: this.getPostContentType(post),
      featured: Boolean(post.featured),
      evergreen: post.evergreen !== false,
      primaryIntent: post.primaryIntent || '',
      targetQuery: post.targetQuery || '',
      excerpt: post.excerpt?.rendered || '',
      content: post.content?.rendered || '',
      categories: (post.categories_name || []).map((category) => category.name).join(', '),
      relatedPlatformKeys: [...(post.relatedPlatformKeys || [])],
      relatedRouteKeys: [...(post.relatedRouteKeys || [])],
      faqItems: this.serializeFaqItems(post.faqItems || []),
      affiliatePlacementMode: post.affiliatePlacementMode || 'auto',
      relatedOfferCategories: [...(post.relatedOfferCategories || [])],
      relatedMerchantKeys: (post.relatedMerchantKeys || []).join(', '),
      manualAffiliateOfferIds: (post.manualAffiliateOfferIds || []).join(', '),
      coverImage: post.featured_image?.source_url || '',
      metaTitle: post.seo?.metaTitle || '',
      metaDescription: post.seo?.metaDescription || '',
      keywords: (post.seo?.keywords || []).join(', '),
      ogImage: post.seo?.ogImage || '',
      canonicalUrl: post.seo?.canonicalUrl || '',
      publishedAt: this.toDatetimeLocalInput(post.date),
    });
  }

  requestDeleteBlogPost(post: AdminBlogPost): void {
    if (!post.id || this.blogDeletingId) {
      return;
    }
    this.pendingDeletePost = post;
    this.confirmDeletePostOpen = true;
  }

  cancelDeleteBlogPost(): void {
    this.pendingDeletePost = null;
    this.confirmDeletePostOpen = false;
  }

  confirmDeleteBlogPost(): void {
    const post = this.pendingDeletePost;
    if (!post?.id || this.blogDeletingId) {
      return;
    }

    this.blogDeletingId = String(post.id);
    this.blogSaveError = null;
    this.blogSaveSuccess = null;

    this.blogService.deletePost(String(post.id)).subscribe({
      next: () => {
        if (this.selectedBlogPostId === String(post.id)) {
          this.resetBlogForm(true);
        }
        this.blogDeletingId = null;
        this.blogSaveSuccess = 'Articulo editorial eliminado.';
        this.confirmDeletePostOpen = false;
        this.pendingDeletePost = null;
        this.loadBlogPosts(true);
      },
      error: () => {
        this.blogDeletingId = null;
        this.blogSaveError = 'No se pudo eliminar el articulo editorial.';
        this.confirmDeletePostOpen = false;
        this.pendingDeletePost = null;
      },
    });
  }

  togglePublishState(post: AdminBlogPost): void {
    if (!post.id || this.blogSaving || this.normalizePostStatus(post) !== 'publish') {
      return;
    }
    this.blogSaving = true;
    this.blogSaveError = null;
    this.blogSaveSuccess = null;

    this.blogService
      .updatePost(String(post.id), { ...this.mapPostToPayload(post), status: 'draft' })
      .subscribe({
        next: () => {
          this.blogSaving = false;
          this.blogSaveSuccess = 'Articulo retirado y devuelto a borrador.';
          this.loadBlogPosts(true);
        },
        error: () => {
          this.blogSaving = false;
          this.blogSaveError = 'No se pudo cambiar el estado del articulo.';
        },
      });
  }

  resetBlogForm(clearMessages = false): void {
    this.selectedBlogPostId = null;
    this.resetAffiliatePreview();
    this.blogForm.reset({
      title: '',
      slug: '',
      status: 'draft',
      origin: 'human',
      authorName: '',
      authorId: '',
      contentType: 'guide',
      featured: false,
      evergreen: true,
      primaryIntent: '',
      targetQuery: '',
      excerpt: '',
      content: '',
      categories: '',
      relatedPlatformKeys: [] as string[],
      relatedRouteKeys: [] as string[],
      faqItems: '',
      affiliatePlacementMode: 'auto' as AdminBlogAffiliatePlacementMode,
      relatedOfferCategories: [] as string[],
      relatedMerchantKeys: '',
      manualAffiliateOfferIds: '',
      coverImage: '',
      metaTitle: '',
      metaDescription: '',
      keywords: '',
      ogImage: '',
      canonicalUrl: '',
      publishedAt: '',
    });

    if (clearMessages) {
      this.blogSaveError = null;
      this.blogSaveSuccess = null;
    }
  }

  toggleArraySelection(
    controlName: 'relatedPlatformKeys' | 'relatedRouteKeys' | 'relatedOfferCategories',
    value: string,
    checked: boolean
  ): void {
    const current = this.getArrayValue(controlName);
    const next = checked
      ? Array.from(new Set([...current, value]))
      : current.filter((entry) => entry !== value);
    this.blogForm.get(controlName)?.setValue(next);
    this.blogForm.get(controlName)?.markAsDirty();
  }

  isArraySelectionActive(
    controlName: 'relatedPlatformKeys' | 'relatedRouteKeys' | 'relatedOfferCategories',
    value: string
  ): boolean {
    return this.getArrayValue(controlName).includes(value);
  }

  /**
   * Explicit, on-demand preview (not live-on-keystroke) of what the
   * `blog-inline` affiliate block would show for the article's current draft
   * fields — lets an editor verify the CTA/disclosure before publishing
   * without leaving the admin form. Reuses the same `AffiliateService` call
   * the public `BlogAffiliateBlockComponent` makes, so what's previewed here
   * is exactly what a reader would see.
   */
  previewAffiliateOffers(): void {
    this.affiliatePreviewRequested = true;
    this.affiliatePreviewLoading = true;
    this.affiliatePreviewError = null;

    const mode = this.getTrimmedValue('affiliatePlacementMode') as AdminBlogAffiliatePlacementMode;
    const pinnedOfferIds = this.parseCommaSeparated(this.getRawTextValue('manualAffiliateOfferIds'));

    if (mode === 'off') {
      this.affiliatePreviewOffers = [];
      this.affiliatePreviewLoading = false;
      return;
    }
    if (mode === 'manual' && pinnedOfferIds.length === 0) {
      this.affiliatePreviewOffers = [];
      this.affiliatePreviewLoading = false;
      return;
    }

    const providerKeys = Array.from(
      new Set([...this.getArrayValue('relatedPlatformKeys'), ...this.parseCommaSeparated(this.getRawTextValue('relatedMerchantKeys'))])
    );
    const category = this.getArrayValue('relatedOfferCategories')[0];

    this.affiliateService
      .resolveMany(
        { market: 'ES', placement: 'blog-inline', contentId: this.selectedBlogPostId ?? undefined, blogPostId: this.selectedBlogPostId ?? undefined },
        {
          providerKeys: providerKeys.length ? providerKeys : undefined,
          category,
          pinnedOfferIds: pinnedOfferIds.length ? pinnedOfferIds : undefined,
          autoResolve: mode !== 'manual',
          maxResults: 4,
        }
      )
      .subscribe({
        next: (offers) => {
          this.affiliatePreviewOffers = offers;
          this.affiliatePreviewLoading = false;
        },
        error: () => {
          this.affiliatePreviewOffers = [];
          this.affiliatePreviewLoading = false;
          this.affiliatePreviewError = 'No se pudo cargar la vista previa de monetizacion.';
        },
      });
  }

  private resetAffiliatePreview(): void {
    this.affiliatePreviewOffers = [];
    this.affiliatePreviewLoading = false;
    this.affiliatePreviewError = null;
    this.affiliatePreviewRequested = false;
  }

  private parseCommaSeparated(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  openBlogPreview(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.open(this.blogPreviewUrl, '_blank', 'noopener');
  }

  trackByBlogPost(_index: number, post: AdminBlogPost): string {
    return String(post.id || post.slug);
  }

  isSeoTitleOk(): boolean {
    const len = this.blogSeoTitleLength;
    return len >= 40 && len <= this.seoTitleMax;
  }

  isSeoDescriptionOk(): boolean {
    const len = this.blogSeoDescriptionLength;
    return len >= 120 && len <= this.seoDescriptionMax;
  }

  isCanonicalValid(): boolean {
    const value = this.getTrimmedValue('canonicalUrl');
    if (!value) {
      return true;
    }
    if (value.startsWith('/')) {
      return true;
    }
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  getPostTitle(post: AdminBlogPost): string {
    return post.title?.rendered || 'Sin titulo';
  }

  getPostExcerpt(post: AdminBlogPost): string {
    const excerpt = post.excerpt?.rendered || post.content?.rendered || '';
    return generateExcerpt(excerpt, 160);
  }

  getPostCategories(post: AdminBlogPost): string {
    const categories = post.categories_name?.map((cat) => cat.name) || [];
    return categories.length ? categories.join(', ') : 'Sin categoria';
  }

  getPostSeoTitle(post: AdminBlogPost): string {
    return post.seo?.metaTitle || this.getPostTitle(post);
  }

  getPostSeoDescription(post: AdminBlogPost): string {
    return (
      post.seo?.metaDescription ||
      generateExcerpt(
        post.excerpt?.rendered || post.content?.rendered || '',
        this.seoDescriptionMax
      )
    );
  }

  getPostImage(post: AdminBlogPost): string | null {
    return post.featured_image?.source_url || post.seo?.ogImage || null;
  }

  getPostUrl(post: AdminBlogPost): string {
    const slug = post.slug || 'articulo';
    return `${this.siteUrl}/guias/${slug}`;
  }

  getPostStatusClass(status?: string): string {
    if (status === 'publish') {
      return 'bg-[var(--accent-discover)]/20 text-[var(--accent-discover)] border-[var(--accent-discover)]/40';
    }
    return 'bg-[var(--spotify-warning)]/20 text-[var(--spotify-warning)] border-[var(--spotify-warning)]/40';
  }

  getPostTypeLabel(post: AdminBlogPost): string {
    const type = this.getPostContentType(post);
    if (type === 'ranking') return 'Ranking';
    if (type === 'trend') return 'Tendencia';
    return 'Guia';
  }

  getPostOriginLabel(post: AdminBlogPost): string {
    if (post.origin === 'ai-assisted') return 'IA asistida';
    if (post.origin === 'automated-import') return 'IA automática';
    if (post.origin === 'legacy') return 'Legado';
    return 'Humano';
  }

  getPostReviewLabel(post: AdminBlogPost): string | null {
    if (post.reviewState === 'unreviewed') return 'Sin revisar';
    if (post.reviewState === 'in-review') return 'En revisión';
    if (post.reviewState === 'rejected') return 'Rechazado';
    return null;
  }

  private loadBlogPosts(force = false): void {
    if (this.blogLoading) return;
    if (!force && this.blogPosts.length > 0) return;

    this.blogLoading = true;
    this.blogError = null;

    const search = this.blogSearchTerm.trim();
    this.blogService
      .getPosts({
        status: this.blogStatusFilter,
        search: search || undefined,
        limit: 50,
        contentType: this.blogTypeFilter,
        categorySlug: this.blogCategoryFilter !== 'all' ? this.blogCategoryFilter : undefined,
      })
      .subscribe({
        next: (posts) => {
          this.blogPosts = posts || [];
          this.blogLastLoaded = new Date();
          this.blogLoading = false;
          this.lastUpdatedChange.emit(this.blogLastLoaded);
        },
        error: () => {
          this.blogLoading = false;
          this.blogError = 'No se pudieron cargar los articulos editoriales.';
        },
      });
  }

  private loadBlogCategories(): void {
    this.blogService.getCategories().subscribe({
      next: (categories) => {
        this.blogCategories = categories || [];
      },
      error: () => {
        this.blogCategories = [];
      },
    });
  }

  private buildBlogPayload(): AdminBlogCreatePayload {
    const title = this.getTrimmedValue('title');
    const slug = slugify(this.getTrimmedValue('slug') || title);
    const content = this.getRawTextValue('content');
    const excerpt =
      this.getRawTextValue('excerpt') ||
      generateExcerpt(content, this.seoDescriptionMax);
    const metaTitle = this.getTrimmedValue('metaTitle') || title;
    const metaDescription =
      this.getRawTextValue('metaDescription') || excerpt || '';
    const publishedAt = this.getTrimmedValue('publishedAt');

    return {
      title,
      slug,
      status: 'draft',
      origin: this.getTrimmedValue('origin') as AdminBlogCreatePayload['origin'],
      authorName: this.getTrimmedValue('authorName'),
      authorId: this.getTrimmedValue('authorId'),
      contentType: this.getPostContentTypeValue(),
      featured: this.getBooleanValue('featured'),
      evergreen: this.getBooleanValue('evergreen'),
      primaryIntent: this.getTrimmedValue('primaryIntent'),
      targetQuery: this.getTrimmedValue('targetQuery'),
      excerpt,
      content,
      categories: this.getTrimmedValue('categories'),
      relatedPlatformKeys: this.getArrayValue('relatedPlatformKeys'),
      relatedRouteKeys: this.getArrayValue('relatedRouteKeys'),
      faqItems: this.parseFaqItems(this.getRawTextValue('faqItems')),
      affiliatePlacementMode: this.getTrimmedValue('affiliatePlacementMode') as AdminBlogAffiliatePlacementMode,
      relatedOfferCategories: this.getArrayValue('relatedOfferCategories'),
      relatedMerchantKeys: this.getTrimmedValue('relatedMerchantKeys'),
      manualAffiliateOfferIds: this.getTrimmedValue('manualAffiliateOfferIds'),
      coverImage: this.getTrimmedValue('coverImage'),
      metaTitle,
      metaDescription,
      keywords: this.getTrimmedValue('keywords'),
      ogImage: this.getTrimmedValue('ogImage'),
      canonicalUrl: this.getTrimmedValue('canonicalUrl'),
      publishedAt: publishedAt || undefined,
    };
  }

  private mapPostToPayload(post: AdminBlogPost): AdminBlogCreatePayload {
    return {
      title: this.getPostTitle(post),
      slug: post.slug,
      status: this.normalizePostStatus(post),
      origin: post.origin || 'legacy',
      authorName: post.author?.name || '',
      authorId: post.author?.id || '',
      contentType: this.getPostContentType(post),
      featured: Boolean(post.featured),
      evergreen: post.evergreen !== false,
      primaryIntent: post.primaryIntent || '',
      targetQuery: post.targetQuery || '',
      excerpt: post.excerpt?.rendered || '',
      content: post.content?.rendered || '',
      categories: (post.categories_name || []).map((category) => category.name),
      relatedPlatformKeys: [...(post.relatedPlatformKeys || [])],
      relatedRouteKeys: [...(post.relatedRouteKeys || [])],
      faqItems: [...(post.faqItems || [])],
      affiliatePlacementMode: post.affiliatePlacementMode || 'auto',
      relatedOfferCategories: [...(post.relatedOfferCategories || [])],
      relatedMerchantKeys: [...(post.relatedMerchantKeys || [])],
      manualAffiliateOfferIds: [...(post.manualAffiliateOfferIds || [])],
      coverImage: post.featured_image?.source_url || '',
      metaTitle: post.seo?.metaTitle || '',
      metaDescription: post.seo?.metaDescription || '',
      keywords: post.seo?.keywords || [],
      ogImage: post.seo?.ogImage || '',
      canonicalUrl: post.seo?.canonicalUrl || '',
      publishedAt: post.date || undefined,
    };
  }

  private parseFaqItems(value: string): AdminBlogFaqItem[] {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [question, answer] = line.split('::');
        return {
          question: String(question || '').trim(),
          answer: String(answer || '').trim(),
        };
      })
      .filter((item) => item.question && item.answer);
  }

  private serializeFaqItems(items: AdminBlogFaqItem[]): string {
    return items.map((item) => `${item.question}::${item.answer}`).join('\n');
  }

  private getPostContentType(post: AdminBlogPost): AdminBlogContentType {
    const raw = String(post.contentType || '').trim().toLowerCase();
    if (raw === 'ranking' || raw === 'trend') {
      return raw;
    }
    const categorySlugs = (post.categories_name || []).map((category) => category.slug);
    if (categorySlugs.some((slug) => ['ranking', 'rankings', 'top-10', 'top10'].includes(slug))) {
      return 'ranking';
    }
    return 'guide';
  }

  private getPostContentTypeValue(): AdminBlogContentType {
    const raw = this.getTrimmedValue('contentType').toLowerCase();
    if (raw === 'ranking' || raw === 'trend') {
      return raw;
    }
    return 'guide';
  }

  private normalizePostStatus(post: AdminBlogPost): 'draft' | 'publish' {
    return this.normalizePostStatusValue(post.status || 'draft');
  }

  private normalizePostStatusValue(value: string): 'draft' | 'publish' {
    return value === 'publish' ? 'publish' : 'draft';
  }

  private toDatetimeLocalInput(value?: string): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().slice(0, 16);
  }

  private getTrimmedValue(controlName: string): string {
    const value = this.blogForm.get(controlName)?.value;
    return value ? String(value).trim() : '';
  }

  private getRawTextValue(controlName: string): string {
    const value = this.blogForm.get(controlName)?.value;
    return value ? String(value) : '';
  }

  private getArrayValue(controlName: 'relatedPlatformKeys' | 'relatedRouteKeys' | 'relatedOfferCategories'): string[] {
    const value = this.blogForm.get(controlName)?.value;
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }

  private getBooleanValue(controlName: 'featured' | 'evergreen'): boolean {
    return Boolean(this.blogForm.get(controlName)?.value);
  }
}
