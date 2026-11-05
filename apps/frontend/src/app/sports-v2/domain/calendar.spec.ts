import { addDays, dayKey, dayLabel, isDayKey, kickoffTime, madridInstant, timezoneLabel } from './calendar';

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
