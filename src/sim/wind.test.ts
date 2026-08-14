import { describe, expect, it } from 'vitest';
import { ADVECTION, WindField } from './wind';
import { sailPlan } from './sailplan';
import { CRUISER } from './config';
import { knotsToMs } from './units';
import { DEG } from './math';

describe('wind field', () => {
  /**
   * The advection used to be `baseTws * ADVECTION * elapsed`, which applies the
   * wind speed of this instant to the entire history. While the mean wind never
   * moved that was the same answer; once the weather started turning inside a
   * session it meant that half an hour in, a squall swept the whole puff field
   * past the boat at about 590 knots.
   */
  it('carries the puffs at the wind that blew, not the wind that is blowing', () => {
    const w = new WindField(knotsToMs(12), 0, 0.5, 0.2, 99);
    for (let i = 0; i < 1800 * 4; i++) w.update(0.25); // half an hour out
    const before = w.sample({ x: 0, y: 0 }).gust;

    w.baseTws = knotsToMs(21); // a squall arrives
    w.update(0.25);
    const after = w.sample({ x: 0, y: 0 }).gust;

    // A quarter of a second moves the pattern a couple of metres, so the wind
    // at a fixed point can barely have changed. Re-advecting the history put
    // six kilometres of different water there instead.
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  /**
   * The renderer draws the puffs the player steers by, using the same function
   * the physics samples. If it were not a pure function of position and time,
   * the visible puff and the felt puff would drift apart and the tactical layer
   * of the game would be a lie.
   */
  it('is a deterministic function of position and time', () => {
    const a = new WindField(knotsToMs(14), 0, 0.5, 0.2, 99);
    const b = new WindField(knotsToMs(14), 0, 0.5, 0.2, 99);
    a.update(7.5);
    b.update(7.5);
    for (const p of [
      { x: 0, y: 0 },
      { x: 123, y: -456 },
      { x: -900, y: 12 },
    ]) {
      expect(a.sample(p)).toEqual(b.sample(p));
    }
  });

  it('keeps gusts and shifts within a sane band', () => {
    const w = new WindField(knotsToMs(14), 0, 1, 0.25, 7);
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 400; t += 3) {
      w.update(3);
      for (let x = -800; x <= 800; x += 137) {
        const s = w.sample({ x, y: x * 0.7 });
        min = Math.min(min, s.gust);
        max = Math.max(max, s.gust);
        expect(Math.abs(s.shift)).toBeLessThanOrEqual(0.25 + 1e-9);
        expect(s.tws).toBeGreaterThan(0);
      }
    }
    // Real wind gusts harder than it lulls, but never reverses or doubles.
    expect(min).toBeGreaterThan(0.5);
    expect(max).toBeLessThan(1.6);
  });

  it('carries the puff pattern downwind over time', () => {
    const w = new WindField(knotsToMs(20), 0, 0.6, 0.2, 3);
    const here = { x: 0, y: 0 };
    const before = w.sample(here).gust;
    w.update(30);
    expect(w.sample(here).gust).not.toBeCloseTo(before, 3);
  });
});

describe('sail plan', () => {
  /**
   * Reefing is not just an area change. It moves the centre of effort, which
   * is what forces the player to reduce main and jib together instead of
   * dumping the mainsail alone.
   */
  it('moves the centre of effort forward when the main is reefed', () => {
    const full = sailPlan(CRUISER, 0, 0);
    const reefed = sailPlan(CRUISER, 3, 0);
    expect(reefed.area).toBeLessThan(full.area);
    expect(reefed.ceX).toBeGreaterThan(full.ceX); // forward = more lee helm
    expect(reefed.ceHeight).toBeLessThan(full.ceHeight); // and lower = less heel
  });

  it('moves the centre of effort aft when the jib is furled', () => {
    const full = sailPlan(CRUISER, 0, 0);
    const furled = sailPlan(CRUISER, 0, 1);
    expect(furled.ceX).toBeLessThan(full.ceX); // aft = more weather helm
  });

  it('survives a bare-poles plan without dividing by zero', () => {
    const bare = sailPlan(CRUISER, 3, 1);
    const none = sailPlan({ ...CRUISER, mainArea: 0, jibArea: 0 }, 0, 1);
    expect(Number.isFinite(bare.ceX)).toBe(true);
    expect(none.area).toBe(0);
    expect(Number.isFinite(none.ceHeight)).toBe(true);
  });
});

describe('the seed places the pattern', () => {
  /**
   * The regression this locks down: `WindField`'s seed argument has a default
   * and the engine was not passing it, so every session ever sailed had the
   * same puff in the same place. In a surveyed region, where the land cannot
   * vary, that left the seed with nothing to change but the weather's rolls.
   */
  const patch = (seed: number) => {
    const w = new WindField(knotsToMs(14), 0, 0.5, undefined, seed);
    w.update(30);
    const out: number[] = [];
    for (let y = -500; y <= 500; y += 100)
      for (let x = -500; x <= 500; x += 100) out.push(w.sample({ x, y }).gust);
    return out;
  };
  const rms = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);

  it('gives the same sea for the same seed', () => {
    expect(rms(patch(20260806), patch(20260806))).toBe(0);
  });

  it('gives a different sea for a different seed', () => {
    // A tenth of the mean wind, against gusts that span about 0.88 to 1.17:
    // this is a different pattern, not the same one nudged.
    expect(rms(patch(20260806), patch(777))).toBeGreaterThan(0.02);
  });

  it('reseeds in place, so a new session is a new sea', () => {
    const w = new WindField(knotsToMs(14), 0, 0.5, undefined, 20260806);
    w.update(30);
    const before = w.sample({ x: 100, y: 100 }).gust;
    w.reseed(777);
    w.update(30);
    expect(w.sample({ x: 100, y: 100 }).gust).not.toBe(before);
  });
});

