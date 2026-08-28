import { compassVec, wrap2Pi, type Vec2 } from './math';

/**
 * Wind sea: a sum of sine waves.
 *
 * Why this shape and not something richer:
 *  - the physics needs the surface height at a handful of points, hundreds of
 *    times a second (buoyancy sampling)
 *  - the renderer needs to displace tens of thousands of vertices per frame
 *    (a GPU vertex shader)
 * Both sides must use *literally the same formula* or the boat will not float
 * on the waves you can see. So the wave model is restricted to something whose
 * parameters fit into shader uniforms.
 *
 * Each component: h = A * sin(k*(D.P) - w*t + phase), with w = sqrt(g*k)
 * (the deep-water dispersion relation).
 */

const G = 9.81;
/**
 * How many components the sea is written in.
 *
 * Four hand-picked ones for most of this project's life, which is enough to
 * float a boat correctly and not enough to look like water: four sines make
 * four sets of parallel ridges running most of the way across the world, and
 * the eye finds the repeat in a few seconds. Sixteen drawn from a spectrum
 * breaks the crests up without changing the size of the sea.
 *
 * The cost is a sixteen-iteration loop per vertex in the water shader and per
 * hull sample in the physics, so this is not a number to raise idly; see the
 * commit that set it for what was measured.
 */
export const MAX_WAVES = 16;

/**
 * The band of wavelengths the sea is written in, as multiples of the dominant.
 *
 * The spectrum runs far wider than this in both directions and most of what is
 * cut off is on the *short* side, which is not an approximation anyone should
 * be surprised by: the water grid is a 3 m cell (`SEG` in view/water.ts), so a
 * wave under about 6 m has fewer than two vertices to a crest and comes out as
 * a crawling moire rather than as a wave. The chop below this band is drawn --
 * it is `rippleGlsl`, the normal perturbation that adds texture without
 * touching the height. That is the honest description of the split: this array
 * is the part of the spectrum the grid can carry, and the ripple is the tail
 * it cannot.
 *
 * Which leaves where to put the band, and the answer is not taste either. Its
 * width is set by making every one of the sixteen worth its loop iteration --
 * at 2.5 the weakest band still carries 18% of the peak's energy, and widening
 * it spends bands on nothing (at 3.5, the weakest is 1%). Its position is set
 * by holding the energy-weighted mean wavelength at 1.071 times the dominant,
 * which is where the four-component table it replaces had it. The sea is the
 * same size and the same length as it was; only its detail changed.
 *
 * At 12 knots that is 11.6 m to 29 m, so the shortest component has nearly
 * four grid cells to a crest. The old table's shortest had 1.97 -- under the
 * two that sampling one at all requires.
 *
 * Below about six knots that stops holding, and it is `lambda`'s 4 m floor
 * doing it rather than this band: the shortest component sticks at 2.9 m and
 * gets one cell. Left alone, because the sea there is 0.12 m high and the
 * aliasing has nothing to show.
 */
const MIN_MULT = 0.725;
const MAX_MULT = 1.8125;

/**
 * Half-width of the directional fan, rad -- about 41 degrees either side.
 *
 * Taken from the old table, whose widest offset was 0.72; its fan was one-sided
 * though (-0.72 to +0.42) where this one is centred on the wind. This is a
 * bound rather than a value anything takes: the sixteen offsets land between
 * -0.63 and +0.68, because `fan` samples the open interval.
 *
 * A real sea's spreading is narrowest at the spectral peak and wider away from
 * it, which this does not model; the fan is uniform and the components are
 * scattered across it, which is what stops the ridges being parallel.
 */
const SPREAD = 0.72;

/** 1/phi. Successive multiples of it fill an interval about as evenly as anything can. */
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * The n'th direction offset, in -1..1, starting at the middle.
 *
 * A Kronecker sequence rather than an even fan, because the offsets are handed
 * out walking up from the spectral peak and wrapping round: an even fan would
 * then put neighbouring frequencies at neighbouring angles, and the sea would
 * be a smooth sweep of direction with wavelength -- which reads as one curved
 * ridge rather than as a confused sea. This drops each new component into the
 * widest gap left, so frequency and direction stay unrelated.
 *
 * n = 0 lands exactly at 0, which is why the peak band is given it: the
 * biggest waves should run with the wind, and `SeaState.dir` says they do.
 */
