import { describe, expect, it } from 'vitest';
import { RAD, wrapPi } from './math';
import {
  MAX_WAVES,
  WaveField,
  dominantEncounter,
  seaBearing,
  waveHitStrength,
  windOverWater,
} from './waves';

/**
 * Wind from the north, so the waves travel south. Everything below is stated in
 * terms of the boat's heading against that.
 */
const sea = () => new WaveField(12, 0);

/** The biggest train's own frequency, which is what encounter is measured against. */
function ownOmega(w: WaveField): number {
  let best = w.comps[0];
  for (const c of w.comps) if (c.amp > best.amp) best = c;
  return best.omega;
}

describe('encounter frequency', () => {
  it('is the wave\'s own frequency when the boat is stopped', () => {
    const w = sea();
    expect(dominantEncounter(w, 0, 0, 0).omega).toBeCloseTo(ownOmega(w), 6);
  });

  /** Beating into a sea, the crests arrive faster than their own period. */
  it('rises beating into the sea', () => {
    const w = sea();
    // Heading north, into waves that are running south.
    expect(dominantEncounter(w, 0, 3, 0).omega).toBeGreaterThan(ownOmega(w));
  });

  /** Running with them, she chases and they arrive more slowly. */
  it('falls running with the sea', () => {
    const w = sea();
    expect(dominantEncounter(w, Math.PI, 3, 0).omega).toBeLessThan(ownOmega(w));
  });

  it('is unchanged beam on, where there is no closing speed along the train', () => {
    const w = sea();
    const east = dominantEncounter(w, Math.PI / 2, 3, 0).omega;
    const west = dominantEncounter(w, -Math.PI / 2, 3, 0).omega;
    expect(east).toBeCloseTo(ownOmega(w), 6);
    expect(west).toBeCloseTo(ownOmega(w), 6);
  });

  it('goes faster the harder she is driven to windward', () => {
    const w = sea();
    const slow = dominantEncounter(w, 0, 2, 0).omega;
    const fast = dominantEncounter(w, 0, 5, 0).omega;
    expect(fast).toBeGreaterThan(slow);
  });

  /**
   * Downwind at the wave's own celerity the boat keeps station with the crest
   * and stops meeting waves at all. The rate of meetings is a magnitude, so it
   * must come back through zero rather than going negative and reading as a
   * fast head sea.
   */
  it('passes through zero when she keeps station with the crest, and never goes negative', () => {
    const w = sea();
    let best = w.comps[0];
    for (const c of w.comps) if (c.amp > best.amp) best = c;
    const celerity = best.omega / best.k;

    expect(dominantEncounter(w, Math.PI, celerity, 0).omega).toBeCloseTo(0, 6);
    // Faster still: overtaking, and the count of meetings climbs again.
    const over = dominantEncounter(w, Math.PI, celerity * 1.6, 0).omega;
    expect(over).toBeGreaterThan(0);
  });

  it('counts leeway, not just the way she is pointing', () => {
    const w = sea();
    // Beam on, so heading contributes nothing; all of it is sideways slip.
    const noSlip = dominantEncounter(w, Math.PI / 2, 0, 0).omega;
    const slipping = dominantEncounter(w, Math.PI / 2, 0, 1.5).omega;
    expect(slipping).not.toBeCloseTo(noSlip, 3);
  });

  it('is flat calm when there is no sea', () => {
    const w = sea();
    w.comps.length = 0;
    expect(dominantEncounter(w, 0, 4, 0)).toEqual({ omega: 0, amp: 0 });
  });
});

/**
 * A sea of a fixed size, written as `n` independent components.
 *
 * Same total energy however finely it is split -- a sine of amplitude A has
 * variance A^2/2, so n components of A/sqrt(n) carry what one of A did. That
 * only holds if they really are independent, which is why the *wavelengths*
 * differ here and not only the directions and phases.
 *
 * The first version of this fixture gave every component the same wavelength,
 * and that is independent in space and not in time: distinct wave vectors, so
 * the spatial RMS came out right, but one shared frequency, so at a fixed
 * point the whole sum collapses into a single sinusoid whose amplitude is
 * whatever the phases happen to add up to. Measured over 400 s at the origin
 * it was 0.124 against a claimed 0.354. Time is the half that matters, because
 * `waveHitStrength` multiplies this amplitude by a frequency to get the
 * surface's vertical velocity past the hull.
 */
