import { buildDetailPath, slugifyTitle, splitAiringsByTime } from './catalog';

describe('splitAiringsByTime', () => {
  // Phase 1 TS-15: at 12:40 Madrid a programme page listed last night's 23:00-02:15 airing under "A continuación".
  const airing = (title: string, start: string, end: string) => ({ title, start, end });
  const now = Date.parse('2026-10-20T10:40:00Z'); // 12:40 in Madrid (CEST)
  const airings = [
    airing('tonight, past midnight', '2026-10-20T21:30:00Z', '2026-10-21T00:30:00Z'),
    airing('last night, past midnight', '2026-10-19T21:00:00+00:00', '2026-10-20T02:15:00+02:00'),
    airing('on air', '2026-10-20T12:30:00+02:00', '2026-10-20T13:30:00+02:00'),
    airing('this afternoon', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z'),
    airing('ended exactly now', '2026-10-20T09:40:00Z', '2026-10-20T10:40:00Z'),
  ];

  it('keeps the airing on now as current and only future starts as upcoming, in start order', () => {
    const { current, upcoming } = splitAiringsByTime(airings, now);
    expect(current?.title).toBe('on air');
    expect(upcoming.map((a) => a.title)).toEqual(['this afternoon', 'tonight, past midnight']);
  });

  it('treats an airing that started exactly now as current, not upcoming', () => {
    const { current, upcoming } = splitAiringsByTime([airing('starts now', '2026-10-20T10:40:00Z', '2026-10-20T11:00:00Z')], now);
    expect(current?.title).toBe('starts now');
    expect(upcoming).toEqual([]);
  });

  it('handles a missing list', () => {
    expect(splitAiringsByTime(undefined, now)).toEqual({ current: null, upcoming: [] });
  });
});

// M10-D: an EPG row whose title is an object stringified to "[object Object]" and produced the public slug
// "object-object". A value that is not text has no slug, so `buildDetailPath` falls back to the `sin-titulo`
// path the cards refuse to link.
describe('slugifyTitle', () => {
  it('gives a title that stringifies to [object Object] no slug at all', () => {
    for (const notATitle of [{}, { _: 'Rosario desde Lourdes' }, new Map()]) {
      expect(slugifyTitle(notATitle as unknown as string)).toBe('');
      expect(buildDetailPath('program', notATitle as unknown as string, slugifyTitle)).toBe('/programas/sin-titulo');
    }
  });

  it('keeps every title that already stringifies to one, accents included', () => {
    expect(slugifyTitle('El último de la fila')).toBe('el-ultimo-de-la-fila');
    expect(slugifyTitle(['El último de la fila'] as unknown as string)).toBe('el-ultimo-de-la-fila');
    expect(buildDetailPath('movie', 'Gladiator', slugifyTitle)).toBe('/peliculas/gladiator');
  });
});