const fan = (n: number): number => 2 * ((n * GOLDEN + 0.5) % 1) - 1;

/**
 * The golden angle, rad. Component phases are multiples of it.
 *
 * They only have to be spread, and any irrational multiple spreads them; this
 * is the one that spreads a partial sequence best, which matters because the
 * eye is looking at all sixteen at once.
 */
const PHASE_STEP = Math.PI * (3 - Math.sqrt(5));

/**
 * The wind over the water, m/s, world frame -- the velocity that actually
 * builds and turns a sea.
 *
 * A sea is raised by wind blowing over a surface that is itself moving, so what
 * matters is the wind *relative to the water*: a stream running against the
 * breeze makes a bigger sea and one running with it a smaller, which is what
 * these places are known for and costs one subtraction rather than a model. A
 * stream running across it turns the sea as well, which is the half that is
 * easy to leave out -- and was, so the boat felt her head sea coming from
 * where the wind was rather than from where the waves were.
 *
 * Both the height and the bearing come off this one vector, which is the point
 * of it being a vector: they cannot disagree.
 *
 * @param twd where the wind blows from, compass rad
 */
export const windOverWater = (twd: number, tws: number, current: Vec2): Vec2 => ({
  x: -Math.sin(twd) * tws - current.x,
  y: -Math.cos(twd) * tws - current.y,
});

/** Where that sea runs *from*, compass rad -- what `setFromWind` wants. */
export const seaBearing = (overWater: Vec2): number =>
  Math.atan2(-overWater.x, -overWater.y);

/**
 * Significant wave height from wind speed, in metres.
 * Tuned for fetch-limited coastal water rather than a fully developed ocean.
 * The polar solver uses the same function so the simulator and the polar agree.
 */
export const waveHeightFromWind = (tws: number): number => 0.013 * Math.max(tws, 0.5) ** 2;

export interface WaveComponent {
  dirX: number; // unit vector of travel (downwind)
  dirY: number;
  k: number; // wave number, 2pi/lambda
  omega: number; // angular frequency, sqrt(g*k)
  amp: number; // m (amplitude = half the wave height)
  /**
   * The phase the component was built with, before the water's drift.
   *
   * Named so that reading it is visibly not the same as asking for the phase.
   * Anything drawing or floating on this sea wants `WaveField.phaseAt`, which
   * carries the drift; the shader is handed that through `packUniform`, and the
   * one time this field was copied straight into a uniform the water quietly
   * stopped moving with the tide while the boat did.
   */
  basePhase: number;
}

export class WaveField {
  readonly comps: WaveComponent[] = [];
  private t = 0;
  /**
   * How far the water itself has been carried, m.
   *
   * The wave field is a function of world position, so with a tide running the
   * pattern stayed pinned to the ground while the water it is made of moved
   * through it. Waves are carried by the water they are in; this is that
   * displacement, integrated, and every sample is taken relative to it.
   */
  private driftX = 0;
  private driftY = 0;
  private readonly driftOut: Vec2 = { x: 0, y: 0 };
  /**
   * The spectrum's band weights, scratch. Written and read inside one
   * `setFromWind`, which runs on every physics tick and must not allocate.
   */
  private readonly weights = new Float64Array(MAX_WAVES);
  /** Significant wave height H1/3, m. Used by the HUD and added resistance. */
  sigWaveHeight = 0;
  /**
   * The wind this sea was built from, m/s -- not the wind blowing now.
   *
   * They are different numbers and the difference matters to anything that has
   * to agree with the water: the sea builds and turns with a lag, it is raised
   * on the wind over the *moving* water, and the player can scale it. Whatever
   * reads this gets the wind the waves in front of it actually came from.
   *
   * The whitecaps read it. Foam coverage is a function of wind speed and the
   * wave field's own steepness is not -- H13 and the dominant wavelength both
   * go as u^2, so H/lambda is a constant 0.031 whatever the wind -- which
   * leaves this as the only thing that can tell the sea when to break.
   */
  windSpeed = 0;

