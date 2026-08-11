import { compassVec, wrap2Pi } from './math';

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
export const MAX_WAVES = 4;

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
  phase: number;
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
  /** Significant wave height H1/3, m. Used by the HUD and added resistance. */
  sigWaveHeight = 0;

  constructor(tws: number, twd: number) {
    this.setFromWind(tws, twd);
  }

  get time(): number {
    return this.t;
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
   * @param drift the water's own velocity here, m/s. Its integral is what the
   *   wave pattern is carried along by. One vector for the whole field, which
   *   is what the shader can be given -- and what the stream mostly is, since
   *   it only varies with depth.
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
   */
  setFromWind(tws: number, twd: number): void {
    const u = Math.max(tws, 0.5);
    const lambda = Math.max(4, 0.42 * u * u); // m, dominant wavelength
    const h13 = waveHeightFromWind(u);
    this.sigWaveHeight = h13;

    // Waves travel with the wind; twd is where it blows *from*, so invert it.
    const from = compassVec(twd);
    const baseDir = Math.atan2(-from.x, -from.y);

    // Wavelength and amplitude split, plus directional spreading. All components
    // running the same way would produce infinitely long ridges that look fake.
    const spec: [number, number, number][] = [
      // [wavelength multiple, amplitude weight, direction offset (rad)]
      [1.0, 0.55, 0],
      [0.61, 0.26, 0.42],
      [1.72, 0.32, -0.3],
      [0.37, 0.14, -0.72],
    ];

    this.comps.length = 0;
    for (let i = 0; i < spec.length; i++) {
      const [lm, aw, dd] = spec[i];
      const lam = lambda * lm;
      const k = (2 * Math.PI) / lam;
      const dir = baseDir + dd;
      this.comps.push({
        dirX: Math.sin(dir),
        dirY: Math.cos(dir),
        k,
        omega: Math.sqrt(G * k),
        // H1/3 is roughly 4*sigma; split the components so their squares sum to
        // sigma^2.
        amp: (h13 / 4) * aw * 2,
        phase: i * 1.7,
      });
    }
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
   * Wrapped, because the drift grows without bound: two knots for an hour is
   * 7 km, which is thousands of radians, and these end up in a float32 uniform.
   */
  phaseAt(i: number): number {
    const c = this.comps[i];
    return wrap2Pi(c.phase - c.k * (c.dirX * this.driftX + c.dirY * this.driftY));
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

  /** Vertical velocity of the surface, m/s. Used for slam detection. */
  verticalVelocityAt(x: number, y: number): number {
    let v = 0;
    for (let i = 0; i < this.comps.length; i++) {
      const c = this.comps[i];
      v +=
        -c.amp *
        c.omega *
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

/**
 * What the hull feels. Four points on the hull are sampled and a plane fitted
 * through them.
 *
 * Sampling only the centre of gravity is wrong: waves shorter than the boat
 * should be bridged by the hull, but a single sample makes the boat ride up and
 * over every one of them. Measuring bow and stern separately gives that
 * attenuation for free.
 */
/** The dominant wave train, as the boat meets it. */
export interface Encounter {
  /** rad/s, how often she meets it. Never negative. */
  omega: number;
  /** m, amplitude of that train. */
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
 */
export function dominantEncounter(
  waves: WaveField,
  heading: number,
  u: number,
  v: number,
): Encounter {
  // Boat velocity through the water, in world axes. Forward is the heading;
  // starboard is ninety degrees clockwise of it, per the project's convention.
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
  return { omega: Math.abs(best.omega - best.k * closing), amp: best.amp };
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
