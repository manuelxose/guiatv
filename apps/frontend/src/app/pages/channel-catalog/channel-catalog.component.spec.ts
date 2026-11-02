import { filterChannelDirectory } from './channel-catalog.component';
import { TvReadChannelSummaryDTO } from '../../api/models';

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

  it('supports explicit free/pay access filters', () => {
    expect(filterChannelDirectory(channels, '', 'free')).toEqual([channels[1]]);
    expect(filterChannelDirectory(channels, '', 'pay')).toEqual([channels[0]]);
  });
});
