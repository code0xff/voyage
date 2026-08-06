/**
 * A rolling time-series plot.
 *
 * Where the polar answers "is the steady state right", this answers "is the
 * transient any fun". How much speed a tack costs and how quickly it comes
 * back, how heel spikes when a puff hits -- none of that is visible in a single
 * number. It is essential for tuning feel.
 */

export interface Channel {
  label: string;
  color: string;
  /** Vertical range of the plot. */
  min: number;
  max: number;
  data: Float32Array;
}

export class Telemetry {
  readonly capacity: number;
  private head = 0;
  private filled = 0;
  private acc = 0;
  readonly channels: Channel[];
  /** Sample interval, seconds. */
  readonly interval: number;

  constructor(
    specs: Omit<Channel, 'data'>[],
    seconds = 60,
    interval = 0.1,
  ) {
    this.interval = interval;
    this.capacity = Math.round(seconds / interval);
    this.channels = specs.map((s) => ({ ...s, data: new Float32Array(this.capacity) }));
  }

  /** Call every frame; it rate-limits sampling internally. */
  push(dt: number, values: number[]): void {
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;
    for (let i = 0; i < this.channels.length; i++) {
      this.channels[i].data[this.head] = values[i] ?? 0;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** Iterate oldest sample first. */
  forEach(ch: Channel, fn: (value: number, i: number, n: number) => void): void {
    const n = this.filled;
    const start = (this.head - n + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) {
      fn(ch.data[(start + i) % this.capacity], i, n);
    }
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
    for (const c of this.channels) c.data.fill(0);
  }
}

export function drawTelemetry(
  ctx: CanvasRenderingContext2D,
  tel: Telemetry,
  w: number,
  h: number,
  gridColor: string,
): void {
  ctx.clearRect(0, 0, w, h);

  const pad = 2;
  const gh = h - pad * 2;

  // Background gridlines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = pad + (gh * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  for (const ch of tel.channels) {
    ctx.beginPath();
    let started = false;
    tel.forEach(ch, (v, i, n) => {
      if (n < 2) return;
      const x = (i / (n - 1)) * w;
      const t = (v - ch.min) / (ch.max - ch.min);
      const y = pad + gh * (1 - Math.min(Math.max(t, 0), 1));
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // Legend
  ctx.font = '9px ui-monospace, "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  let lx = 4;
  for (const ch of tel.channels) {
    ctx.fillStyle = ch.color;
    ctx.fillText(ch.label, lx, 11);
    lx += ctx.measureText(ch.label).width + 9;
  }
}
