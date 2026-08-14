import { describe, expect, it } from 'vitest';
import { EXPORT_VERSION, LogStoreUnavailable, createLogStore, fromExport, toExport } from './logbook';
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
  startHour: 5.2,
  endHour: 19.75,
  weather: 'fog',
  maxHeel: 0.48,
  maxSea: 2.4,
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
    // And a version between two real ones is not a version. A range test alone
    // read this as "not newer than the current", when in fact no program has
    // ever stamped it and it says nothing about the shape underneath.
    expect(fromExport(JSON.stringify({ ...good, version: EXPORT_VERSION - 0.5 }))).toBeNull();
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
  it('carries when it was and what it was like through a round trip', () => {
    const [p] = fromExport(JSON.stringify(toExport([record()], 0)))!;
    expect(p.startHour).toBe(5.2);
    expect(p.endHour).toBe(19.75);
    expect(p.weather).toBe('fog');
  });

  /**
   * Dropped rather than repaired, which is the opposite of what the distances
   * get. A negative distance has an honest correction and 30 o'clock does not
   * -- it is neither 24 nor 6 -- so a record that cannot say when it happened
   * says nothing instead of naming an hour nobody sailed in.
   */
  it('drops an hour that is not a time of day rather than bending it into one', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 3,
      exportedAt: 0,
      passages: [record({ startHour: 30, endHour: -2 })],
    });
    const [p] = fromExport(raw)!;
    expect(p.startHour).toBeUndefined();
    expect(p.endHour).toBeUndefined();
    // 24:00 is tomorrow's midnight, and the day is half open at that end.
    expect(fromExport(JSON.stringify({ ...JSON.parse(raw), passages: [record({ startHour: 24 })] }))![0].startHour).toBeUndefined();
    expect(fromExport(JSON.stringify({ ...JSON.parse(raw), passages: [record({ startHour: 0 })] }))![0].startHour).toBe(0);
  });

  /**
   * Checked against the list and not merely for being a string, because this
   * one is read back as a key: `WEATHER['drizzle']` is undefined, and handing
   * that to the translator renders nothing at all with no clue why.
   */
  /**
   * The one place absent and zero must not be conflated on the way in. A record
   * that predates the fields does not know how rough it was; one that carries a
   * zero is saying it was not rough at all, and filling the first in with the
   * second would invent a flat calm nobody sailed.
   */
  it('leaves an unrecorded roughness unrecorded, and clamps a recorded one', () => {
    const raw = (over: object) =>
      JSON.stringify({
        format: 'voyage-logbook',
        version: 4,
        exportedAt: 0,
        passages: [record(over)],
      });
    const absent = fromExport(raw({ maxHeel: undefined, maxSea: undefined }))![0];
    expect(absent.maxHeel).toBeUndefined();
    expect(absent.maxSea).toBeUndefined();
    const bent = fromExport(raw({ maxHeel: -1, maxSea: -3 }))![0];
    expect(bent.maxHeel).toBe(0);
    expect(bent.maxSea).toBe(0);
    expect(fromExport(raw({}))![0].maxSea).toBe(2.4);
  });

  it('drops a weather this program has never heard of', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 3,
      exportedAt: 0,
      passages: [record({ weather: 'drizzle' as never })],
    });
    expect(fromExport(raw)![0].weather).toBeUndefined();
  });

  it('rounds a count of animals down to whole animals, and drops a malformed one', () => {
    const raw = JSON.stringify({
      format: 'voyage-logbook',
      version: 2,
      exportedAt: 0,
      passages: [record({ sightings: { whales: 2.5, sharks: -3 } as never })],
    });
    const [p] = fromExport(raw)!;
    // Coerced rather than refused, which is this function's standing rule for a
    // number that is the wrong shape -- the same rule that turns a negative
    // distance into zero rather than throwing the record away.
    expect(p.sightings).toEqual({ whales: 2, sharks: 0 });
    // An object of the wrong *kind* is a different matter, and gets the answer
    // that keeps "saw nothing" and "does not say" apart. `typeof [] === 'object'`
    // let this through as a sighting of nothing.
    const asArray = JSON.stringify({
      ...JSON.parse(raw),
      passages: [record({ sightings: [] as never })],
    });
    expect(fromExport(asArray)![0].sightings).toBeUndefined();
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