  constructor(tws: number, twd: number) {
    this.setFromWind(tws, twd);
  }

  get time(): number {
    return this.t;
  }

  /**
   * RMS surface elevation, m -- sigma, the scale of this sea.
   *
   * The one measure of "how big is it" that does not depend on how finely the
   * spectrum was chopped up. A sine of amplitude A has variance A^2/2, the
   * components are independent, so the variances add. Split any component into
   * two of amplitude A/sqrt(2) and the water is a different water but the same
   * size, and this returns the same number; anything reading a single
   * component's amplitude does not.
   */
  get rms(): number {
    let v = 0;
    for (const c of this.comps) v += c.amp * c.amp;
    return Math.sqrt(v * 0.5);
  }

  /**
   * How far the water has been carried since the session began, m.
   *
   * Exposed so that anything else drawn *in* the water -- the wake is the one
   * that matters -- is carried by the same number the sea is, rather than by a
   * second integration of the same current that could drift away from it.
   */
  get drift(): Vec2 {
    // The same object every time. Read every frame by the wake, and a fresh
    // one per frame is litter for a value nobody keeps; nobody writes to it.
    this.driftOut.x = this.driftX;
    this.driftOut.y = this.driftY;
    return this.driftOut;
  }

  /**
   * Start the sea again from the beginning, for a new session.
   *
   * The component phases are fixed (`i * 1.7`), so this clock is the whole of
   * what makes one sea differ from another built the same way -- which means a
   * session that inherits it inherits a sea the seed did not ask for. It is the
   * same reset `WindField.reseed` does, and this field is the one that never
   * had it: a passage sailed, restarted on the same seed, met the wave train at
   * whatever phase the last one had left it in and sailed a measurably
   * different track.
   *
   * Not a `reseed`, because there is no seed here to take.
   */
  restart(): void {
    this.t = 0;
    this.driftX = 0;
    this.driftY = 0;
  }

  /**
   * The plane was re-pinned under the boat: the water is where it was, and its
   * coordinates are not.
   *
   * The drift *is* the water's offset from the plane -- `heightAt` samples the
   * pattern at `P - drift` -- so a plane that moves by `d` under a sea that
   * did not move is a drift that gains `d`. Without this the same piece of
   * ocean was sampled at a phase two hundred kilometres away, and the surface
   * under the boat changed shape in one frame.
   *
   * The wake needs nothing for the same reason: it is kept in the water's
   * frame, and this is that frame. The offset it hands the wake gains 200 km
   * at each re-pin, which is float32-exact past ten thousand kilometres of
   * sailing -- nine hundred hours of it, since the boat has no time
   * compression at sea.
   */
  repin(d: { x: number; y: number }): void {
    this.driftX += d.x;
    this.driftY += d.y;
  }

  /**
   * @param drift the water's own velocity, m/s. Its integral is what the wave
   *   pattern is carried along by.
   *
   *   One vector for the whole field, which is what the shader can be given.
   *   The engine passes the deep-water set rather than the stream under the
   *   boat, so where the stream is throttled by depth the sea drifts a little
   *   faster than the water it is in. The identity below is exact; this is the
   *   approximation, and it is the price of the field being one number.
   */
  update(dt: number, drift?: { x: number; y: number }): void {
    this.t += dt;
    if (drift) {
      this.driftX += drift.x * dt;
      this.driftY += drift.y * dt;
    }
  }

