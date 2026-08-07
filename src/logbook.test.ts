import { describe, expect, it } from 'vitest';
import { fromExport, toExport } from './logbook';
import type { PassageRecord } from './sim/passage';

const record = (over: Partial<PassageRecord> = {}): PassageRecord => ({
  id: 'p1',
  startedAt: 1_700_000_000_000,
  duration: 612,
  distance: 1840,
  from: { x: 0, y: 0 },
  to: { x: 10, y: 1200 },
  direct: 1200,
  avgSog: 3.01,
  maxSog: 4.2,
  venue: 'sf',
  windKnots: 18.4,
  ...over,
});

/**
 * The export is the durability answer that needs no server: the logbook becomes
 * a file the player keeps. Which means it comes back from outside this program,
 * possibly edited, truncated, or something else that happens to end in .json.
 */
describe('logbook export', () => {
  it('survives a round trip unchanged', () => {
    const passages = [record(), record({ id: 'p2', venue: '' })];
    const back = fromExport(JSON.stringify(toExport(passages, 123)));
    expect(back).toEqual(passages);
  });

  it('refuses a file that is not a logbook', () => {
    expect(fromExport('not json at all')).toBeNull();
    expect(fromExport('{}')).toBeNull();
    expect(fromExport(JSON.stringify({ format: 'something-else', passages: [] }))).toBeNull();
    // The right stamp but the wrong shape underneath.
    expect(fromExport(JSON.stringify({ format: 'voyage-logbook', passages: 'lots' }))).toBeNull();
  });

  it('drops entries with no id rather than importing half a record', () => {
    // The id is what a sync layer would key on, so a record without one is not
    // a passage that lost a field, it is not a passage.
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 1,
      exportedAt: 0,
      passages: [record(), { duration: 10 }, record({ id: '' })],
    });
    expect(fromExport(raw)).toHaveLength(1);
  });

  it('replaces missing and nonsense numbers rather than carrying NaN into the log', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 1,
      exportedAt: 0,
      passages: [{ id: 'x', duration: 'ages', distance: null, from: { x: 3 } }],
    });
    const [p] = fromExport(raw)!;
    expect(p.duration).toBe(0);
    expect(p.distance).toBe(0);
    // A half-written position is still a position, and a NaN in it would put a
    // marker nowhere at all on the chart.
    expect(p.from).toEqual({ x: 3, y: 0 });
    expect(p.to).toEqual({ x: 0, y: 0 });
    expect(p.venue).toBe('');
  });

  it('stamps a format and a version so a later one can tell them apart', () => {
    const e = toExport([], 999);
    expect(e.format).toBe('voyage-logbook');
    expect(e.version).toBeGreaterThan(0);
    expect(e.exportedAt).toBe(999);
  });
});
