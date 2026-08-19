import { approach, clamp } from './math';

/**
 * Weather that changes on its own.
 *
 * The point is not decoration: weather is what makes two passages over the same
 * water different. A squall halfway forces a reef and changes which side of the
 * bay pays; fog takes the land away and makes you steer on the bearing. If
 * conditions never changed, the best route would be the same every time and
 * there would be nothing left to read.
 *
 * The model is a slow Markov walk between named conditions, with every
 * continuous quantity easing towards the current target rather than snapping.
 * Weather that teleports reads as a bug, not as weather.
 *
 * It is seeded, so a given seed replays exactly -- which is what makes it
 * testable and makes a shared race fair.
 */

export type WeatherKind = 'clear' | 'fair' | 'overcast' | 'rain' | 'squall' | 'shower' | 'fog';

export interface WeatherProfile {
  cloud: number; // 0..1 sky cover
  rain: number; // 0..1 precipitation
  fog: number; // 0..1 how much the visibility closes in
  windScale: number; // multiplier on mean wind speed
  gustScale: number; // multiplier on gustiness
  /**
   * Typical dwell time in this state, in seconds of *world* time.
   *
   * These are hours, because that is how long real weather lasts, and because
   * the clock they are measured against is the same one that moves the sun. At
   * the default 60x time scale a settled spell is two or three minutes of play
   * and a squall about half a minute -- which is what makes weather something
   * that happens during a race rather than something you read about in the
   * settings. Measured in wall-clock seconds, as they were, nothing ever
   * changed inside a race while the sun crossed the whole sky.
   */
  dwell: number;
}

const HOUR = 3600;

const PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: { cloud: 0.05, rain: 0, fog: 0.0, windScale: 0.9, gustScale: 0.6, dwell: 2.2 * HOUR },
  fair: { cloud: 0.35, rain: 0, fog: 0.02, windScale: 1.0, gustScale: 1.0, dwell: 2 * HOUR },
  overcast: {
    cloud: 0.85,
    rain: 0.05,
    fog: 0.12,
    windScale: 1.1,
    gustScale: 1.15,
    dwell: 1.8 * HOUR,
  },
  rain: { cloud: 0.95, rain: 0.65, fog: 0.3, windScale: 1.15, gustScale: 1.3, dwell: 1.3 * HOUR },
  // A squall is short, violent and the most interesting thing that can happen.
  squall: { cloud: 1.0, rain: 0.9, fog: 0.35, windScale: 1.75, gustScale: 1.9, dwell: 0.5 * HOUR },
  /**
   * Rain with the sky broken behind it.
   *
   * Every other wet condition here is overcast rain -- `rain` and `squall` both
   * put the cover at 0.95 or above -- so until this existed, drops in the air
   * and the sun out was a combination the model could not produce. Measured
   * over thirty simulated days it happened for a total of one minute, and both
   * times on the leading edge of a front rather than as anything you could sail
   * into: `rain` eases out with tau 30 and `cloud` with tau 45, so on the back
   * of a shower the drops are gone before the sun returns.
   *
   * That is a gap in the weather and not only in the optics. A passing shower
   * -- bright, brief, a hard gust under it and then gone -- is one of the most
   * common things that happens on the water, and it is the condition that makes
   * a rainbow.
   */
  shower: { cloud: 0.5, rain: 0.4, fog: 0.06, windScale: 1.3, gustScale: 1.6, dwell: 0.45 * HOUR },
  fog: { cloud: 0.7, rain: 0, fog: 1.0, windScale: 0.55, gustScale: 0.5, dwell: 1.6 * HOUR },
};

/** Where each condition can go next, and how likely. Squalls never last. */
const TRANSITIONS: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [
    ['clear', 3],
    ['fair', 5],
    ['fog', 1],
  ],
  fair: [
    ['fair', 3],
    ['clear', 3],
    ['overcast', 3],
    ['rain', 1],
    ['shower', 1],
  ],
  overcast: [
    ['overcast', 2],
    ['fair', 3],
    ['rain', 3],
    ['squall', 1],
    ['shower', 2],
    ['fog', 1],
  ],
  rain: [
    ['rain', 2],
    ['overcast', 4],
    ['squall', 2],
    ['shower', 2],
  ],
  squall: [
    ['rain', 3],
    ['overcast', 3],
    ['shower', 2],
  ],
  // A shower breaks up rather than settling in: mostly it clears behind, and
  // what it clears to is bright. Coming out of one into `rain` is the front
  // that was going to arrive anyway.
  shower: [
    ['shower', 2],
    ['fair', 4],
    ['overcast', 3],
    ['rain', 2],
  ],
  fog: [
    ['fog', 3],
    ['clear', 2],
    ['fair', 2],
  ],
};

