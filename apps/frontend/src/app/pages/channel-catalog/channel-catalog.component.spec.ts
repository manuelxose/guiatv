import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ChannelCatalogComponent, filterChannelDirectory } from './channel-catalog.component';
import { TvReadChannelSummaryDTO } from '../../api/models';
import { TvApiService } from '../../api/tv-api.service';
import { MetaService } from '../../services/meta.service';

describe('channel catalogue filtering', () => {
  const channels: TvReadChannelSummaryDTO[] = [
    {
      channel: {
        id: 'axn',
        name: 'AXN España',
        aliases: ['AXN HD'],
        access: 'pay',
        operator: 'Sony Pictures Television',
      },
      counts: { total: 28, live: 1, tonight: 5 },
    },
    {
      channel: { id: 'la_1', name: 'La 1', access: 'free', type: 'TDT' },
      counts: { total: 24, live: 1, tonight: 4 },
    },
  ];

  it('matches accents, aliases and operators without changing directory order', () => {
    expect(filterChannelDirectory(channels, 'espana', 'pay')).toEqual([channels[0]]);
    expect(filterChannelDirectory(channels, 'sony', 'all')).toEqual([channels[0]]);
    expect(filterChannelDirectory(channels, 'AXN HD', 'all')).toEqual([channels[0]]);
  });

  it('hides channels whose name is a raw feed id outside the sitemap groups', () => {
    const raw = [
      { channel: { id: 'xarxa_tv', name: 'Xarxa_TVMataro.TV', group: 'online' } },
      { channel: { id: 'etb1_tv', name: 'ETB1.TV' } },
    ] as TvReadChannelSummaryDTO[];
    expect(filterChannelDirectory([...channels, ...raw], '', 'all')).toEqual(channels);
  });

  // M10-D: sitemap-channels.xml publishes every tdt/autonomico channel, and the directory is their only internal
  // path, so a raw feed name must never cost one its link.
  it('keeps raw feed names that sitemap-channels.xml publishes', () => {
    const published = [
      { channel: { id: 'etb1_tv', name: 'ETB1.TV', group: 'autonomico', access: 'free' } },
      { channel: { id: 'sx3_tv', name: 'SX3.TV', group: 'autonomico', access: 'free' } },
      { channel: { id: 'hidden_tv', name: 'Hidden_Feed.TV', group: 'online', access: 'free' } },
    ] as TvReadChannelSummaryDTO[];
    expect(filterChannelDirectory(published, '', 'all')).toEqual([published[0], published[1]]);
    expect(filterChannelDirectory(published, '', 'free')).toEqual([published[0], published[1]]);
  });

  // M10-F: production ids and names of 2026-11-03. Only a feed reviewed as a channel of its own is listed; feeds whose
  // airings are another listed channel's stay hidden, and a reviewed id never lets another feed through.
  const feeds = [
    { channel: { id: 'la8cyl_tv', name: 'La8CYL.TV', normalizedName: 'la8cyl_tv', group: 'online', access: 'unknown' }, counts: { total: 1, live: 0, tonight: 0 } },
    { channel: { id: 'la2_cat_tv', name: 'La2_CAT.TV', group: 'online', access: 'unknown' }, counts: { total: 1, live: 0, tonight: 0 } },
    { channel: { id: 'aljq_tv', name: 'AlJQ.TV', group: 'online', access: 'unknown' }, counts: { total: 1, live: 0, tonight: 0 } },
    { channel: { id: 'la8cyl_tv_hd', name: 'La8CYL_HD.TV', group: 'online', access: 'unknown' }, counts: { total: 1, live: 0, tonight: 0 } },
  ] as TvReadChannelSummaryDTO[];

  it('lists a feed reviewed as a distinct channel and keeps duplicate feeds hidden', () => {
    expect(filterChannelDirectory([...channels, ...feeds], '', 'all')).toEqual([...channels, feeds[0]]);
    expect(filterChannelDirectory(feeds, 'la8', 'all')).toEqual([feeds[0]]);
  });

  it('renders the reviewed feed as a real anchor to its canonical channel page', () => {
    TestBed.configureTestingModule({
      imports: [ChannelCatalogComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: TvApiService,
          useValue: { getTvReadChannels: () => of({ data: { date: '2026-11-03', channels: [...channels, ...feeds] } }) },
        },
        { provide: MetaService, useValue: { setMetaTags: () => {}, markUnavailable: () => {} } },
      ],
    });
    const fixture = TestBed.createComponent(ChannelCatalogComponent);
    fixture.detectChanges();
    const hrefs = Array.from(fixture.nativeElement.querySelectorAll('a[href^="/canales/"]'))
      .map((a) => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs).toContain('/canales/la8cyl-tv');
    expect(hrefs.filter((href) => /la2-cat-tv|aljq-tv|la8cyl-hd-tv/.test(String(href)))).toEqual([]);
  });

  it('supports explicit free/pay access filters', () => {
    expect(filterChannelDirectory(channels, '', 'free')).toEqual([channels[1]]);
    expect(filterChannelDirectory(channels, '', 'pay')).toEqual([channels[0]]);
  });
});
