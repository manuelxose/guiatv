import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CanalCompletoComponent } from './canal-completo.component';
import { TvDataService } from '../../state/tv-data.service';
import { MetaService } from '../../services/meta.service';
import { ApiConfigService } from '../../api/api-config.service';
import { AffiliateService } from '../../services/affiliate.service';
import { AffiliateResolvedOffer } from '../../interfaces/affiliate.interface';
import { TvChannelSurfaceDTO, TvReadItemDTO } from '../../api/models';

function buildOffer(): AffiliateResolvedOffer {
  return {
    offerId: 'offer-channel-1',
    merchant: { id: 'm-1', slug: 'movistar-plus', name: 'Movistar Plus+' },
    category: 'streaming',
    plan: { id: 'plan-1', name: 'Estándar' },
    display: { disclosure: 'Enlace afiliado' },
    cta: { label: 'Ver oferta', sponsored: true },
    outbound: { path: '/v2/affiliate/go/offer-channel-1?placement=channel-page&market=ES' },
  };
}

function buildSurface(overrides: Partial<TvChannelSurfaceDTO['channel']> = {}): TvChannelSurfaceDTO {
  return {
    channel: {
      id: 'movistar-cine',
      name: 'Movistar Cine',
      access: 'pay',
      distribution: 'operator',
      operator: 'Movistar Plus+',
      providers: ['Movistar Plus+'],
      ...overrides,
    },
    scheduleItems: [],
  } as unknown as TvChannelSurfaceDTO;
}