function splitSea(n: number, total: number): WaveField {
  const w = new WaveField(12, 0);
  w.comps.length = 0;
  for (let i = 0; i < n; i++) {
    const dir = (i - (n - 1) / 2) * 0.3;
    const k = (2 * Math.PI) / (12 + i * 3.7);
    w.comps.push({
      dirX: Math.sin(dir),
      dirY: Math.cos(dir),
      k,
      omega: Math.sqrt(9.81 * k),
      amp: total / Math.sqrt(n),
      basePhase: i * 2.4,
    });
  }
  return w;
}

describe('encounter amplitude', () => {
  /**
   * Regression: the encounter reported the biggest component's amplitude, so
   * the same sea written as a finer spectrum claimed to be a smaller sea --
   * and the sound of it got quieter every time the wave model gained detail.
   */
  it('is the size of the sea, not of however many pieces it was written in', () => {
    const coarse = dominantEncounter(splitSea(1, 0.5), 0, 0, 0);
    const fine = dominantEncounter(splitSea(9, 0.5), 0, 0, 0);
    expect(fine.amp).toBeGreaterThan(0);
    expect(fine.amp).toBeCloseTo(coarse.amp, 6);
  });

  /**
   * And the size it reports is the size the water is, not just the size the
   * arithmetic in `rms` says. Measured the way the sound uses it: at one point,
   * over time, which is where a sea made of components that do not really
   * differ gives itself away.
   *
   * Without this, the invariance above is satisfied by anything blind to the
   * split -- `rms` is a pure function of the amplitudes and cannot tell whether
   * the sea it describes exists.
   */
  it('is the size the water at a point really moves', () => {
    const w = splitSea(9, 0.5);
    let sum = 0;
    const n = 40000; // 400 s, long enough for the slowest component to average
    for (let i = 0; i < n; i++) {
      w.update(0.01);
      const h = w.heightAt(0, 0);
      sum += h * h;
    }
    expect(Math.sqrt(sum / n)).toBeCloseTo(w.rms, 2);
  });

  /**
   * Regression: the shelter reached the hull and the water shader and not the
   * sound, so lying in the flat water behind a headland the boat still heard
   * the open sea meeting her.
   *
   * Only the size is sheltered. A lee takes the height out of the waves and
   * leaves their length alone, so the rate she meets them cannot move.
   */
  it('is damped by a lee, and the rate of meeting them is not', () => {
    const w = sea();
    const open = dominantEncounter(w, 0.4, 3, 0);
    const lee = dominantEncounter(w, 0.4, 3, 0, 0.25);
    expect(lee.amp).toBeCloseTo(open.amp * 0.25, 9);
    expect(lee.omega).toBeCloseTo(open.omega, 9);
  });

  it('grows with the sea, whatever it is written in', () => {
    const small = dominantEncounter(splitSea(9, 0.3), 0, 0, 0);
    const big = dominantEncounter(splitSea(9, 0.9), 0, 0, 0);
    expect(big.amp).toBeCloseTo(small.amp * 3, 6);
  });
});

