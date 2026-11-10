import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { BlogAffiliateBlockComponent } from './blog-affiliate-block.component';
import { AffiliateService } from '../../../services/affiliate.service';
import { AffiliateCTAComponent } from '../../../components/affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from '../../../components/affiliate-disclosure/affiliate-disclosure.component';
import { AffiliateContext, AffiliateResolvedOffer } from '../../../interfaces/affiliate.interface';
import { EditorialPost } from '../../models/editorial.models';

function post(overrides: Partial<EditorialPost> = {}): EditorialPost {
  return {
    id: 'post-1',
    slug: 'articulo',
    title: 'Artículo',
    excerptHtml: '',
    excerptText: '',
    contentHtml: '',
    coverImage: '',
    publishedAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    readingMinutes: 3,
    tocItems: [],
    author: null,
    canonicalPath: '/guias/articulo',
    categories: [],
    primaryCategory: null,
    contentType: 'guide',
    featured: false,
    primaryIntent: null,
    targetQuery: null,
    relatedPlatformKeys: [],
    relatedRouteKeys: [],
    faqItems: [],
    evergreen: true,
    affiliatePlacementMode: 'auto',
    relatedOfferCategories: [],
    relatedMerchantKeys: [],
    manualAffiliateOfferIds: [],
    isRanking: false,
    rankingReason: 'none',
    metaTitle: null,
    metaDescription: null,
    structuredData: [],
    raw: {},
    ...overrides,
  };
}

function offer(overrides: Partial<AffiliateResolvedOffer> = {}): AffiliateResolvedOffer {
  return {
    offerId: 'offer-1',
    merchant: { id: 'm1', slug: 'netflix', name: 'Netflix' },
    category: 'streaming',
    plan: { id: 'p', name: 'Plan' },
    display: { disclosure: 'Enlace afiliado' },
    cta: { label: 'Ver oferta', sponsored: true },
    outbound: { path: '/v2/affiliate/go/offer-1' },
    ...overrides,
  };
}

describe('BlogAffiliateBlockComponent', () => {
  let resolveManySpy: jasmine.Spy;

  beforeEach(() => {
    resolveManySpy = jasmine.createSpy('resolveMany').and.returnValue(of([]));
    TestBed.configureTestingModule({
      imports: [BlogAffiliateBlockComponent],
      providers: [{ provide: AffiliateService, useValue: { resolveMany: resolveManySpy, buildOutboundUrl: (o: AffiliateResolvedOffer) => o.outbound.path } }],
    });
  });

  function create(input: Partial<EditorialPost>, placement: 'blog-inline' | 'blog-footer' = 'blog-inline') {
    const fixture = TestBed.createComponent(BlogAffiliateBlockComponent);
    fixture.componentRef.setInput('post', post(input));
    fixture.componentRef.setInput('placement', placement);
    fixture.detectChanges();
    return fixture;
  }

  it('never calls the resolver for a non-commercial article — no platform/merchant/category/pin signal at all', () => {
    create({});
    expect(resolveManySpy).not.toHaveBeenCalled();
  });

  it('never calls the resolver when affiliatePlacementMode is off, even with a strong platform signal', () => {
    create({ affiliatePlacementMode: 'off', relatedPlatformKeys: ['netflix'] });
    expect(resolveManySpy).not.toHaveBeenCalled();
  });

  it('resolves automatically from relatedPlatformKeys, scoped to the post as content and blogPostId', () => {
    resolveManySpy.and.returnValue(of([offer()]));
    const fixture = create({ relatedPlatformKeys: ['netflix'] });

    expect(resolveManySpy).toHaveBeenCalledTimes(1);
    const [context, options] = resolveManySpy.calls.mostRecent().args as [AffiliateContext, { providerKeys?: string[] }];
    expect(context.placement).toBe('blog-inline');
    expect(context.contentType).toBe('editorial');
    expect(context.contentId).toBe('post-1');
    expect(context.blogPostId).toBe('post-1');
    expect(options.providerKeys).toEqual(['netflix']);
    expect(fixture.componentInstance.offers().length).toBe(1);
  });

  it('resolves automatically from relatedOfferCategories for a non-streaming article (e.g. best Smart TVs)', () => {
    resolveManySpy.and.returnValue(of([offer({ category: 'smart-tv' })]));
    create({ relatedOfferCategories: ['smart-tv'], relatedMerchantKeys: ['pccomponentes'] });

    const [, options] = resolveManySpy.calls.mostRecent().args as [AffiliateContext, { category?: string; providerKeys?: string[] }];
    expect(options.category).toBe('smart-tv');
    expect(options.providerKeys).toEqual(['pccomponentes']);
  });

  it('manual mode with a pin resolves only that pin, with autoResolve disabled', () => {
    resolveManySpy.and.returnValue(of([offer()]));
    create({ affiliatePlacementMode: 'manual', manualAffiliateOfferIds: ['offer-9'], relatedPlatformKeys: ['netflix'] });

    const [, options] = resolveManySpy.calls.mostRecent().args as [AffiliateContext, { pinnedOfferIds?: string[]; autoResolve?: boolean; providerKeys?: string[] }];
    expect(options.pinnedOfferIds).toEqual(['offer-9']);
    expect(options.autoResolve).toBe(false);
    expect(options.providerKeys).toBeUndefined();
  });

  it('manual mode with no pin never calls the resolver — never falls back to automatic offers the editor did not choose', () => {
    create({ affiliatePlacementMode: 'manual', manualAffiliateOfferIds: [], relatedPlatformKeys: ['netflix'] });
    expect(resolveManySpy).not.toHaveBeenCalled();
  });

  it('auto mode still forwards a manual pin alongside automatic candidates', () => {
    resolveManySpy.and.returnValue(of([offer()]));
    create({ relatedPlatformKeys: ['netflix'], manualAffiliateOfferIds: ['offer-9'] });

    const [, options] = resolveManySpy.calls.mostRecent().args as [AffiliateContext, { pinnedOfferIds?: string[] }];
    expect(options.pinnedOfferIds).toEqual(['offer-9']);
  });

  it('renders nothing (no section) when the resolver returns no offers', () => {
    resolveManySpy.and.returnValue(of([]));
    const fixture = create({ relatedPlatformKeys: ['netflix'] });

    expect(fixture.debugElement.query(By.css('section'))).toBeNull();
  });

  it('renders one AffiliateCTAComponent per resolved offer, as the secondary variant', () => {
    resolveManySpy.and.returnValue(of([offer({ offerId: 'a' }), offer({ offerId: 'b' })]));
    const fixture = create({ relatedPlatformKeys: ['netflix'] });

    const ctas = fixture.debugElement.queryAll(By.directive(AffiliateCTAComponent));
    expect(ctas.length).toBe(2);
    expect(ctas[0].componentInstance.variant()).toBe('secondary');
  });

  it('shows the disclosure only when at least one offer is sponsored', () => {
    resolveManySpy.and.returnValue(of([offer({ cta: { label: 'Ver', sponsored: false } })]));
    const fixture = create({ relatedPlatformKeys: ['netflix'] });

    expect(fixture.debugElement.query(By.directive(AffiliateDisclosureComponent))).toBeNull();
  });
});
