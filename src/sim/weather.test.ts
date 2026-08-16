import { describe, expect, it } from 'vitest';
import { FLASH_TIME, Weather, WEATHER_KINDS, flashAt } from './weather';
import { skyState } from './sky';
/** The default time scale: a second of play is a minute of world time. */
const SCALE = 60;

describe('weather', () => {
  it('replays exactly from a seed', () => {
    const a = new Weather(5);
    const b = new Weather(5);
    for (let i = 0; i < 4000; i++) {
      a.update(1, SCALE);
      b.update(1, SCALE);
    }
    expect(a.state).toEqual(b.state);
  });

  it('changes on its own but never teleports', () => {
    const w = new Weather(17);
    const seen = new Set<string>();
    let prevWind = w.state.windScale;
    for (let i = 0; i < 8000; i++) {
      w.update(1, SCALE);
      seen.add(w.state.kind);
      // One second must never move the wind more than a few per cent.
      expect(Math.abs(w.state.windScale - prevWind)).toBeLessThan(0.05);
      prevWind = w.state.windScale;
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  /**
   * Locks down the bug this was written to fix: the dwell times are world time,
   * but they were being counted down in wall-clock seconds. The sun crossed the
   * whole sky in twenty minutes of play while the weather sat on 'fair', so the
   * one system that was supposed to make two races differ never did anything.
   */
  it('turns several times over a sailing session, not once an hour of play', () => {
    // Averaged over seeds on purpose. Any single one can roll the condition it
    // is already in twice running and sit still for ten minutes, which is
    // weather being weather, not the bug this is guarding.
    const counts = [];
    for (let seed = 1; seed <= 12; seed++) {
      const w = new Weather(seed);
      let changes = 0;
      let prev = w.state.kind;
      // Ten minutes of play at the default time scale.
      for (let i = 0; i < 600; i++) {
        w.update(1, SCALE);
        if (w.state.kind !== prev) changes++;
        prev = w.state.kind;
      }
      counts.push(changes);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(2);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });

  it('holds still when world time does', () => {
    const w = new Weather(11);
    const kind = w.state.kind;
    for (let i = 0; i < 5000; i++) w.update(1, 0);
    expect(w.state.kind).toBe(kind);
  });

  /**
   * The seed names the whole world. Rolling a new one for each race rolled the
   * islands and left the weather running on from the last race, so pinning a
   * seed reproduced the land and not the day's sailing.
   */
  it('replays the same weather from a reseed, whatever came before', () => {
    const a = new Weather(1);
    const b = new Weather(2);
    for (let i = 0; i < 900; i++) b.update(1, SCALE); // a different past
    a.reseed(4242);
    b.reseed(4242);
    expect(a.state).toEqual(b.state);
    for (let i = 0; i < 900; i++) {
      a.update(1, SCALE);
      b.update(1, SCALE);
    }
    expect(a.state).toEqual(b.state);
  });

  it('opens in a condition you would set out in', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = new Weather(7);
      w.reseed(seed);
      expect(['clear', 'fair', 'overcast']).toContain(w.state.kind);
    }
  });

  it('can be pinned to one condition', () => {
    const w = new Weather(3);
    w.evolve = false;
    w.set('fog');
    for (let i = 0; i < 5000; i++) w.update(1, SCALE);
    expect(w.state.kind).toBe('fog');
    expect(w.visibility).toBeLessThan(400);
  });

  it('keeps visibility and wind within sane bounds in every condition', () => {
    for (const kind of WEATHER_KINDS) {
      const w = new Weather(1, kind);
      w.evolve = false;
      for (let i = 0; i < 2000; i++) w.update(1);
      expect(w.visibility).toBeGreaterThan(80);
      expect(w.state.windScale).toBeGreaterThan(0.4);
      expect(w.state.windScale).toBeLessThan(2.2);
    }
  });
});

/**
 * The bug this locks down: for most of this project's life the weather could
 * not produce rain with the sun out. Every wet condition sat at 0.95 cover or
 * above, and `rain` eased away faster than `cloud`, so the drops were always
 * gone before the sky opened. Measured over thirty simulated days it happened
 * for a total of one minute out of 720 hours, and both times as an accident on
 * the leading edge of a front rather than as anything you could sail into.
 *
 * `shower` is what makes it a condition the model can actually produce, and
 * this asserts it stayed one.
 */
describe('sunlit showers', () => {
  it('puts drops in the air with the sun out often enough to matter', () => {
    let daylight = 0;
    let wet = 0;
    // Thirty simulated days, sampled every ten seconds of world time.
    for (let seed = 1; seed <= 6; seed++) {
      const w = new Weather(seed);
      let hour = 8;
      for (let i = 0; i < 43200; i++) {
        w.update(10 / SCALE, 10);
        hour += 10 / 3600;
        const sun = skyState(hour).sunElevation;
        if (sun <= 0) continue;
        daylight++;
        if (w.state.rain > 0.15 && w.state.cloud < 0.72) wet++;
      }
    }
    // Rare, and not so rare that it never happens: a sunlit shower is an
    // occasion, and if this ever reads zero again it has stopped being one.
    expect(wet / daylight).toBeGreaterThan(0.01);
    expect(wet / daylight).toBeLessThan(0.2);
  });

  it('does not leave the sun out in a downpour', () => {
    // The other half of the same property: heavy rain must stay overcast, or
    // the sky would be bright through a squall.
    const w = new Weather(3, 'squall');
    w.evolve = false;
    for (let i = 0; i < 2000; i++) w.update(1);
    expect(w.state.cloud).toBeGreaterThan(0.9);
    expect(w.state.rain).toBeGreaterThan(0.8);
  });
});

/**
 * Lightning: a squall's own light and noise.
 *
 * The properties, not the numbers. Whether a bolt *looks* right is settled by
 * watching one; what a retune must not break is that it only happens in
 * weather that could throw it, that the same seed throws the same storm, that
 * the flash stutters rather than fading, and that it runs on the clock the
 * player watches rather than the world's.
 */
describe('lightning', () => {
  /** Drive real seconds, and report every bolt that struck. */
  function storm(w: Weather, seconds: number, dt = 1 / 60, timeScale = 1) {
    const bolts: { distance: number; power: number; at: number }[] = [];
    for (let t = 0; t < seconds; t += dt) {
      w.update(dt, dt * timeScale);
      if (w.state.struck && w.state.lightning) {
        bolts.push({ distance: w.state.lightning.distance, power: w.state.lightning.power, at: t });
      }
    }
    return bolts;
  }

  it('throws bolts in a squall', () => {
    const w = new Weather(7, 'squall');
    w.evolve = false;
    expect(storm(w, 300).length).toBeGreaterThan(4);
  });

  it('throws none in fair weather, however long it stands', () => {
    const w = new Weather(7, 'fair');
    w.evolve = false;
    expect(storm(w, 900)).toEqual([]);
  });

  it('crackles harder in a squall than in steady rain', () => {
    const squall = new Weather(11, 'squall');
    const rain = new Weather(11, 'rain');
    squall.evolve = false;
    rain.evolve = false;
    expect(storm(squall, 600).length).toBeGreaterThan(storm(rain, 600).length);
  });

  it('is the same storm from the same seed, and another from another', () => {
    const a = new Weather(23, 'squall');
    const b = new Weather(23, 'squall');
    const c = new Weather(24, 'squall');
    a.evolve = b.evolve = c.evolve = false;
    const sa = storm(a, 400);
    expect(storm(b, 400)).toEqual(sa);
    expect(storm(c, 400)).not.toEqual(sa);
  });

  /**
   * The clock rule, and the reason it matters: at 60x a storm scheduled on
   * world time would throw a minute of bolts every second of play.
   */
  it('keeps its rate on real seconds, whatever the time scale', () => {
    const slow = new Weather(31, 'squall');
    const fast = new Weather(31, 'squall');
    slow.evolve = false;
    fast.evolve = false;
    expect(storm(fast, 300, 1 / 60, 60).length).toBe(storm(slow, 300, 1 / 60, 1).length);
  });

  it('flashes in pulses and is out within FLASH_TIME', () => {
    // A single decay would be a light coming on; the stutter is the bolt.
    // Sampled densely enough to see the second pulse rise after the first
    // has fallen -- which is the whole claim.
    let rises = 0;
    let prev = flashAt(0, 1);
    let falling = false;
    for (let age = 0.001; age <= FLASH_TIME; age += 0.002) {
      const v = flashAt(age, 1);
      if (v < prev) falling = true;
      else if (falling && v > prev) {
        rises++;
        falling = false;
      }
      prev = v;
    }
    expect(rises).toBeGreaterThanOrEqual(2);
    expect(flashAt(FLASH_TIME + 0.001, 1)).toBe(0);
    expect(flashAt(-0.1, 1)).toBe(0);
  });

  it('puts most of the storm on the horizon and few bolts close aboard', () => {
    const w = new Weather(97, 'squall');
    w.evolve = false;
    const bolts = storm(w, 4000);
    expect(bolts.length).toBeGreaterThan(50);
    const near = bolts.filter((b) => b.distance < 3000).length / bolts.length;
    // Written out because it is the claim: a squall that struck within three
    // kilometres a third of the time would be a lightning field, not weather.
    expect(near).toBeLessThan(0.25);
    expect(bolts.every((b) => b.distance >= 400 && b.distance <= 14000)).toBe(true);
  });
});

/**
 * What a review found the first cut of the lightning getting wrong. Each of
 * these is a bug that was measured, not a hypothetical.
 */
describe('lightning, on second look', () => {
  it('does not disturb the weather a pinned seed already had', () => {
    // The regression that matters most: lightning drawing from the weather's
    // own stream moved seed 1's first rolled front by more than half an hour
    // of world time, so every pinned world would quietly have become a
    // different world the day this landed.
    //
    // The control is `dt = 0` with world time still running: the lightning
    // clock is real seconds, so it never ticks and no bolt is ever thrown,
    // while the weather rolls exactly as it would have. Same seed, same
    // fronts, whether or not the sky was throwing lightning the whole time.
    const fronts = (lightning: boolean) => {
      const w = new Weather(1, 'squall');
      const out: string[] = [];
      let prev = w.state.kind;
      let bolts = 0;
      for (let t = 0; t < 9000; t += 1 / 60) {
        w.update(lightning ? 1 / 60 : 0, 1 / 60);
        if (w.state.struck) bolts++;
        if (w.state.kind !== prev) {
          out.push(`${w.state.kind}@${t.toFixed(1)}`);
          prev = w.state.kind;
        }
      }
      return { out, bolts };
    };
    const stormy = fronts(true);
    const quiet = fronts(false);
    // The control really is quiet, and the storm really did throw bolts --
    // otherwise this compares two identical runs and proves nothing.
    expect(quiet.bolts).toBe(0);
    expect(stormy.bolts).toBeGreaterThan(20);
    expect(stormy.out.length).toBeGreaterThan(1);
    expect(stormy.out).toEqual(quiet.out);
  });

  it('clears the sky when the weather is set or reseeded', () => {
    const w = new Weather(3, 'squall');
    w.evolve = false;
    for (let t = 0; t < 400 && w.state.flash === 0; t += 1 / 60) w.update(1 / 60, 1 / 60);
    expect(w.state.flash).toBeGreaterThan(0);
    w.set('fair');
    expect(w.state.flash).toBe(0);
    expect(w.state.lightning).toBeNull();
  });

  it('lets a stroke finish instead of being cut short by the next', () => {
    // Exponential intervals put pairs inside one flash -- measured 0.27 s
    // apart on seed 1 -- and the second used to replace the first.
    const w = new Weather(1, 'squall');
    w.evolve = false;
    let cutShort = 0;
    let prevAge = 0;
    let had = false;
    for (let t = 0; t < 900; t += 1 / 60) {
      w.update(1 / 60, 1 / 60);
      const age = w.state.lightning?.age ?? 0;
      // A bolt whose age went backwards without the old one having finished
      // is one that was overwritten mid-flash.
      if (had && age < prevAge && prevAge < FLASH_TIME - 0.02) cutShort++;
      had = w.state.lightning !== null;
      prevAge = age;
    }
    expect(cutShort).toBe(0);
  });

  it('fades to nothing rather than stepping off the end', () => {
    // A stroke still carried 1.5% of full brightness at FLASH_TIME, and the
    // step from there to zero is a blink at the end of every bolt.
    expect(flashAt(FLASH_TIME, 1)).toBe(0);
    expect(flashAt(FLASH_TIME - 0.02, 1)).toBeGreaterThan(0);
    // And the helper cannot be talked into an out-of-range answer.
    expect(flashAt(0, 5)).toBeLessThanOrEqual(1);
    expect(flashAt(NaN, 1)).toBe(0);
  });
});