/**
 * Reading the water ahead, which is the thing a helmsman actually does and the
 * whole reason the puff pattern is a fixed field rather than noise in time.
 */
describe('the wind that is coming', () => {
  const field = () => new WindField(knotsToMs(14), 40 * DEG, 0.6, 0.2, 20260814);

  it('is the wind here now, when asked for no lead at all', () => {
    const wind = field();
    const at = { x: 210, y: -140 };
    expect(wind.sample(at, 0)).toEqual(wind.sample(at));
  });

  /**
   * The property that makes it a forecast rather than a guess: what it says
   * will arrive is exactly what does arrive. Driven by running the field
   * forward and asking again, so the assertion is against the simulation and
   * not against a second copy of the formula.
   *
   * Both channels, because they are carried at different rates -- the shift
   * pattern at 0.55 of the gust pattern's -- and a lead applied at one rate to
   * both would forecast two different moments.
   */
  it('says what will actually arrive, gust and shift alike', () => {
    const wind = field();
    const at = { x: -80, y: 260 };
    const seconds = 12;
    const forecast = wind.sample(at, seconds);
    for (let i = 0; i < seconds * 120; i++) wind.update(1 / 120);
    const arrived = wind.sample(at);
    expect(arrived.gust).toBeCloseTo(forecast.gust, 9);
    expect(arrived.shift).toBeCloseTo(forecast.shift, 9);
  });

  /**
   * It looks upwind and not down. Getting this backwards would report the wind
   * that has already gone past, which is worse than no forecast: it would be
   * consistently wrong in a way that still looked like information.
   */
  it('looks upwind, so a forecast is not a memory', () => {
    const wind = field();
    const at = { x: 0, y: 0 };
    const seconds = 15;
    const forecast = wind.sample(at, seconds);
    // Where the air arriving in 15 s is now: upwind, by what the pattern
    // covers in that time. Written out rather than taken from the field, so
    // this is a claim about direction and not a restatement of the code.
    const carried = knotsToMs(14) * ADVECTION * seconds;
    const upwind = { x: at.x + Math.sin(40 * DEG) * carried, y: at.y + Math.cos(40 * DEG) * carried };
    expect(wind.sample(upwind).gust).toBeCloseTo(forecast.gust, 9);

    const downwind = { x: at.x - Math.sin(40 * DEG) * carried, y: at.y - Math.cos(40 * DEG) * carried };
    expect(wind.sample(downwind).gust).not.toBeCloseTo(forecast.gust, 3);
  });

  /**
   * The land shadow is a fact about where the boat is, not about where the air
   * came from, and the field has no idea where she will have sailed to. So a
   * forecast keeps the exposure it was asked at.
   */
  it('does not pretend to know where she will be, so the lee is not led', () => {
    const wind = field();
    const at = { x: 40, y: 40 };
    expect(wind.sample(at, 20).exposure).toBe(wind.sample(at).exposure);
  });
});
