import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AnalyticsService } from '../../services/analytics.service';
import { MonetizationOffer, MonetizationOffersResponse, MonetizationService } from '../../services/monetization.service';
import { StreamingComparisonComponent } from './streaming-comparison.component';

const buildOffer = (id: string, name: string, price: number, sponsored = false): MonetizationOffer => ({
  id,
  market: 'ES',
  provider: { id: id.split('-')[0], name },
  plan: { id: 'standard', name: 'Estándar' },
  pricing: { currency: 'EUR', monthlyAmount: price, annualAmount: null, monthlyLabel: `${price} €/mes`, annualLabel: 'No disponible', activationFeeAmount: null },
  features: { simultaneousStreams: '2', maxResolution: '4K', downloads: true, ads: false, liveContent: true, sports: false, football: false, movies: true, series: true, family: true, fourK: true },
  requirements: { commitmentMonths: 0, fibreRequired: false, mobileRequired: false, device: null },
  trialDays: null,
  bestFor: 'Cine y series',
  highlight: 'Una oferta útil para comparar.',
  disclosure: sponsored ? 'Enlace afiliado.' : 'Enlace directo sin comisión.',
  verification: { lastVerifiedAt: '2026-08-26', sourceUrl: 'https://example.com/source', status: 'current' },
  outbound: { path: `/v2/monetization/go/${id.split('-')[0]}/${id}`, relationship: sponsored ? 'affiliate_configured' : 'direct_commercial_link', label: sponsored ? 'Ver oferta' : 'Consultar proveedor', isSponsored: sponsored },
  recommendation: { intents: ['movies'] },
});

const offers = [
  buildOffer('netflix-standard', 'Netflix', 8.99, true),
  buildOffer('prime-standard', 'Prime Video', 4.99),
  buildOffer('filmin-standard', 'Filmin', 9.99),
  buildOffer('apple-standard', 'Apple TV+', 9.99),
];

const response: MonetizationOffersResponse = {
  items: offers,
  meta: { market: 'ES', total: offers.length, generatedAt: '2026-08-26T12:00:00Z', disclosure: 'Orden independiente de comisión.' },
  filters: { intents: ['cheapest', 'movies'], features: ['downloads', '4k'] },
};

describe('StreamingComparisonComponent', () => {
  let fixture: ComponentFixture<StreamingComparisonComponent>;
  let component: StreamingComparisonComponent;
  let service: jasmine.SpyObj<MonetizationService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj('MonetizationService', ['getOffers', 'buildOutboundUrl']);
    service.getOffers.and.returnValue(of(response));
    service.buildOutboundUrl.and.callFake((path, placement) => `${path}?placement=${placement}`);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackEvent']);

    await TestBed.configureTestingModule({
      imports: [StreamingComparisonComponent],
      providers: [
        provideRouter([]),
        { provide: MonetizationService, useValue: service },
        { provide: AnalyticsService, useValue: analytics },
        { provide: MetaService, useValue: { setMetaTags: () => undefined } },
        { provide: ChatService, useValue: { requestToggleAssistant: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StreamingComparisonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads real offers and selects the first three for comparison', () => {
    expect(service.getOffers).toHaveBeenCalled();
    expect(component.offers.length).toBe(4);
    expect(component.selectedOffers.length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('4 ofertas');
    expect(fixture.nativeElement.textContent).toContain('Comparación seleccionada');
  });

  it('caps side-by-side comparison at three offers and announces the limit', () => {
    component.toggleOffer('apple-standard');
    fixture.detectChanges();

    expect(component.selectedOffers.length).toBe(3);
    expect(component.selectionMessage).toContain('máximo de 3');
  });

  it('reloads offers when an intent changes and records a comparator filter event', () => {
    component.changeIntent('movies');

    expect(service.getOffers).toHaveBeenCalledWith(jasmine.objectContaining({ intent: 'movies' }));
    expect(analytics.trackEvent).toHaveBeenCalledWith('comparator_filter', jasmine.objectContaining({ intent: 'movies' }), 'comparator_filter');
  });

  it('uses the internal redirect and sponsored relation only when configured', () => {
    const netflix = component.offers[0];

    expect(component.outboundUrl(netflix, 'comparison-card')).toContain('/v2/monetization/go/');
    expect(component.outboundRel(netflix)).toBe('sponsored nofollow noopener noreferrer');
    // Not commission-bearing, but still a click-tracking redirect: nofollow, never sponsored.
    expect(component.outboundRel(component.offers[1])).toBe('nofollow noopener noreferrer');
  });

  it('shows a retryable error instead of static fallback offers', () => {
    service.getOffers.and.returnValue(throwError(() => new Error('Offers unavailable')));

    component.loadOffers();
    fixture.detectChanges();

    expect(component.errorMessage).toContain('ofertas');
    expect(fixture.nativeElement.textContent).toContain('Reintentar');
    expect(component.offers).toEqual([]);
  });
});
