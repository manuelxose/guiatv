import { addDays, dayKey, dayLabel, displayZone, isDayKey, kickoffTime, madridInstant, setDisplayZone, timezoneLabel, zoneDescription } from './calendar';

describe('sports-v2 calendar', () => {
  it('builds day keys in Madrid time, not UTC', () => {
    expect(dayKey('2026-11-05T23:30:00Z')).toBe('2026-11-06'); // 00:30 CET next day
    expect(dayKey('2026-11-05T22:30:00Z')).toBe('2026-11-05');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('labels yesterday, today and tomorrow', () => {
    expect(dayLabel('2026-11-05', '2026-11-05')).toBe('Hoy');
    expect(dayLabel('2026-11-04', '2026-11-05')).toBe('Ayer');
    expect(dayLabel('2026-11-06', '2026-11-05')).toBe('Mañana');
    expect(dayLabel('2026-11-09', '2026-11-05')).toMatch(/9/);
  });

  it('round-trips Madrid wall-clock time in winter and summer', () => {
    expect(kickoffTime(madridInstant('2026-11-05', 21, 30).toISOString())).toBe('21:30');
    expect(kickoffTime(madridInstant('2026-07-15', 21, 30).toISOString())).toBe('21:30');
    expect(madridInstant('2026-11-05', 21, 0).toISOString()).toBe('2026-11-05T20:00:00.000Z'); // CET = UTC+1
    expect(madridInstant('2026-07-15', 21, 0).toISOString()).toBe('2026-07-15T19:00:00.000Z'); // CEST = UTC+2
  });

  it('names the Madrid time zone for the instant', () => {
    expect(timezoneLabel(new Date('2026-11-05T12:00:00Z'))).toBe('CET');
    expect(timezoneLabel(new Date('2026-07-15T12:00:00Z'))).toBe('CEST');
  });

  it('validates day keys', () => {
    expect(isDayKey('2026-11-05')).toBeTrue();
    expect(isDayKey('05/11/2026')).toBeFalse();
    expect(isDayKey('2026-13-45')).toBeFalse();
    expect(isDayKey(null)).toBeFalse();
  });
});

describe('sports-v2 display zone', () => {
  afterEach(() => setDisplayZone('Europe/Madrid'));

  it('shifts day and clock for the visitor while the instant stays the same', () => {
    const iso = '2026-11-05T23:30:00Z'; // 00:30 in Madrid, 20:30 in Buenos Aires
    expect(dayKey(iso)).toBe('2026-11-06');
    expect(setDisplayZone('America/Argentina/Buenos_Aires')).toBeTrue();
    expect(dayKey(iso)).toBe('2026-11-05');
    expect(kickoffTime(iso)).toBe('20:30');
    expect(Date.parse(iso)).toBe(Date.UTC(2026, 10, 5, 23, 30)); // the instant itself never changes
  });

  it('describes the zone honestly', () => {
    expect(zoneDescription(new Date('2026-11-05T12:00:00Z'))).toBe('hora de Madrid (CET)');
    setDisplayZone('Asia/Tokyo');
    expect(zoneDescription()).toContain('tu hora local (Asia/Tokyo');
  });

  it('ignores a zone the runtime does not know', () => {
    expect(setDisplayZone('Mars/Olympus')).toBeFalse();
    expect(setDisplayZone(undefined)).toBeFalse();
    expect(displayZone()).toBe('Europe/Madrid');
  });

  it('puts a match on the right day across a DST change (Madrid, 2026-10-25)', () => {
    expect(dayKey('2026-10-24T22:30:00Z')).toBe('2026-10-25'); // 00:30 CEST
    expect(dayKey('2026-10-25T23:30:00Z')).toBe('2026-10-26'); // 00:30 CET
    expect(kickoffTime('2026-10-25T19:00:00Z')).toBe('20:00'); // CET after the change
  });
});