describe('wave hit strength', () => {
  /**
   * The point of the whole thing: at the same wave height and the same boat
   * speed, punching into a sea has to sound harder than being carried by one.
   * It comes out of the encounter frequency without being asked for.
   */
  it('is harder beating than running, in the same sea at the same speed', () => {
    const w = sea();
    const beating = waveHitStrength(dominantEncounter(w, 0, 3, 0), 3);
    const running = waveHitStrength(dominantEncounter(w, Math.PI, 3, 0), 3);
    expect(beating).toBeGreaterThan(running);
  });

  it('is harder in a bigger sea', () => {
    const small = new WaveField(10, 0);
    const big = new WaveField(28, 0);
    expect(waveHitStrength(dominantEncounter(big, 0, 3, 0), 3)).toBeGreaterThan(
      waveHitStrength(dominantEncounter(small, 0, 3, 0), 3),
    );
  });

  it('is harder the faster she is driven', () => {
    const w = sea();
    const slow = waveHitStrength(dominantEncounter(w, 0, 1, 0), 1);
    const fast = waveHitStrength(dominantEncounter(w, 0, 5, 0), 5);
    expect(fast).toBeGreaterThan(slow);
  });

  /** Nothing to meet, nothing to hear. */
  it('is nothing in flat calm', () => {
    const w = sea();
    w.comps.length = 0;
    expect(waveHitStrength(dominantEncounter(w, 0, 4, 0), 4)).toBe(0);
  });

  /** It is a volume, so it cannot run away in a gale. */
  it('never exceeds one, however hard she is pressed', () => {
    const gale = new WaveField(45, 0);
    expect(waveHitStrength(dominantEncounter(gale, 0, 9, 0), 9)).toBeLessThanOrEqual(1);
  });
});

/**
 * Waves are carried by the water they are in.
 *
 * The field is a function of world position, so with a tide running the pattern
 * used to stay pinned to the ground while the water moved through it -- the
 * physics and the shader agreeing with each other on something slightly wrong.
 * The drift is now integrated and folded into each component's phase.
 */
