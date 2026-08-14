import { describe, expect, it } from 'vitest';
import { LogStoreUnavailable, createLogStore, fromExport, toExport } from './logbook';
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
  sightings: { whales: 2, sharks: 1 },
  ...over,
});

/**
 * The export is the durability answer that needs no server: the logbook becomes
 * a file the player keeps. Which means it comes back from outside this program,
 * possibly edited, truncated, or something else that happens to end in .json.
 */
describe('logbook export', () => {
  /**
   * The type and not the wording. The caller has to tell "the store never
   * opened" from "this write failed" -- the two get very different treatment in
   * the UI -- and a rule matched on prose is one someone breaks by rewording an
   * error message, which is what happened here.
   */
  it('rejects as unavailable, not silently, when the browser has no IndexedDB', async () => {
    await expect(createLogStore().add(record())).rejects.toBeInstanceOf(LogStoreUnavailable);
  });

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

  it('refuses a version it has never seen', () => {
    // Stamped on the way out, so it has to be read on the way in: accepting an
    // unknown version means guessing at a shape written by a later program.
    const good = JSON.parse(JSON.stringify(toExport([record()], 0)));
    expect(fromExport(JSON.stringify(good))).toHaveLength(1);
    expect(fromExport(JSON.stringify({ ...good, version: 99 }))).toBeNull();
    expect(fromExport(JSON.stringify({ ...good, version: undefined }))).toBeNull();
    expect(fromExport(JSON.stringify({ ...good, version: 0 }))).toBeNull();
  });

  /**
   * The other half of the version rule, and the half that costs a player
   * something if it is got wrong: a file exported before `sightings` existed is
   * still their logbook. Refusing it -- which an equality check on the version
   * does the moment the version moves -- throws it away.
   */
  it('still reads a file exported by an older version of itself', () => {
    const old = {
      format: 'voyage-logbook',
      version: 1,
      exportedAt: 0,
      passages: [record({ sightings: undefined })],
    };
    const [p] = fromExport(JSON.stringify(old))!;
    expect(p.distance).toBe(1840);
    // And is not made to claim it saw nothing, which it never said.
    expect(p.sightings).toBeUndefined();
  });

  it('carries what was sighted through a round trip', () => {
    const [p] = fromExport(JSON.stringify(toExport([record()], 0)))!;
    expect(p.sightings).toEqual({ whales: 2, sharks: 1 });
  });

  /**
   * A sighting is a thing that happened or did not. Every other number in a
   * record is a measurement and may legitimately be fractional, so the existing
   * guard lets 2.5 through -- which would put two and a half whales in a
   * logbook.
   */
  it('refuses a count of animals that is not a whole number of animals', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 2,
      exportedAt: 0,
      passages: [record({ sightings: { whales: 2.5, sharks: -3 } as never })],
    });
    const [p] = fromExport(raw)!;
    expect(p.sightings).toEqual({ whales: 2, sharks: 0 });
  });

  it('keeps one record per id, so a duplicate cannot overwrite its neighbour', () => {
    // Imported with sequential puts, a repeated id would silently replace the
    // record before it and the import would claim more than it stored.
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 1,
      exportedAt: 0,
      passages: [record(), record({ distance: 99 }), record({ id: 'p2' })],
    });
    const rows = fromExport(raw)!;
    expect(rows).toHaveLength(2);
    expect(rows[0].distance).toBe(1840); // the first one won, not the last
  });

  it('refuses distances and durations no passage could have', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 1,
      exportedAt: 0,
      passages: [record({ duration: -600, distance: -1840, avgSog: -3, to: { x: -50, y: -900 } })],
    });
    const [p] = fromExport(raw)!;
    expect(p.duration).toBe(0);
    expect(p.distance).toBe(0);
    expect(p.avgSog).toBe(0);
    // Coordinates are signed and must survive: half the world is negative.
    expect(p.to).toEqual({ x: -50, y: -900 });
  });

  it('stamps a format and a version so a later one can tell them apart', () => {
    const e = toExport([], 999);
    expect(e.format).toBe('voyage-logbook');
    expect(e.version).toBeGreaterThan(0);
    expect(e.exportedAt).toBe(999);
  });
});
