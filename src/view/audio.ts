import type { BoatState, Diagnostics } from '../sim/boat';
import { clamp } from '../sim/math';

/**
 * Procedural sound: everything is synthesised with WebAudio, no audio files.
 *
 * Half of how immersive this feels is sound. Sailing is a visually quiet
 * activity, and there are plenty of moments where the only thing telling you
 * whether the boat is loaded up is what you can hear. A luffing sail is easy to
 * miss on screen and impossible to miss through the speakers.
 *
 * It is all one noise buffer split apart by filters. No files means no loading,
 * and the result responds continuously to wind and boat speed.
 */

const NOISE_SECONDS = 3;

function makeNoise(ctx: AudioContext): AudioBuffer {
  const n = ctx.sampleRate * NOISE_SECONDS;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Integrating towards brown noise gives a low-heavy spectrum, which is a good
  // base for water sounds.
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5 + w * 0.25;
  }
  return buf;
}

interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hull: Layer | null = null;
  private rig: Layer | null = null;
  private luff: Layer | null = null;
  private luffAm: GainNode | null = null;
  private lfo: OscillatorNode | null = null;

  enabled = true;
  private started = false;
  private lastSlam = 0;
  private clock = 0;

  get isRunning(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  /** Must be called inside a user gesture; browsers block audio before that. */
  async start(): Promise<void> {
    if (this.started) {
      await this.ctx?.resume();
      return;
    }
    this.started = true;

    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = makeNoise(ctx);

    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.9 : 0;
    master.connect(ctx.destination);
    this.master = master;

    const layer = (type: BiquadFilterType, freq: number, q: number): Layer => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain);
      src.start();
      return { filter, gain };
    };

    // Hull through water: low-heavy, cutoff rising with speed
    this.hull = layer('lowpass', 400, 0.9);
    this.hull.gain.connect(master);

    // Wind through the rigging: a mid-high band
    this.rig = layer('bandpass', 900, 1.4);
    this.rig.gain.connect(master);

    // Sail flogging: band-passed noise amplitude-modulated by an LFO. Driving
    // the gain from JS each frame would quantise it to 60 Hz and sound stepped,
    // so this runs at audio rate.
    this.luff = layer('bandpass', 1500, 0.9);
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.85;
    lfo.connect(lfoGain).connect(am.gain);
    lfo.start();
    this.luff.gain.connect(am).connect(master);
    this.luffAm = am;
    this.lfo = lfo;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  /** Short impact when a wave slams the bow. */
  private slam(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 240 + strength * 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clamp(strength, 0, 1) * 0.55, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.55);
  }

  /**
   * Per frame. Gains move with setTargetAtTime; assigning them directly clicks
   * on every frame boundary.
   */
  update(
    state: BoatState,
    diag: Diagnostics,
    tws: number,
    bowRise: number,
    dt: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.hull || !this.rig || !this.luff || !this.luffAm) return;
    if (ctx.state !== 'running') return;

    this.clock += dt;
    const t = ctx.currentTime;
    const smooth = 0.09;

    // Water rush, roughly cubic in speed. Real flow noise goes as v^5 or v^6,
    // but that leaves low speeds completely silent and lifeless.
    const sp = diag.speed;
    this.hull.gain.gain.setTargetAtTime(clamp(sp * sp * 0.014, 0, 0.5), t, smooth);
    this.hull.filter.frequency.setTargetAtTime(320 + sp * 150, t, smooth);

    // Rigging noise follows apparent wind: on board that is what you hear.
    const aws = diag.aws;
    this.rig.gain.gain.setTargetAtTime(clamp((aws - 2) * 0.011, 0, 0.32), t, smooth);
    this.rig.filter.frequency.setTargetAtTime(620 + aws * 62, t, smooth);

    // Luffing: the sail flogs in proportion to the drive it has lost.
    const luffAmount = clamp(1 - diag.luffing, 0, 1);
    this.luff.gain.gain.setTargetAtTime(luffAmount * clamp(aws * 0.028, 0, 0.55), t, 0.05);
    if (this.lfo) {
      // Harder wind means faster flogging
      this.lfo.frequency.setTargetAtTime(6 + clamp(aws * 0.5, 0, 9), t, 0.2);
    }
    this.luffAm.gain.setTargetAtTime(luffAmount > 0.02 ? 0.9 : 0, t, 0.05);

    // Slamming as the bow drops into a trough. Rate-limited or it becomes noise.
    const impact = -state.pitchRate * 2 - bowRise * 0.5;
    if (impact > 1.6 && this.clock - this.lastSlam > 0.55 && tws > 3) {
      this.lastSlam = this.clock;
      this.slam(clamp((impact - 1.6) * 0.5, 0.15, 1));
    }
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
