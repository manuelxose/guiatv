import { Match } from '../domain/models';
import { IDLE_INTERVAL_MS, LIVE_INTERVAL_MS, LivePoller, MAX_BACKOFF_MS, MAX_FAILURES, nextPollDelay } from './live-poller';

const NOW = Date.parse('2026-11-05T20:00:00Z');
const m = (status: Match['status'], offsetMin: number): Match => ({ slug: `m${status}${offsetMin}`, competitionSlug: 'c', homeSlug: 'a', awaySlug: 'b', status, kickoff: new Date(NOW + offsetMin * 60_000).toISOString(), events: [], stats: [], broadcasts: [] });

describe('nextPollDelay', () => {
  it('polls fast while anything is live', () => expect(nextPollDelay([m('live', -50)], NOW)).toBe(LIVE_INTERVAL_MS));
  it('polls fast around kickoff, before and after', () => {
    expect(nextPollDelay([m('scheduled', 15)], NOW)).toBe(LIVE_INTERVAL_MS);
    expect(nextPollDelay([m('scheduled', -10)], NOW)).toBe(LIVE_INTERVAL_MS);
  });
  it('polls slowly when a match is due within three hours', () => expect(nextPollDelay([m('scheduled', 120)], NOW)).toBe(IDLE_INTERVAL_MS));
  it('does not poll when nothing is near or live', () => {
    expect(nextPollDelay([m('scheduled', 600), m('finished', -300)], NOW)).toBeNull();
    expect(nextPollDelay([], NOW)).toBeNull();
  });
  it('backs off exponentially, capped, and stops after repeated failures', () => {
    expect(nextPollDelay([m('live', -5)], NOW, 1)).toBe(LIVE_INTERVAL_MS * 2);
    expect(nextPollDelay([m('live', -5)], NOW, 4)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay([m('live', -5)], NOW, MAX_FAILURES)).toBeNull();
  });
});

describe('LivePoller', () => {
  class FakeDoc {
    hidden = false;
    private l: Array<() => void> = [];
    addEventListener(_: string, f: () => void) { this.l.push(f); }
    removeEventListener(_: string, f: () => void) { this.l = this.l.filter((x) => x !== f); }
    set(h: boolean) { this.hidden = h; this.l.forEach((f) => f()); }
    get listeners() { return this.l.length; }
  }
  let doc: FakeDoc;
  let now: number;
  let polls: number;
  let fail: boolean;
  let failures: number[];
  let resumed: number;
  const make = (delay: (f: number) => number | null = () => 1000) =>
    new LivePoller({ delay, poll: async () => { polls++; if (fail) throw new Error('x'); }, onFailure: (n) => failures.push(n), onResume: () => resumed++ }, doc as unknown as Document, () => now);

  beforeEach(() => { jasmine.clock().install(); doc = new FakeDoc(); now = 0; polls = 0; fail = false; failures = []; resumed = 0; });
  afterEach(() => jasmine.clock().uninstall());
  const tick = async (ms: number) => { now += ms; jasmine.clock().tick(ms); await Promise.resolve(); await Promise.resolve(); };

  it('polls on the cadence with a single timer and stops cleanly', async () => {
    const p = make(); p.start();
    await tick(1000); await tick(1000);
    expect(polls).toBe(2);
    p.stop();
    await tick(5000);
    expect(polls).toBe(2);
    expect(doc.listeners).toBe(0);
  });

  it('does not poll at all when the cadence says null', async () => {
    const p = make(() => null); p.start(); await tick(60_000);
    expect(polls).toBe(0); p.stop();
  });

  it('pauses while hidden and catches up once visible', async () => {
    const p = make(); p.start();
    doc.set(true); await tick(10_000);
    expect(polls).toBe(0);
    doc.set(false); await tick(0);
    expect(resumed).toBe(1);
    expect(polls).toBe(1);
    p.stop();
  });

  it('reports failures with a growing count and gives up when the cadence returns null', async () => {
    fail = true;
    const p = make((f) => (f >= 3 ? null : 1000)); p.start();
    for (let i = 0; i < 6; i++) await tick(1000);
    expect(failures).toEqual([1, 2, 3]);
    expect(polls).toBe(3);
    p.stop();
  });

  it('starts the cadence when data arrives after start, without postponing a pending timer', async () => {
    let d: number | null = null;
    const p = make(() => d);
    p.start();
    await tick(60_000);
    expect(polls).toBe(0);
    d = 1000;
    p.reschedule();
    await tick(900);
    p.reschedule(); // must not push the pending poll back
    await tick(100);
    expect(polls).toBe(1);
    p.stop();
  });

  it('start is idempotent: one listener, no duplicate loops', async () => {
    const p = make(); p.start(); p.start();
    expect(doc.listeners).toBe(1);
    await tick(1000);
    expect(polls).toBe(1);
    p.stop();
  });
});
