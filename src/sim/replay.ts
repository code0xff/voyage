/**
 * Ghost replay.
 *
 * When you race alone, the thing that tells you whether you got faster is not
 * the clock -- it is a copy of yourself sailing alongside. "Three seconds
 * quicker" is abstract; edging half a boat length ahead of your own ghost is
 * not.
 *
 * Samples are stored in a flat Float32Array because the recording has to fit in
 * localStorage, and an array of objects would balloon the JSON several times
 * over.
 */

const STRIDE = 5; // t, x, y, heading, heel
export const SAMPLE_INTERVAL = 0.2; // s

export interface GhostSample {
  x: number;
  y: number;
  heading: number;
  heel: number;
}

export class Recorder {
  private data: number[] = [];
  private acc = 0;

  reset(): void {
    this.data.length = 0;
    this.acc = 0;
  }

  record(t: number, x: number, y: number, heading: number, heel: number, dt: number): void {
    this.acc += dt;
    if (this.data.length > 0 && this.acc < SAMPLE_INTERVAL) return;
    this.acc = 0;
    this.data.push(t, x, y, heading, heel);
  }

  get frameCount(): number {
    return this.data.length / STRIDE;
  }

  toArray(): Float32Array {
    return new Float32Array(this.data);
  }
}

export class Ghost {
  constructor(private readonly data: Float32Array) {}

  get duration(): number {
    const n = this.data.length / STRIDE;
    return n === 0 ? 0 : this.data[(n - 1) * STRIDE];
  }

  get isEmpty(): boolean {
    return this.data.length < STRIDE * 2;
  }

  /**
   * Interpolated position at time t. Samples are 0.2 s apart, so without
   * interpolation the ghost would visibly stutter.
   */
  sampleAt(t: number, out: GhostSample): boolean {
    const n = this.data.length / STRIDE;
    if (n < 2) return false;
    if (t < this.data[0]) return false;
    if (t > this.data[(n - 1) * STRIDE]) return false;

    // Timestamps are monotonic, so binary search.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid * STRIDE] <= t) lo = mid;
      else hi = mid;
    }

    const a = lo * STRIDE;
    const b = hi * STRIDE;
    const t0 = this.data[a];
    const t1 = this.data[b];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;

    out.x = this.data[a + 1] + (this.data[b + 1] - this.data[a + 1]) * f;
    out.y = this.data[a + 2] + (this.data[b + 2] - this.data[a + 2]) * f;
    // Heading is an angle: interpolating it naively spins the boat all the way
    // round whenever the recording crosses north.
    const h0 = this.data[a + 3];
    let dh = this.data[b + 3] - h0;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    out.heading = h0 + dh * f;
    out.heel = this.data[a + 4] + (this.data[b + 4] - this.data[a + 4]) * f;
    return true;
  }
}

const KEY = 'voyage.ghost.v1';

export function saveGhost(data: Float32Array, time: number): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ time, data: Array.from(data, (v) => Math.round(v * 100) / 100) }),
    );
  } catch {
    // Quota exceeded, private mode, and so on. A ghost is a nice-to-have; the
    // game works perfectly well without one.
  }
}

export function loadGhost(): { ghost: Ghost; time: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { time: number; data: number[] };
    if (!Array.isArray(o.data) || o.data.length < 10) return null;
    return { ghost: new Ghost(new Float32Array(o.data)), time: o.time };
  } catch {
    return null;
  }
}

const BEST_KEY = 'voyage.best.v1';

export function loadBest(): number | null {
  const raw = localStorage.getItem(BEST_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function saveBest(t: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(t));
  } catch {
    // Ignore: losing a personal best record is not worth breaking the race for.
  }
}