describe('CanalCompletoComponent — channel-page affiliate CTA', () => {
  let resolveManySpy: jasmine.Spy;
  let setMetaTagsSpy: jasmine.Spy;

  function configure(surface: TvChannelSurfaceDTO) {
    resolveManySpy = jasmine.createSpy('resolveMany').and.returnValue(of([]));
    setMetaTagsSpy = jasmine.createSpy('setMetaTags');
    TestBed.configureTestingModule({
      imports: [CanalCompletoComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: surface.channel?.id || 'missing-channel' })) },
        },
        { provide: TvDataService, useValue: { loadChannelSurface: () => of(surface) } },
        { provide: MetaService, useValue: { setMetaTags: setMetaTagsSpy } },
        { provide: ApiConfigService, useValue: { getAssetBaseUrl: () => '' } },
        { provide: AffiliateService, useValue: { resolveMany: resolveManySpy, buildOutboundUrl: (o: AffiliateResolvedOffer) => o.outbound.path } },
      ],
    });
  }

  it('resolves a channel-page offer from the channel\'s canonical provider labels, never the raw channel name', () => {
    const surface = buildSurface();
    configure(surface);

    const fixture = TestBed.createComponent(CanalCompletoComponent);
    fixture.detectChanges();

    expect(resolveManySpy).toHaveBeenCalledTimes(1);
    const [context, options] = resolveManySpy.calls.mostRecent().args;
    expect(context.placement).toBe('channel-page');
    expect(context.channelId).toBe('movistar-cine');
    expect(options.providerKeys).toEqual(['Movistar Plus+']);
  });

  it('renders nothing when the resolver finds no verified merchant for this channel', () => {
    configure(buildSurface());
    const fixture = TestBed.createComponent(CanalCompletoComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.channelAffiliateOffers).toEqual([]);
  });

  it('exposes the resolved offer(s) and sponsored disclosure state for a channel with a verified affiliate relationship', () => {
    configure(buildSurface());
    resolveManySpy.and.returnValue(of([buildOffer()]));
    const fixture = TestBed.createComponent(CanalCompletoComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.channelAffiliateOffers.length).toBe(1);
    expect(fixture.componentInstance.showChannelSponsoredDisclosure).toBeTrue();
  });

  it('skips the affiliate lookup entirely for a channel with no provider/operator labels', () => {
    configure(buildSurface({ providers: [], operator: undefined }));
    const fixture = TestBed.createComponent(CanalCompletoComponent);
    fixture.detectChanges();

    expect(resolveManySpy).not.toHaveBeenCalled();
  });

  it('marks an unavailable channel as a noindex 404 instead of an indexable empty page', () => {
    configure({ channel: null, scheduleItems: [] } as unknown as TvChannelSurfaceDTO);
    const fixture = TestBed.createComponent(CanalCompletoComponent);
    fixture.detectChanges();

    expect(setMetaTagsSpy).toHaveBeenCalledWith(jasmine.objectContaining({
      robots: 'noindex, follow',
      httpStatus: 404,
    }));
  });

  it('M10-C: a second-feed alias page declares its channel as canonical (when the SSR 301 did not apply)', () => {
    const surface = { ...buildSurface({ id: 'telemadrid_tv', name: 'Telemadrid.TV', normalizedName: 'telemadrid_tv' } as any),
      canonicalChannel: { id: 'telemadrid', name: 'Telemadrid', normalizedName: 'telemadrid' } } as TvChannelSurfaceDTO;
    configure(surface);
    TestBed.createComponent(CanalCompletoComponent).detectChanges();
    expect(setMetaTagsSpy.calls.mostRecent().args[0].canonicalUrl).toBe('/canales/telemadrid');
  });

  it('M10-C: a channel without canonicalChannel keeps its own canonical', () => {
    configure(buildSurface({ id: 'aragon_tv', name: 'Aragón TV', normalizedName: 'aragon_tv' } as any));
    TestBed.createComponent(CanalCompletoComponent).detectChanges();
    expect(setMetaTagsSpy.calls.mostRecent().args[0].canonicalUrl).toBe('/canales/aragon-tv');
  });

  function airing(id: string, start: string, end: string, liveNow = false): TvReadItemDTO {
    return {
      id,
      program: { title: id, editorialCategory: 'Cine' },
      airing: { start, end, liveNow },
      channel: { id: 'movistar-cine', name: 'Movistar Cine' },
      availability: {},
      assets: {},
      timingContext: { liveNow },
    } as unknown as TvReadItemDTO;
  }

  it('uses Spanish peninsular time across daylight saving changes independently of the host timezone', () => {
    configure(buildSurface());
    const component = TestBed.createComponent(CanalCompletoComponent).componentInstance;
    expect(component.formatTime('2026-10-24T20:00:00Z')).toBe('22:00');
    expect(component.formatTime('2026-10-25T20:00:00Z')).toBe('21:00');
    expect(component.formatTime('invalid')).toBe('');
  });

  it('rejects invalid intervals and derives current and next from verified chronological times', () => {
    spyOn(Date, 'now').and.returnValue(Date.parse('2026-10-23T12:00:00Z'));
    const surface = buildSurface();
    const past = airing('past', '2026-10-23T10:00:00Z', '2026-10-23T11:00:00Z', true);
    const current = airing('current', '2026-10-23T11:00:00Z', '2026-10-23T13:00:00Z');
    const first = airing('first', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z');
    const later = airing('later', '2026-10-23T14:00:00Z', '2026-10-23T15:00:00Z');
    surface.current = past;
    surface.next = later;
    surface.scheduleItems = [later, past, first, current,
      airing('invalid', 'invalid', '2026-10-23T15:00:00Z'),
      airing('backwards', '2026-10-23T16:00:00Z', '2026-10-23T15:00:00Z')];
    configure(surface);
    const component = TestBed.createComponent(CanalCompletoComponent).componentInstance;
    component.ngOnInit();

    expect(component.programs.map((program) => program.id)).toEqual(['past', 'current', 'first', 'later']);
    expect(component.currentProgram?.id).toBe('current');
    expect(component.currentProgram?.raw.airing.liveNow).toBeTrue();
    expect(component.programs[0].liveNow).toBeFalse();
    expect(component.programs[0].raw.timingContext.liveNow).toBeFalse();
    expect(component.nextPrograms.map((program) => program.id)).toEqual(['first', 'later']);
  });

  it('shows only the supplied evening schedule and applies the existing category filter', () => {
    const surface = buildSurface();
    surface.tonightItems = [airing('evening', '2026-10-23T20:00:00Z', '2026-10-23T21:00:00Z')];
    configure(surface);
    const component = TestBed.createComponent(CanalCompletoComponent).componentInstance;
    component.ngOnInit();
    expect(component.filteredTonightPrograms.map((program) => program.id)).toEqual(['evening']);
    component.selectCategory('Deportes');
    expect(component.filteredTonightPrograms).toEqual([]);
    expect(component.programs).toEqual([]);
  });
});