  /**
   * Build the sea from the wind.
   *
   * These are fetch-limited coastal numbers, not fully developed
   * Pierson-Moskowitz ocean: about 0.5 m high and 16 m long in 12 knots, which
   * is the right size for a 10 m yacht to sail through. Open-ocean parameters
   * give 36 m wavelengths that the boat simply rides over without noticing.
   *
   * The *shape* is Pierson-Moskowitz even where the scale is not:
   * S(w) ~ w^-5 exp(-1.25 (w_p/w)^4), sampled in bands spaced evenly in log w.
   * With that spacing dw goes as w, so the variance a band carries goes as
   * w^-4 exp(-1.25 (w_p/w)^4) -- which, written in the wavelength multiple
   * m = (w_p/w)^2, is just m^2 exp(-1.25 m^2). Whatever constant stands in
   * front of the spectrum cancels in the normalisation below, which is why
   * none appears here and no fetch or gravity constant is needed to get the
   * shape right. Each band is one sample of that density rather than an
   * integral over the band, which is what makes it sixteen multiplications
   * instead of sixteen quadratures; the difference shows in the mean
   * wavelength, 1.0715 of the dominant sampled against 1.0802 integrated.
   *
   * The height is not left to the spectrum. The bands are normalised so their
   * variances sum to sigma^2 with sigma = H13/4, which makes `heightAt` and
   * `sigWaveHeight` two descriptions of one sea by construction rather than by
   * tuning -- the hand-written table they replace agreed to 0.8%, and only
   * because its weights had been chosen to.
   */
  setFromWind(tws: number, twd: number): void {
    const u = Math.max(tws, 0.5);
    const lambda = Math.max(4, 0.42 * u * u); // m, dominant wavelength
    const h13 = waveHeightFromWind(u);
    this.sigWaveHeight = h13;
    this.windSpeed = u;

    // Waves travel with the wind; twd is where it blows *from*, so invert it.
    const from = compassVec(twd);
    const baseDir = Math.atan2(-from.x, -from.y);

    // The spectrum first: the normalisation needs the total, and the fan needs
    // to know which band came out biggest.
    const step = (MAX_MULT / MIN_MULT) ** (1 / (MAX_WAVES - 1));
    const weights = this.weights;
    let total = 0;
    let peak = 0;
    let m = MIN_MULT;
    for (let i = 0; i < MAX_WAVES; i++) {
      const mm = m * m;
      weights[i] = mm * Math.exp(-1.25 * mm);
      total += weights[i];
      if (weights[i] > weights[peak]) peak = i;
      m *= step;
    }

    const sigma = h13 / 4;
    m = MIN_MULT;
    for (let i = 0; i < MAX_WAVES; i++) {
      const k = (2 * Math.PI) / (lambda * m);
      // Offsets handed out from the peak band outwards, so the biggest waves
      // run with the wind and the rest scatter either side of them.
      const dir = baseDir + SPREAD * fan((i - peak + MAX_WAVES) % MAX_WAVES);
      const c = this.component(i);
      c.dirX = Math.sin(dir);
      c.dirY = Math.cos(dir);
      c.k = k;
      c.omega = Math.sqrt(G * k);
      // This band's share of sigma^2 is (weights[i] / total) * sigma^2, and a
      // sine of amplitude A has variance A^2/2, so the amplitude is the root
      // of twice the share.
      c.amp = Math.sqrt((2 * weights[i] * sigma * sigma) / total);
      c.basePhase = i * PHASE_STEP;
      m *= step;
    }
    this.comps.length = MAX_WAVES;
  }

  /**
   * The component to write into, made once and then overwritten.
   *
   * `setFromWind` runs on every physics tick -- the sea builds and turns with
   * the wind over the water, which is itself moving -- so rebuilding the array
   * there threw away and remade every component 120 times a second for a set
   * of numbers that mostly do not change. Nothing outside holds a component
   * across a tick, so overwriting them is invisible; the only reason it was
   * written the other way is that `push` reads more naturally.
   */
  private component(i: number): WaveComponent {
    const held = this.comps[i];
    if (held) return held;
    const made: WaveComponent = { dirX: 0, dirY: 1, k: 1, omega: 1, amp: 0, basePhase: 0 };
    this.comps[i] = made;
    return made;
  }

