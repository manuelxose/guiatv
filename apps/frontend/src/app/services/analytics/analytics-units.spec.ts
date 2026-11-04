import { extractUtm, isValidEventType, sanitizeData, sanitizePath, sanitizeReferrer } from './analytics-sanitize';
import { AnalyticsQueue } from './analytics-queue';
import { parseConsentCookie, readCookie } from './consent.service';
import { classifyDevice } from '../device-detector.service';

describe('analytics sanitisation', () => {
  it('keeps only the pathname and redacts personal segments', () => {
    expect(sanitizePath('/buscar?q=juan%40mail.com#x')).toBe('/buscar');
    expect(sanitizePath('/perfil/64f0c2a9e1b2c3d4e5f60718')).toBe('/perfil/:usuario');
    expect(sanitizePath('/reset/abcdefABCDEF0123456789abcdefABCDEF01')).toBe('/reset/:redacted');
    expect(sanitizePath('/series/la-casa-de-papel-temporada-5-capitulo-final')).toBe('/series/la-casa-de-papel-temporada-5-capitulo-final');
    const start = performance.now();
    sanitizePath('/' + 'a'.repeat(60_000) + '@');
    sanitizeData({ t: 'a'.repeat(60_000) + '@' + 'b'.repeat(60_000) });
    expect(performance.now() - start).toBeLessThan(100);
    expect(sanitizePath('/x/juan%40mail.com')).toBe('/x/:redacted');
    expect(sanitizePath('/contenido/program:20261104_antena_3_20261104210000')).toBe('/contenido/program:20261104_antena_3_20261104210000');
    expect(sanitizePath('/admin/analytics')).toBeNull();
    expect(sanitizePath('/embed/programacion')).toBeNull();
    expect(sanitizePath('/' + 'a/'.repeat(400))!.length).toBeLessThanOrEqual(300);
  });

  it('reduces referrers to an external host', () => {
    expect(sanitizeReferrer('https://www.google.com/search?q=private', 'guiaprogramaciontv.com')).toBe('www.google.com');
    expect(sanitizeReferrer('https://guiaprogramaciontv.com/canales', 'guiaprogramaciontv.com')).toBeUndefined();
    expect(sanitizeReferrer('android-app://com.x', 'guiaprogramaciontv.com')).toBeUndefined();
  });

  it('extracts safe utm values only', () => {
    expect(extractUtm('?utm_source=newsletter&utm_medium=email&email=a@b.c')).toEqual({ source: 'newsletter', medium: 'email' });
    expect(extractUtm('?utm_source=a@b.com')).toBeUndefined();
  });

  it('bounds event data and redacts e-mails and long numbers', () => {
    const data = sanitizeData({ ok: 'x', email: 'me@example.com', phone: 'call 612345678', 'bad key': 1, nested: { a: 1, deep: { b: 2 } }, n: Infinity, many: Array.from({ length: 30 }, (_, i) => i) })!;
    expect(data['ok']).toBe('x');
    expect(data['email']).toBe('[redacted]');
    expect(data['phone']).toBe('[redacted]');
    expect('bad key' in data).toBeFalse();
    expect(data['nested']).toEqual({ a: 1 });
    expect('n' in data).toBeFalse();
    expect((data['many'] as unknown[]).length).toBe(10);
    expect(isValidEventType('page_view')).toBeTrue();
    expect(isValidEventType('Page View')).toBeFalse();
  });
});

describe('AnalyticsQueue', () => {
  const ev = (i: number) => ({ eventId: String(i), type: 'click', occurredAt: '' });
  it('drops oldest events beyond the limit and counts them', () => {
    const queue = new AnalyticsQueue({ maxEvents: 3, maxBatch: 2, maxAttempts: 2 });
    for (let i = 0; i < 5; i++) queue.push(ev(i));
    expect(queue.size).toBe(3);
    expect(queue.dropped).toBe(2);
    expect(queue.take().map((e) => e.eventId)).toEqual(['2', '3']);
  });
  it('requeues failures at the front and gives up after maxAttempts', () => {
    const queue = new AnalyticsQueue({ maxEvents: 10, maxBatch: 5, maxAttempts: 2 });
    queue.push(ev(1));
    queue.push(ev(2));
    const batch = queue.take();
    queue.push(ev(3));
    queue.requeue(batch);
    expect(queue.take().map((e) => e.eventId)).toEqual(['1', '2', '3']);
    queue.requeue([{ ...ev(9), attempts: 1 }]);
    expect(queue.size).toBe(0);
    expect(queue.dropped).toBe(1);
  });
});

describe('consent cookie', () => {
  const now = Date.UTC(2026, 10, 4);
  it('parses granted / denied and rejects malformed, future or expired values', () => {
    expect(parseConsentCookie(`v1.a1.${now - 1000}`, now)).toBe('granted');
    expect(parseConsentCookie(`v1.a0.${now - 1000}`, now)).toBe('denied');
    expect(parseConsentCookie('yes', now)).toBe('unset');
    expect(parseConsentCookie(`v2.a1.${now}`, now)).toBe('unset');
    expect(parseConsentCookie(`v1.a1.${now - 400 * 86_400_000}`, now)).toBe('unset');
    expect(parseConsentCookie(`v1.a1.${now + 3 * 86_400_000}`, now)).toBe('unset');
    expect(readCookie('a=1; cookie_consent=v1.a1.123; b=2', 'cookie_consent')).toBe('v1.a1.123');
  });
});

describe('classifyDevice', () => {
  it('classifies the Android fixture (screen 407x904, viewport 406x724) as mobile portrait', () => {
    const result = classifyDevice({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      screenWidth: 407, screenHeight: 904, viewportWidth: 406, viewportHeight: 724, maxTouchPoints: 5, coarsePointer: true,
    });
    expect(result).toEqual({ type: 'mobile', orientation: 'portrait', isTouchDevice: true });
  });
  it('keeps class and orientation independent', () => {
    expect(classifyDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', viewportWidth: 800, viewportHeight: 360 })).toEqual({ type: 'mobile', orientation: 'landscape', isTouchDevice: true });
    expect(classifyDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141', viewportWidth: 400, viewportHeight: 900 }).type).toBe('desktop');
    expect(classifyDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 5 }).type).toBe('tablet');
    expect(classifyDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/141 Safari/537.36' }).type).toBe('tablet');
    expect(classifyDevice({ userAgent: 'x', uaMobile: true }).type).toBe('mobile');
  });
});
