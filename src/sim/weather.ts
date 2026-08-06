import { clamp } from './math';

/**
 * Weather that changes on its own.
 *
 * The point is not decoration: weather is what makes two runs of the same
 * course different. A squall arriving on the second beat forces a reef and
 * changes which side pays; fog takes the marks away and makes you steer on
 * instruments. If conditions never changed, the optimal line would be the same
 * every time and there would be nothing left to read.
 *
 * The model is a slow Markov walk between named conditions, with every
 * continuous quantity easing towards the current target rather than snapping.
 * Weather that teleports reads as a bug, not as weather.
 *
 * It is seeded, so a given seed replays exactly -- which is what makes it
 * testable and makes a shared race fair.
 */

export type WeatherKind = 'clear' | 'fair' | 'overcast' | 'rain' | 'squall' | 'fog';

export interface WeatherProfile {
  cloud: number; // 0..1 sky cover
  rain: number; // 0..1 precipitation
  fog: number; // 0..1 how much the visibility closes in
  windScale: number; // multiplier on mean wind speed
  gustScale: number; // multiplier on gustiness
  /** Typical dwell time in this state, seconds. */
  dwell: number;
}

const PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: { cloud: 0.05, rain: 0, fog: 0.0, windScale: 0.9, gustScale: 0.6, dwell: 420 },
  fair: { cloud: 0.35, rain: 0, fog: 0.02, windScale: 1.0, gustScale: 1.0, dwell: 480 },
  overcast: { cloud: 0.85, rain: 0.05, fog: 0.12, windScale: 1.1, gustScale: 1.15, dwell: 400 },
  rain: { cloud: 0.95, rain: 0.65, fog: 0.3, windScale: 1.15, gustScale: 1.3, dwell: 300 },
  // A squall is short, violent and the most interesting thing that can happen.
  squall: { cloud: 1.0, rain: 0.9, fog: 0.35, windScale: 1.75, gustScale: 1.9, dwell: 110 },
  fog: { cloud: 0.7, rain: 0, fog: 1.0, windScale: 0.55, gustScale: 0.5, dwell: 380 },
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
  ],
  overcast: [
    ['overcast', 2],
    ['fair', 3],
    ['rain', 3],
    ['squall', 1],
    ['fog', 1],
  ],
  rain: [
    ['rain', 2],
    ['overcast', 4],
    ['squall', 2],
  ],
  squall: [
    ['rain', 3],
    ['overcast', 3],
  ],
  fog: [
    ['fog', 3],
    ['clear', 2],
    ['fair', 2],
  ],
};

export interface WeatherState {
  kind: WeatherKind;
  /** Smoothed values actually applied to the world. */
  cloud: number;
  rain: number;
  fog: number;
  windScale: number;
  gustScale: number;
  /** Seconds until the next roll. Shown in the HUD as a "changing soon" hint. */
  timeToChange: number;
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
  private timer = 0;
  /** When false the weather is pinned to whatever it currently is. */
  evolve = true;

  constructor(seed = 1, kind: WeatherKind = 'fair') {
    this.rand = rng(seed);
    this.target = PROFILES[kind];
    this.state = {
      kind,
      cloud: this.target.cloud,
      rain: this.target.rain,
      fog: this.target.fog,
      windScale: this.target.windScale,
      gustScale: this.target.gustScale,
      timeToChange: this.target.dwell,
    };
    this.timer = this.target.dwell;
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

  update(dt: number): void {
    if (this.evolve) {
      this.timer -= dt;
      if (this.timer <= 0) this.roll();
    }
    this.state.timeToChange = Math.max(0, this.timer);

    // Ease towards the target. Wind responds faster than cloud and fog, which
    // is how it feels on the water: the gust arrives before the sky changes.
    const s = this.state;
    const t = this.target;
    s.cloud = ease(s.cloud, t.cloud, 90, dt);
    s.rain = ease(s.rain, t.rain, 60, dt);
    s.fog = ease(s.fog, t.fog, 120, dt);
    s.windScale = ease(s.windScale, t.windScale, 35, dt);
    s.gustScale = ease(s.gustScale, t.gustScale, 35, dt);
  }

  /** Visibility in metres, for fog and rain. */
  get visibility(): number {
    const s = this.state;
    const fogged = 90 + (1 - s.fog) * 2400;
    const rained = 1600 - s.rain * 700;
    return clamp(Math.min(fogged, rained), 90, 2600);
  }
}

function ease(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  fair: 'Fair',
  overcast: 'Overcast',
  rain: 'Rain',
  squall: 'Squall',
  fog: 'Fog',
};

export const WEATHER_KINDS = Object.keys(PROFILES) as WeatherKind[];