  /**
   * The phase of one component, with the water's drift folded into it.
   *
   * Carrying the field along is a shift of the sample point, and a shift of the
   * sample point *is* a shift of phase:
   *
   *     A sin(k (D . (P - O)) - wt + f) == A sin(k (D . P) - wt + (f - k (D . O)))
   *
   * which is the whole reason this is one number rather than a change to the
   * water shader. The GLSL already takes a phase per component and the view
   * already copies it from here, so both sides drift because they read the same
   * value -- not because two transcriptions of the formula were kept in step,
   * which is how that agreement usually has to be maintained and how it usually
   * eventually breaks.
   *
   * Wrapped, because the drift grows without bound: two metres a second for an
   * hour is 7.2 km, which is thousands of radians, and these end up in a
   * float32 uniform.
   */
  phaseAt(i: number): number {
    const c = this.comps[i];
    return wrap2Pi(c.basePhase - c.k * (c.dirX * this.driftX + c.dirY * this.driftY));
  }

  /** Surface elevation at a point, in metres. */
  heightAt(x: number, y: number): number {
    let h = 0;
    for (let i = 0; i < this.comps.length; i++) {
      const c = this.comps[i];
      h += c.amp * Math.sin(c.k * (c.dirX * x + c.dirY * y) - c.omega * this.t + this.phaseAt(i));
    }
    return h;
  }

  /**
   * Vertical velocity of the surface at a point fixed to the ground, m/s.
   *
   * `omega` alone is the rate at a point fixed to the *water*. Fixed to the
   * ground, the drift carries the pattern past as well, and the two rates add:
   * differentiating `k(D.(P - Ut)) - wt + f` gives `-(w + k(D.U))`. In still
   * water `U` is zero and this is what it always was.
   */
  verticalVelocityAt(x: number, y: number, drift?: { x: number; y: number }): number {
    let v = 0;
    for (let i = 0; i < this.comps.length; i++) {
      const c = this.comps[i];
      const advect = drift ? c.k * (c.dirX * drift.x + c.dirY * drift.y) : 0;
      v +=
        -c.amp *
        (c.omega + advect) *
        Math.cos(c.k * (c.dirX * x + c.dirY * y) - c.omega * this.t + this.phaseAt(i));
    }
    return v;
  }

  /** Flat array for shader uniforms: [dirX, dirY, k, omega, amp, phase] * MAX_WAVES. */
  packUniform(out: Float32Array): void {
    out.fill(0);
    for (let i = 0; i < this.comps.length && i < MAX_WAVES; i++) {
      const c = this.comps[i];
      const o = i * 6;
      out[o] = c.dirX;
      out[o + 1] = c.dirY;
      out[o + 2] = c.k;
      out[o + 3] = c.omega;
      out[o + 4] = c.amp;
      out[o + 5] = this.phaseAt(i);
    }
  }
}

/** The dominant wave train, as the boat meets it. */
export interface Encounter {
  /** rad/s, how often she meets it. Never negative. */
  omega: number;
  /**
   * m, the scale of the sea -- its RMS elevation, not the biggest component's
   * amplitude.
   *
   * The rhythm belongs to the dominant train and the size does not. One
   * component's amplitude is an artefact of how the spectrum was discretised:
   * the same water written as four components or as sixteen reports a
   * different number, and the finer the spectrum the quieter the sea claims to
   * be. `WaveField.rms` is the same water either way.
   */
  amp: number;
}

/**
 * How often the boat meets the waves.
 *
 * The encounter frequency, w_e = w - k (V . d), where d is the way the train
 * travels. Beating into a sea the boat closes with each crest, so the crests
 * arrive faster than their own period; running with them she chases and they
 * arrive slower, and fast enough downwind w_e passes through zero and she is
 * keeping station with the wave. The magnitude is the *rate of meetings*, which
 * is why the absolute value is what comes back.
 *
 * This is why a head sea and a following sea sound completely different at the
 * same boat speed and the same wave height, and it is the only quantity that
 * expresses it. The dominant train is taken alone: the sea has several, but the
 * rhythm you hear is the big one's.
 *
 * The *size* is the whole sea's, though, and only the frequency is the dominant
 * train's -- see `Encounter.amp`. Both were the biggest component's until the
 * spectrum got finer, at which point that component stopped being the sea.
 */
