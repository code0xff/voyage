import type { BoatState, Diagnostics } from '../sim/boat';
import { TAU, clamp } from '../sim/math';
import { dominantEncounter, waveHitStrength, type WaveField } from '../sim/waves';

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
  /** Where we are between one wave and the next, rad. */
  private wavePhase = 0;

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

  /**
   * One wave arriving at the hull.
   *
   * Two attempts got this wrong in instructive ways, so both are written down.
   *
   * The first could not be heard at all: it was the *same brown noise* as the
   * hull rush, filtered darker than it and barely louder, and the ear simply
   * merged the two. A wave arriving has to be a different sound, not a louder
   * one.
   *
   * The second was heard, and was a drum. A bandpass starting bright and
   * sweeping down behind a ten-millisecond attack is the signature of something
   * being struck -- a hard front edge, then a darkening body. Water does none
   * of that. It has no attack worth the name; it swells and drains. And its
   * bright part arrives *after* the low part, not before, because the mass of
   * water lands first and the foam that hisses is what the impact leaves
   * behind.
   *
   * So: two layers from the one noise source. A low body with a soft front,
   * and a brighter wash that starts late, peaks later still, and outlives it by
   * a second. Nothing here is struck.
   */
  private waveHit(strength: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;
    const s = clamp(strength, 0, 1);
    const t = ctx.currentTime;

    const layer = (
      type: BiquadFilterType,
      freq: number,
      q: number,
      delay: number,
      attack: number,
      decay: number,
      peak: number,
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      const t0 = t + delay;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      src.connect(f).connect(g).connect(master);
      src.start(t0, Math.random() * 2);
      src.stop(t0 + attack + decay + 0.05);
    };

    // The mass of water. Low, and the front edge is deliberately blunt: at
    // twenty milliseconds this read as a knock, so it is four times slower than
    // anything that could be called a hit.
    layer('lowpass', 240 + s * 260, 0.7, 0, 0.085, 0.5 + s * 0.35, 0.15 + s * 0.28);

    // Foam running aft. Starts after the water has landed, takes its time
    // building, and is still hissing when the body has gone. This is the half
    // that separates the sound from the hull rush, which is why it is the
    // bright one.
    layer('bandpass', 1500 + s * 1300, 0.5, 0.055, 0.19, 0.85 + s * 0.5, 0.07 + s * 0.2);
  }

  /**
   * Per frame. Gains move with setTargetAtTime; assigning them directly clicks
   * on every frame boundary.
   */
  update(
    state: BoatState,
    diag: Diagnostics,
    waves: WaveField,
    dt: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.hull || !this.rig || !this.luff || !this.luffAm) return;
    if (ctx.state !== 'running') return;

    const t = ctx.currentTime;
    const smooth = 0.09;

    // Meeting the waves.
    //
    // The rush along the hull is not steady. It rises as the bow drives into a
    // crest and falls away in the trough, and the rate of that is the encounter
    // frequency -- so a head sea is busy and a following sea is slow at the
    // same boat speed and the same wave height. Nothing else in the mix carries
    // your angle to the sea, and it is something a helmsman hears long before
    // reading it off an instrument.
    //
    // Driven from JS rather than an audio-rate oscillator, unlike the luff:
    // this is well under a hertz, so a 60 Hz update is far finer than the shape
    // it is drawing, and setTargetAtTime smooths what is left.
    const enc = dominantEncounter(waves, state.heading, state.u, state.v);
    this.wavePhase += enc.omega * dt;
    if (this.wavePhase >= TAU) {
      this.wavePhase -= TAU;
      // One wave, one sound.
      //
      // This used to be a threshold on slamImpact(), and measuring it showed
      // the sound had never once played: the trigger wanted 1.6 and eighty
      // minutes of sailing from 12 to 32 knots never produced more than 0.99.
      // It was written for a boat that pounds into short steep water, and this
      // model's boat heaves over long swell.
      //
      // Firing on the encounter instead needs no threshold and no rate limit,
      // because the encounter frequency *is* the rate: busy beating, slow
      // running, and silent when she keeps station with the crest and stops
      // meeting waves at all.
      //
      // Varied per wave, because the trigger runs off the dominant train alone
      // and that is one clean sine: every wave would arrive at exactly the same
      // strength and the sea would tick like a metronome. Real wave heights in
      // a seaway scatter widely about the significant height, so this is the
      // honest correction as well as the one that sounds like water.
      const hit = waveHitStrength(enc, diag.speed) * (0.7 + Math.random() * 0.6);
      if (hit > 0.03) this.waveHit(hit);
    }
    // Deep in a big sea, almost flat in a slop. Never all the way to silence in
    // the trough: the water does not stop touching the hull.
    const depth = clamp(enc.amp * 0.42, 0, 0.62);
    const beat = 1 + Math.sin(this.wavePhase) * depth;

    // Water rush, roughly cubic in speed. Real flow noise goes as v^5 or v^6,
    // but that leaves low speeds completely silent and lifeless.
    const sp = diag.speed;
    this.hull.gain.gain.setTargetAtTime(clamp(sp * sp * 0.014 * beat, 0, 0.6), t, smooth);
    // Brighter as she meets them harder: the same water going past faster.
    this.hull.filter.frequency.setTargetAtTime(320 + sp * 150 + enc.omega * beat * 90, t, smooth);

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

  }

  /**
   * How loud something is from here.
   *
   * Sound outdoors over water falls off close to inverse-distance. The
   * reference is how far the thing carries -- a couple of hundred metres for a
   * gull. Anything inaudible is dropped rather than played at zero gain,
   * because each call builds a small node graph and paying for one nobody can
   * hear is pure waste.
   */
  private carry(distance: number, reference: number): number {
    return reference / (reference + Math.max(distance, 1));
  }

  /**
   * A gull. Tonal rather than noisy, so this is an oscillator: two or three
   * descending cries, which is the shape of the call people know.
   */
  gullCall(distance: number, strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const gain = this.carry(distance, 200) * strength * 0.16;
    if (gain < 0.01) return;

    const t0 = ctx.currentTime;
    const cries = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < cries; i++) {
      const t = t0 + i * (0.22 + Math.random() * 0.1);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = 900 + Math.random() * 350;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.55, t + 0.18);
      // A narrow band keeps the sawtooth from sounding like a buzzer.
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(base * 1.2, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(f).connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