/**
 * A stroke of lightning: where it went off, and how hard.
 *
 * Bearing and distance rather than a world position, because nothing in the
 * game is *at* a bolt -- it is a light on the sky and a noise that arrives
 * later, and both of those are answered by how far away it was and which way
 * to look. The far end of the range is beyond anything the fog draws, which
 * is right: most lightning in a squall is a sky that lights up with nothing
 * visible in it.
 */
export interface Lightning {
  /** Compass bearing from the boat, rad. */
  bearing: number;
  /** Metres away. */
  distance: number;
  /** 0..1, how much sky this one lights. */
  power: number;
  /** Real seconds since it struck. */
  age: number;
}

/**
 * How lightning is scheduled.
 *
 * On *real* seconds, not world ones -- the same rule the wildlife clocks and
 * the flare's burn follow. A strike is something the player watches happen,
 * and at the default 60x time scale a storm rolled on world time would strobe
 * rather than flash.
 *
 * Only in heavy rain, and more of it the heavier: measured, a squall (rain
 * 0.9) averages a bolt every six seconds and steady rain (0.65) one every
 * fifty, and anything drier than `RAIN_FLOOR` throws none at all. Nothing here consults
 * the *kind*: a squall easing into rain should thin its lightning out with
 * the rain rather than stop the moment the label changes.
 */
const RAIN_FLOOR = 0.55;
const STRIKE_INTERVAL_MIN = 6;
const STRIKE_INTERVAL_MAX = 70;
/** m. The near end is close enough to be frightening; the far end is a horizon. */
const STRIKE_NEAR = 400;
const STRIKE_FAR = 14000;
/** s. How long one bolt's flicker lasts. */
export const FLASH_TIME = 0.45;

/**
 * The flash a bolt is throwing at this age, 0..1.
 *
 * Two or three pulses inside half a second, not one fade: a real stroke is a
 * leader and its return strokes, and it is the stutter that says lightning
 * rather than "someone turned a light on". Pure and exported so the shape can
 * be asserted without a renderer.
 */
export function flashAt(age: number, power: number): number {
  if (!(age >= 0) || age > FLASH_TIME) return 0;
  const pulse = (at: number, height: number, decay: number) =>
    age < at ? 0 : height * Math.exp(-(age - at) / decay);
  const v = pulse(0, 1, 0.055) + pulse(0.09, 0.7, 0.05) + pulse(0.21, 0.45, 0.07);
  // Faded to nothing over the last tenth rather than cut off at the end:
  // the pulses still carry about 1.5% of full brightness at FLASH_TIME, and
  // a step from there to zero is a blink at the end of every stroke.
  const close = Math.min(1, (FLASH_TIME - age) / 0.1);
  return Math.min(1, v) * clamp(power, 0, 1) * close;
}