export function dominantEncounter(
  waves: WaveField,
  heading: number,
  /** Fore-and-aft, relative to the wave pattern rather than to the ground. */
  u: number,
  /** Athwartships, likewise. */
  v: number,
  /**
   * Wave height multiplier from land shelter, 0..1 -- the same term
   * `sampleHull` takes, defaulted the same way and for the same reason.
   *
   * The lee is part of the sea and not a decoration on it: the shader scales
   * its amplitudes by this, `sampleHull` scales the hull's, and for a while
   * this function did not, so a boat lying in the flat water behind a headland
   * felt nothing and heard the open sea. Only the size is sheltered -- a lee
   * takes the height out of the waves and leaves their length alone, so the
   * frequency below is untouched.
   */
  shelter = 1,
): Encounter {
  // Her velocity through the wave pattern, in world axes -- which is through
  // the water only while the pattern is standing still, and it no longer is.
  // The caller owes the difference; see `SoundEngine.update`. Forward is the
  // heading; starboard is ninety degrees clockwise of it, per the convention.
  const fx = Math.sin(heading);
  const fy = Math.cos(heading);
  const vx = fx * u + fy * v;
  const vy = fy * u - fx * v;

  let best: WaveComponent | null = null;
  for (const c of waves.comps) {
    if (c.amp > 0 && (best === null || c.amp > best.amp)) best = c;
  }
  if (!best) return { omega: 0, amp: 0 };

  const closing = best.dirX * vx + best.dirY * vy;
  return { omega: Math.abs(best.omega - best.k * closing), amp: waves.rms * shelter };
}

/**
 * How hard a single wave meets the boat, 0..1.
 *
 * amp * omega_e is the scale of the surface's vertical velocity relative to the
 * hull, in m/s, which is the honest measure of a wave arriving: a big slow
 * swell and a small quick chop can be equally gentle, and it is the product
 * that says so. Boat speed multiplies it, because driving into water is not the
 * same as lying in it.
 *
 * Both halves matter and both are already physical, so there is nothing here
 * chosen to make a number come out -- only the final scaling into 0..1, which
 * is a volume and has to be.
 *
 * Worth knowing before reaching for a different signal: in this wave model the
 * boat *heaves* over long swell rather than pounding into short steep water.
 * Measured over eighty minutes from 12 to 32 knots, the bow's slam impact --
 * pitch rate and vertical surface velocity together -- never once exceeded 1.0,
 * which is why the sound that used to key off a threshold there had literally
 * never played. Encounter, not impact, is the quantity with the range.
 */
export function waveHitStrength(enc: Encounter, speed: number): number {
  const vRel = enc.amp * enc.omega;
  return Math.min(vRel * (0.35 + speed * 0.16), 1);
}

export interface HullWaveSample {
  heave: number; // m, mean surface elevation
  pitchSlope: number; // rad, fore-and-aft slope (positive = bow up)
  rollSlope: number; // rad, athwartships slope (positive = starboard up)
}

/**
 * What the hull feels. Four points on the hull are sampled and a plane fitted
 * through them.
 *
 * Sampling only the centre of gravity is wrong: waves shorter than the boat
 * should be bridged by the hull, but a single sample makes the boat ride up and
 * over every one of them. Measuring bow and stern separately gives that
 * attenuation for free.
 */
export function sampleHull(
  waves: WaveField,
  px: number,
  py: number,
  heading: number,
  loa: number,
  beam: number,
  out: HullWaveSample,
  /** Wave height multiplier from land shelter, 0..1. */
  shelter = 1,
): void {
  const fx = Math.sin(heading);
  const fy = Math.cos(heading);
  const sx = fy; // starboard = heading rotated 90 degrees clockwise
  const sy = -fx;

  const half = loa * 0.42;
  const hb = beam * 0.5;

  const hBow = waves.heightAt(px + fx * half, py + fy * half);
  const hStern = waves.heightAt(px - fx * half, py - fy * half);
  const hStb = waves.heightAt(px + sx * hb, py + sy * hb);
  const hPort = waves.heightAt(px - sx * hb, py - sy * hb);

  out.heave = (hBow + hStern + hStb + hPort) * 0.25 * shelter;
  out.pitchSlope = Math.atan2((hBow - hStern) * shelter, half * 2);
  out.rollSlope = Math.atan2((hStb - hPort) * shelter, hb * 2);
}