describe('the spectrum', () => {
  /** The components in wavelength order, which is the order they are built in. */
  const amps = (w: WaveField) => w.comps.map((c) => c.amp);
  const peakOf = (a: number[]) => a.indexOf(Math.max(...a));

  /**
   * The two halves of the model have to describe one sea. `sigWaveHeight` is
   * read straight off the wind by `waveHeightFromWind` and drives the added
   * resistance and the HUD; the components are what the boat actually floats
   * on. Nothing makes them agree except the normalisation, and the table of
   * weights this replaced agreed only to 0.8% and only by having been tuned.
   */
  it('carries exactly the significant wave height it reports', () => {
    for (const tws of [0.4, 3, 7, 12, 20]) {
      const w = new WaveField(tws, 0.6);
      expect(w.rms).toBeGreaterThan(0);
      expect(4 * w.rms).toBeCloseTo(w.sigWaveHeight, 10);
    }
  });

  /**
   * Pierson-Moskowitz, sampled: energy rises to a peak somewhere inside the
   * band and falls away either side of it. A flat set of weights -- which is
   * what a spectrum reduces to if the shape term is dropped -- has its maximum
   * at the first band and fails on every clause here.
   */
  it('peaks inside the band and falls away either side', () => {
    const a = amps(new WaveField(12, 0));
    const peak = peakOf(a);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(a.length - 1);
    for (let i = 1; i <= peak; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
    for (let i = peak + 1; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(a[i - 1]);
    // The long tail is the side that falls off hard, and does.
    expect(a[a.length - 1]).toBeLessThan(a[peak] * 0.5);
  });

  it('runs the biggest waves with the wind', () => {
    const twd = 1.1;
    const w = new WaveField(12, twd);
    const best = w.comps[peakOf(amps(w))];
    // Travel is downwind, and twd is where it blows from.
    expect(wrapPi(Math.atan2(best.dirX, best.dirY) - (twd + Math.PI))).toBeCloseTo(0, 6);
  });

  /**
   * Short crests, which is the whole point of a spectrum over a handful of
   * hand-picked components. Walked along the biggest train's own crest line
   * the surface should forget itself within a few hundred metres; if one
   * direction carries most of the sea it cannot, because that component
   * contributes nothing to the difference.
   *
   * Measured rather than derived: the four-component table this replaced sat
   * at 0.54 to 0.65 across the wind range, because 61% of its energy was in a
   * single direction. The spectrum sits at 0.04 to 0.16.
   */
  it('has crests short enough to lose track of themselves', () => {
    for (const tws of [4, 8, 12, 16]) {
      const w = new WaveField(tws, 0);
      const best = w.comps[peakOf(amps(w))];
      // Along the crest: ninety degrees off the way the train travels.
      const px = best.dirY;
      const py = -best.dirX;
      const s2 = w.rms * w.rms;

      let acc = 0;
      let bands = 0;
      for (let d = 40; d <= 400; d += 5) {
        let sum = 0;
        const n = 300;
        for (let i = 0; i < n; i++) {
          const x = (i * 37.13) % 900;
          const y = (i * 91.7) % 900;
          sum += w.heightAt(x, y) * w.heightAt(x + px * d, y + py * d);
        }
        acc += sum / n / s2;
        bands++;
      }
      expect(Math.abs(acc / bands)).toBeLessThan(0.3);
    }
  });
});

describe('drift with the water', () => {
  const DT = 1 / 120;
  const run = (field: WaveField, seconds: number, drift?: { x: number; y: number }) => {
    for (let n = 0; n < Math.round(seconds / DT); n++) field.update(DT, drift);
  };

  /**
   * The property that says the pattern is really being carried: a point moving
   * at the set must see exactly the sea it would see in still water. Asserted
   * against the still-water field rather than against the formula.
   */
  it('shows a point moving at the set the still-water sea', () => {
    const still = new WaveField(8, 0);
    const tide = new WaveField(8, 0);
    const set = { x: 0.4, y: 2 };

    for (let n = 1; n <= 20 / DT; n++) {
      still.update(DT);
      tide.update(DT, set);
      const t = n * DT;
      // The same parcel of water, which has been carried to here.
      expect(tide.heightAt(set.x * t, set.y * t)).toBeCloseTo(still.heightAt(0, 0), 9);
    }
  });

  /** ...and a point fixed to the ground does not, or nothing has moved. */
  it('runs the sea past a point fixed to the ground', () => {
    const still = new WaveField(8, 0);
    const tide = new WaveField(8, 0);
    run(still, 6);
    run(tide, 6, { x: 0, y: 2 });
    expect(Math.abs(tide.heightAt(0, 0) - still.heightAt(0, 0))).toBeGreaterThan(0.02);
  });

  /**
   * The shader is handed a phase per component and reads nothing else, so what
   * it draws has to be reconstructible from the packed uniform alone. This is
   * the agreement between the physics and the water in the same sense
   * `creature.test.ts` means it: the surface is asked, not the formula copied.
   */
  it('packs a uniform that reproduces the surface it floats the boat on', () => {
    const w = new WaveField(10, 1.1);
    run(w, 9, { x: 1.3, y: -0.7 });
    const packed = new Float32Array(MAX_WAVES * 6);
    w.packUniform(packed);

    for (const [x, y] of [
      [0, 0],
      [12, -30],
      [-140, 65],
    ]) {
      let h = 0;
      for (let i = 0; i < MAX_WAVES; i++) {
        const o = i * 6;
        const amp = packed[o + 4];
        if (amp <= 0) continue;
        h +=
          amp *
          Math.sin(packed[o + 2] * (packed[o] * x + packed[o + 1] * y) - packed[o + 3] * w.time + packed[o + 5]);
      }
      expect(h).toBeCloseTo(w.heightAt(x, y), 5);
    }
  });

  /**
   * The surface's vertical rate at a point fixed to the ground, checked against
   * the surface itself rather than against the formula: how much the height
   * changed over a short step, divided by it. With the field drifting, `omega`
   * alone is the rate a point *in the water* sees, and the two differ by the
   * advection the drift adds.
   */
  it('reports how fast the surface is really rising at a fixed point', () => {
    const set = { x: 0.9, y: -1.6 };
    const w = new WaveField(9, 0.6);
    run(w, 5, set);

    const h0 = w.heightAt(30, -12);
    const rate = w.verticalVelocityAt(30, -12, set);
    w.update(1e-4, set);
    const measured = (w.heightAt(30, -12) - h0) / 1e-4;
    expect(rate).toBeCloseTo(measured, 3);

    // ...and the drift term is not doing nothing, or the finite difference
    // above would be satisfied by an advection of zero.
    //
    // Measured over a spread of points and against the size of the rate
    // itself, rather than at this one point against an absolute 0.05, which is
    // what it was. That guard was a single draw from a distribution: it stood
    // for years and then landed at 0.038 the day the sea was rewritten as a
    // spectrum, having caught nothing and having nothing to say about the
    // change. A ratio survives the sea being retuned; an absolute in m/s does
    // not, because the sea's whole scale moves with the wind.
    //
    // It stands at 0.128 as this is written, against a bound of 0.05: loose,
    // because all this has to catch is an advection term of nothing.
    let diff = 0;
    let mag = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 13.7;
      const y = -i * 7.1;
      const real = w.verticalVelocityAt(x, y, set);
      diff += (w.verticalVelocityAt(x, y) - real) ** 2;
      mag += real * real;
    }
    expect(Math.sqrt(diff / mag)).toBeGreaterThan(0.05);
  });

  /**
   * The phase is wrapped because the drift grows without bound and these end up
   * in a float32 uniform. Ten hours of two metres a second is 72 km.
   */
  it('keeps the phase wrapped however far the water has run', () => {
    const w = new WaveField(9, 0);
    w.update(10 * 3600, { x: 2, y: 0 });
    for (let i = 0; i < w.comps.length; i++) {
      expect(w.phaseAt(i)).toBeGreaterThanOrEqual(0);
      expect(w.phaseAt(i)).toBeLessThan(2 * Math.PI + 1e-12);
    }
  });

  it('starts the drift again with the session', () => {
    const w = new WaveField(8, 0);
    run(w, 30, { x: 0, y: 2 });
    w.restart();
    const fresh = new WaveField(8, 0);
    expect(w.heightAt(50, -20)).toBeCloseTo(fresh.heightAt(50, -20), 12);
  });
});

/**
 * The wind that builds the sea, and the bearing it runs from.
 *
 * A sea is raised by wind over a surface that is itself moving, so both the
 * height and the direction come off the wind *relative to the water*. The
 * height half was already here; the bearing half was not, and the boat was
 * given her head sea from the true wind instead -- so with a stream across the
 * breeze she felt the waves coming from somewhere the water was not.
 *
 * What this does not cover, in the same sense `creature.test.ts` means it: the
 * call site. Put `wind.baseTwd` back into `sea.dir` in `engine.ts` and every
 * assertion here still passes. Reaching it needs an observable the boat's own
 * response does not contaminate, and there is not one -- with the stream set
 * two ways she also ends up on two headings, which moves the added resistance
 * by more than the bearing does. What holds the two together is that
 * `setFromWind` and `sea.dir` are both derived from the one `seaTwd`, the
 * second by adding pi to reverse it from where the sea comes from to where it
 * runs.
 */
describe('wind over the water', () => {
  const still = { x: 0, y: 0 };

  it('is the true wind when the water is still', () => {
    for (const twd of [0, 1.1, 3.0, -2.2]) {
      expect(seaBearing(windOverWater(twd, 8, still))).toBeCloseTo(wrapPi(twd), 9);
    }
  });

  /** Wind against tide is a bigger sea, wind with tide a smaller one. */
  it('is stronger against the stream and weaker with it', () => {
    // Wind from the north: it blows towards the south, so a stream setting
    // south runs with it and one setting north runs against.
    const withIt = windOverWater(0, 8, { x: 0, y: -2 });
    const against = windOverWater(0, 8, { x: 0, y: 2 });
    expect(Math.hypot(withIt.x, withIt.y)).toBeCloseTo(6, 9);
    expect(Math.hypot(against.x, against.y)).toBeCloseTo(10, 9);
  });

  /**
   * And a stream across it turns the sea, mirrored about the wind -- which is
   * the part that was missing. Nineteen degrees for two knots across eight,
   * which is a different sea to punch into and not a smaller one.
   */
  it('turns the sea when the stream runs across the wind', () => {
    const east = seaBearing(windOverWater(0, 8, { x: 2, y: 0 })) * RAD;
    const west = seaBearing(windOverWater(0, 8, { x: -2, y: 0 })) * RAD;
    expect(east).toBeCloseTo(-west, 9);
    expect(Math.abs(east)).toBeGreaterThan(10);
    expect(Math.abs(east)).toBeLessThan(20);
    // Same strength either way: only the bearing moved.
    const e = windOverWater(0, 8, { x: 2, y: 0 });
    const w = windOverWater(0, 8, { x: -2, y: 0 });
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(Math.hypot(w.x, w.y), 12);
  });
});