export interface WeatherState {
  kind: WeatherKind;
  /** Smoothed values actually applied to the world. */
  cloud: number;
  rain: number;
  fog: number;
  windScale: number;
  gustScale: number;
  /** World seconds until the next roll, on the same clock as `dwell`. */
  timeToChange: number;
  /**
   * The bolt whose flash is running, or null. Kept for the whole flash so a
   * renderer can put the light where the bolt was rather than overhead.
   */
  lightning: Lightning | null;
  /** How much sky that bolt is lighting right now, 0..1. */
  flash: number;
  /**
   * True for the one step a bolt strikes on, which is when the thunder is
   * scheduled -- the sound is the engine's to play, and it belongs to the
   * strike rather than to any frame that follows it.
   */
  struck: boolean;
}

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export class Weather {
  readonly state: WeatherState;
  private target: WeatherProfile;
  private rand: () => number;
  /**
   * Lightning draws from its own stream, not the weather's.
   *
   * A shared one would make the *fronts* depend on how much lightning had
   * been thrown, so a pinned seed would stop meaning a pinned world the day
   * this feature landed -- a review measured the first transition moving
   * from 5115 s to 2866 s on seed 1. Stirred off the same seed so a storm is
   * still reproducible, and separate so it cannot reach back into anything
   * that was reproducible before it existed.
   */
  private bolt: () => number;
  private timer = 0;
  /** Real seconds until the next bolt; 0 means "roll a new interval". */
  private nextStrike = 0;
  /** When false the weather is pinned to whatever it currently is. */
  evolve = true;

  constructor(seed = 1, kind: WeatherKind = 'fair') {
    this.rand = rng(seed);
    this.bolt = rng(seed ^ 0xb017);
    this.target = PROFILES[kind];
    this.state = {
      kind,
      cloud: this.target.cloud,
      rain: this.target.rain,
      fog: this.target.fog,
      windScale: this.target.windScale,
      gustScale: this.target.gustScale,
      timeToChange: this.target.dwell,
      lightning: null,
      flash: 0,
      struck: false,
    };
    this.timer = this.target.dwell;
  }

  /**
   * Start the weather again from a seed.
   *
   * A seed is supposed to name a world, and weather is half of what makes two
   * races in the same world differ. Left out, a pinned seed brings back the
   * islands and then whatever front happened to be passing at the end of the
   * last race -- reproducible to look at and not to sail.
   *
   * The opening condition comes from the seed too. Always starting in 'fair'
   * would throw away variety the seed is there to provide, and starting in
   * anything at all would sometimes put the gun inside a squall.
   */
  reseed(seed: number): void {
    this.rand = rng(seed);
    this.bolt = rng(seed ^ 0xb017);
    const openers: WeatherKind[] = ['clear', 'fair', 'fair', 'overcast'];
    this.set(openers[Math.floor(this.rand() * openers.length)]);
  }

  /** Jump straight to a condition, with no transition. */
  set(kind: WeatherKind): void {
    this.target = PROFILES[kind];
    this.state.kind = kind;
    this.state.cloud = this.target.cloud;
    this.state.rain = this.target.rain;
    this.state.fog = this.target.fog;
    this.state.windScale = this.target.windScale;
    this.state.gustScale = this.target.gustScale;
    this.timer = this.target.dwell;
    this.state.timeToChange = this.timer;
    // The sky is cleared with everything else. Jumping conditions -- a new
    // session, a pinned mode, a reseed -- must not carry a bolt across:
    // review found a flash of 0.94 surviving `reseed()` into fair weather,
    // and the old interval deciding when the new storm's first strike fell.
    this.nextStrike = 0;
    this.state.lightning = null;
    this.state.flash = 0;
    this.state.struck = false;
  }

  private roll(): void {
    const options = TRANSITIONS[this.state.kind];
    const total = options.reduce((a, [, w]) => a + w, 0);
    let pick = this.rand() * total;
    for (const [kind, w] of options) {
      pick -= w;
      if (pick <= 0) {
        this.state.kind = kind;
        this.target = PROFILES[kind];
        // Vary the dwell so changes never feel metronomic.
        this.timer = this.target.dwell * (0.6 + this.rand() * 0.8);
        return;
      }
    }
  }

  /**
   * @param dt      real seconds, which the transitions are eased over
   * @param worldDt seconds of simulated time, which the conditions dwell for
   *
   * Two clocks, on purpose. *When* the weather turns belongs to the world: a
   * front is hours long, and if the day passes in twenty minutes the fronts
   * have to pass with it. *How fast the change looks* belongs to the screen:
   * eased over world time, a squall at 60x would arrive in a third of a second
   * and read as a bug rather than as weather.
   */
  update(dt: number, worldDt = dt): void {
    this.updateLightning(dt);
    if (this.evolve) {
      this.timer -= worldDt;
      if (this.timer <= 0) this.roll();
    }
    this.state.timeToChange = Math.max(0, this.timer);

    // Ease towards the target. Wind responds faster than cloud and fog, which
    // is how it feels on the water: the gust arrives before the sky changes.
    const s = this.state;
    const t = this.target;
    s.cloud = approach(s.cloud, t.cloud, 45, dt);
    s.rain = approach(s.rain, t.rain, 30, dt);
    s.fog = approach(s.fog, t.fog, 60, dt);
    s.windScale = approach(s.windScale, t.windScale, 22, dt);
    s.gustScale = approach(s.gustScale, t.gustScale, 22, dt);
  }

  /**
   * Strike, flash, and clear again -- on real seconds; see the note above.
   *
   * The next strike is timed as soon as the last one is scheduled rather than
   * rolled every step, so the interval a storm is running at is a property of
   * the storm and not of the frame rate.
   */
  private updateLightning(dt: number): void {
    const s = this.state;
    s.struck = false;

    if (s.lightning) {
      s.lightning.age += dt;
      s.flash = flashAt(s.lightning.age, s.lightning.power);
      if (s.lightning.age > FLASH_TIME) {
        s.lightning = null;
        s.flash = 0;
      }
    }

    if (s.rain < RAIN_FLOOR) {
      // A storm that has rained itself out keeps whatever bolt is in the air
      // -- it was already struck -- but schedules no more.
      this.nextStrike = 0;
      return;
    }

    // Heavier rain, shorter gaps. Linear in the rain above the floor, which
    // is enough: what matters is that a squall crackles and steady rain
    // merely grumbles.
    const heaviness = clamp((s.rain - RAIN_FLOOR) / (0.9 - RAIN_FLOOR), 0, 1);
    if (this.nextStrike <= 0) {
      const mean = STRIKE_INTERVAL_MAX - (STRIKE_INTERVAL_MAX - STRIKE_INTERVAL_MIN) * heaviness;
      // Exponentially distributed, so strikes cluster the way they really do
      // instead of arriving on a metronome. Clamped off zero: the log of a
      // zero from the generator is infinite, and a storm that stopped forever
      // would be a hard bug to find.
      this.nextStrike = -Math.log(Math.max(this.bolt(), 1e-6)) * mean;
      return;
    }

    this.nextStrike -= dt;
    if (this.nextStrike > 0) return;
    // One bolt at a time on screen. Intervals are exponential, so two can
    // fall inside one flash -- review found pairs 0.27 s apart -- and the
    // second used to replace the first mid-stutter, cutting a stroke short.
    // The new one waits out the old one's flash rather than being dropped:
    // a storm that crackles should look like one.
    if (this.state.lightning) return;

    // Far strikes are commoner than near ones: most of a storm is over there,
    // and the close one has to stay rare enough to startle. Raising the roll
    // to a power *below* one pushes it toward the far end -- the first
    // version cubed it, which pushes the other way and put nearly six bolts
    // in ten within three kilometres, a lightning field rather than weather.
    // Caught by the test that measures the mix, which is why it is written
    // as a fraction and not as a formula.
    const roll = Math.pow(this.bolt(), 0.75);
    const distance = STRIKE_NEAR + (STRIKE_FAR - STRIKE_NEAR) * roll;
    s.lightning = {
      bearing: this.bolt() * Math.PI * 2,
      distance,
      // Near bolts light more sky, but the far ones are not dark: a horizon
      // flash lights the whole cloud base, which is why the floor is high.
      power: clamp(1.15 - distance / STRIKE_FAR, 0.35, 1),
      age: 0,
    };
    s.flash = flashAt(0, s.lightning.power);
    s.struck = true;
    this.nextStrike = 0;
  }

  /**
   * Visibility in metres.
   *
   * Two closers, and whichever is worse wins. Fog runs the whole way from a
   * clear day down to `THICK`; rain only takes it to `RAINING`, because heavy
   * rain at sea is a couple of kilometres and not a wall.
   *
   * **Rain used to bite when it was not raining.** The clear term was written
   * as `1600 - rain * 700`, so a cloudless day was held to 1.6 km by a
   * quantity that was zero -- and the 2,600 m ceiling this function clamped to
   * was a number it could never reach. The whole game was played inside a
   * kilometre and a half: at every one of the eleven departures the coast
   * stands four kilometres off, which put all of them beyond the haze and
   * opened each on an empty sea.
   */
  get visibility(): number {
    const s = this.state;
    const fogged = THICK + (1 - s.fog) * (CLEAR_DAY - THICK);
    const rained = CLEAR_DAY - s.rain * (CLEAR_DAY - RAINING);
    return clamp(Math.min(fogged, rained), THICK, CLEAR_DAY);
  }
}

export const WEATHER_KINDS = Object.keys(PROFILES) as WeatherKind[];

/**
 * m she can see on a clear day.
 *
 * The geometric horizon from a helmsman's two metres is 5.2 km, so this is
 * about as far as there is anything to see from a small boat -- and it is what
 * puts a departure's coast, four kilometres off, on the horizon where it
 * belongs. It was 1,600 m by accident (see `visibility`), which made every
 * sea the same size and hid the eleven places the departures exist to show.
 *
 * The renderer's land window is sized against this: see `DRAW_RANGE` in
 * `view/region-mesh.ts`, which must reach past it or a coast would be built
 * inside the fog and appear out of clear air.
 */
export const CLEAR_DAY = 5000;
/** m at the thickest fog: a boat's length or two of grey. */
const THICK = 90;
/** m in the heaviest rain, which closes in but is not a wall. */
const RAINING = 900;
