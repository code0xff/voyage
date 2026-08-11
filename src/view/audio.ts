import type { BoatState, Diagnostics } from '../sim/boat';
import type { WeatherState } from '../sim/weather';
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

/**
 * Rain gets its own noise, and it is white where the water's is brown.
 *
 * Two reasons, and the first is written into this file already: the wave hit
 * failed once because it was the same brown noise as the hull rush, filtered a
 * little differently, and the ear merged the two into one sound. Every layer
 * here plays the *same buffer* from its own source, started at the same moment,
 * so they are phase-locked copies of one another. Rain sitting on top of the
 * rigging noise like that would have thickened the wind rather than arrived.
 *
 * The second is spectral. The water buffer is integrated towards brown on
 * purpose, which is right for flow and swell and wrong for rain: rain is a
 * broad hiss that carries most of its energy well above the wind, and a
 * high-passed brown noise is a thin, tilted version of the wrong thing.
 */
function makeRainNoise(ctx: AudioContext): AudioBuffer {
  const n = ctx.sampleRate * NOISE_SECONDS;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * The rigging sings, and it sings a note.
 *
 * Air past a cylinder sheds vortices alternately off each side, and the rate is
 * a fixed fraction of the speed over the diameter -- the Strouhal relation,
 * `f = St.V/d`, with St about 0.2 for wire in this range. That is why a gale
 * through the rigging is a *pitch* and not just a louder hiss, and why the
 * pitch rises with the wind rather than the volume alone.
 *
 * Three diameters, because a boat is strung with several and they sing a chord
 * rather than a note: cap shrouds, lowers and backstay, and the small stuff.
 * Sizes are typical for a boat this size rather than taken from the config,
 * which does not model standing rigging -- the ratios between them are what is
 * audible, not the absolute millimetres.
 *
 * Resonated noise and not oscillators. A pure tone at a computed frequency is a
 * theremin: real aeolian song wanders, because the shedding is only quasi-
 * periodic and the wind it rides on is turbulent. A high-Q band-pass fed with
 * noise does that for free, and it is the same trick the rest of this file
 * already runs on.
 */
const HOWL = [
  { d: 0.008, q: 13 },
  { d: 0.005, q: 16 },
  { d: 0.003, q: 19 },
] as const;

/** Strouhal number for a circular cylinder, near enough across this range. */
const STROUHAL = 0.2;

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
  private rain: Layer | null = null;
  private howl: Layer[] = [];
  private luffAm: GainNode | null = null;
  private lfo: OscillatorNode | null = null;

  enabled = true;
  private started = false;
  /** Where we are between one wave and the next, rad. */
  private wavePhase = 0;
  /**
   * One-shots already scheduled but not yet heard.
   *
   * Only the blow registers here, because only the blow is scheduled far
   * enough ahead to outlive the world it belongs to: it is placed at up to
   * 1.6 s in the future so that the sound arrives when it would really arrive,
   * and a restart inside that window would otherwise play the previous
   * ocean's whale into the new one. A gull is 0.2 s away and gone.
   */
  private pending: AudioBufferSourceNode[] = [];

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

    const rainNoise = makeRainNoise(ctx);

    const layer = (
      type: BiquadFilterType,
      freq: number,
      q: number,
      buffer: AudioBuffer | null = this.noise,
      offset = 0,
    ): Layer => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain);
      // Offset decorrelates a layer from the others on the same buffer. Every
      // source here plays the same samples, so without it they are phase-locked
      // copies -- which merged two sounds into one once already, and which
      // between the howl voices would have them surging in lockstep instead of
      // wandering against each other.
      src.start(0, offset);
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

    // Rain: a broad hiss, high-passed, opening downward as it gets heavier.
    this.rain = layer('highpass', 1900, 0.7, rainNoise);
    this.rain.gain.connect(master);

    // The rigging's song. White noise rather than the water's brown, so that a
    // voice's loudness does not fall away as its pitch climbs: brown noise
    // sheds about 6 dB an octave, which would make the high voice quieten as
    // the wind got up -- exactly backwards.
    this.howl = HOWL.map((h, i) =>
      layer('bandpass', 400, h.q, rainNoise, i * 0.7 + 0.3),
    );
    for (const h of this.howl) h.gain.connect(master);
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
  /**
   * @param fieldDrift the velocity the wave field itself is being carried at,
   *   m/s. What sets the rate she meets crests is her speed *through the wave
   *   pattern*, and the pattern is no longer standing still.
   */
  update(
    state: BoatState,
    diag: Diagnostics,
    waves: WaveField,
    weather: WeatherState,
    dt: number,
    fieldDrift: { x: number; y: number },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.hull || !this.rig || !this.luff || !this.luffAm || !this.rain) return;
    if (this.howl.length !== HOWL.length) return;
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
    /*
     * Her speed through the wave pattern, which is her ground track less the
     * velocity that pattern is being carried at.
     *
     * This used to be the ground track alone, and the comment here used to
     * explain why: the field was a function of world position and did not drift,
     * so crossing it was the whole of it. The field drifts now. Through the
     * *water* is nearly right and is what this said for one commit, but not
     * quite: the field is carried at the deep-water set while the water under
     * her is throttled by depth, so in the shallows the two differ. A boat
     * merely carried along with the pattern meets the waves at their own period,
     * which is what lying to a tide in a swell sounds like.
     */
    const offBow = diag.cog - state.heading;
    const groundFwd = diag.sog * Math.cos(offBow);
    const groundStb = diag.sog * Math.sin(offBow);
    const driftFwd = fieldDrift.x * Math.sin(state.heading) + fieldDrift.y * Math.cos(state.heading);
    const driftStb = fieldDrift.x * Math.cos(state.heading) - fieldDrift.y * Math.sin(state.heading);
    const enc = dominantEncounter(
      waves,
      state.heading,
      groundFwd - driftFwd,
      groundStb - driftStb,
    );
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

    /*
     * Rain, which until now was something you could only see.
     *
     * Two things move with it, and the second is what stops it being a tap
     * running. Heavy rain is not merely louder drizzle: the drops are bigger
     * and there are far more of them, so the sound fills in downward into a
     * roar. So the high-pass opens as it sets in -- a thin sizzle at the first
     * spits, a broad wash by the time it is raining properly -- and closing
     * that cutoff back up is most of what makes it sound like it is easing.
     *
     * Slow smoothing, and deliberately slower than anything else here. The
     * weather model already eases `rain` over about a minute, and the two
     * together are what keep a squall from arriving as a switch. Nothing else
     * in this mix is allowed to be this lazy, because everything else is the
     * boat answering you; this is the sky, which does not.
     */
    /*
     * The rigging's song, which is what "it is really blowing" sounds like.
     *
     * Pitch is the Strouhal relation and nothing else: it rises with the wind
     * because the shedding rate does. Loudness is a different matter and is not
     * linear -- the radiated power of vortex shedding climbs very steeply with
     * velocity, which is why the song is simply absent in a sailing breeze and
     * then arrives. Squared here rather than the sixth power the dipole
     * suggests: the honest exponent puts everything below a gale at zero, and
     * the point of this is the difference between a fresh breeze and a hard
     * one, not between a gale and a storm.
     *
     * Deliberately quieter than the broadband band it sits in. A tone cuts
     * through noise far better than its level suggests, and this file has just
     * had one lesson about a layer measured right and heard too loud.
     */
    const song = clamp((aws - 7) / 14, 0, 1) ** 2;
    for (let i = 0; i < HOWL.length; i++) {
      const voice = this.howl[i];
      voice.filter.frequency.setTargetAtTime((STROUHAL * aws) / HOWL[i].d, t, 0.12);
      voice.gain.gain.setTargetAtTime(song * 0.075, t, 0.25);
    }

    /*
     * And nothing here for fog, deliberately.
     *
     * The obvious move is to dull and quieten the mix, and it would have been
     * wrong twice over. Fog does attenuate sound -- droplets exchange heat and
     * mass with the air and the loss is real and rises with frequency -- but it
     * is measured over kilometres, and nothing in this game is heard beyond a
     * few hundred metres. Modelling it audibly would mean exaggerating a real
     * effect by a large factor to reach for a cliche.
     *
     * And it is already handled, honestly, by something else. Fog forms in calm
     * air, so the fog profile scales the wind to 0.55, and every layer here is
     * downstream of the apparent wind. Measured at a 20 knot setting: the
     * rigging band falls from 0.114 to 0.062 and the song from 0.011 to
     * 0.0001 -- half the wind noise and no howl at all. The mix goes quiet in
     * fog because there is no wind in fog, which is the actual reason.
     *
     * What fog does change is `gullCall`, where sound reaches further.
     */
    const wet = clamp(weather.rain, 0, 1);
    // Under the wind, not over it. The first attempt at this coefficient was
    // 0.34, which put a squall's rain at 0.31 against the rigging's own ceiling
    // of 0.32 -- two things of equal weight, and the rain won because it is
    // broadband. Rain at sea is loud, but you are hearing it *through* a gale,
    // and the gale is the thing you steer by.
    this.rain.gain.gain.setTargetAtTime(wet * 0.22, t, 0.4);
    this.rain.filter.frequency.setTargetAtTime(1900 - wet * 1050, t, 0.4);
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
  gullCall(distance: number, strength: number, fog = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    /*
     * Fog carries it further, which is the opposite of what fog is supposed to
     * do to sound and is the thing that is actually true.
     *
     * Fog forms under a temperature inversion, and an inversion bends sound
     * back down instead of letting it escape upward. That is why a fog signal
     * is heard a long way before anything is seen, and it is the whole
     * character of fog at sea: you hear what you cannot see. Doubling and a
     * half at full fog, so a gull at 500 m goes from a quarter of its close
     * loudness to a half.
     */
    const gain = this.carry(distance, 200 * (1 + clamp(fog, 0, 1) * 1.5)) * strength * 0.16;
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

  /**
   * A whale's blow.
   *
   * Noise and not an oscillator, which is the whole difference from the gull:
   * this is a lungful of air leaving under pressure, so it is broadband, and
   * the shape of it is entirely in the envelope. An abrupt front edge, a body
   * that empties in about a second, and a wet hiss that outlives it.
   *
   * It carries much further than a gull -- a humpback blow is genuinely loud,
   * and on a calm day you hear one before you find it, which is exactly the
   * job it does here: the sighting opens at 220-560 m, where the animal itself
   * is a few pixels, and this is what tells you there is something to look at
   * and roughly where.
   *
   * @param distance metres from the boat, for the fall-off and the delay
   * @param size the whale's length in metres; a bigger animal blows deeper
   * @param fog carries sound further, for the reason set out in gullCall
   * @returns whether anything was actually scheduled. The caller uses this to
   *   decide the encounter has been dealt with -- there is no point marking a
   *   blow heard when the context was suspended and nothing was built, because
   *   the phase is four seconds long and audio may well come back inside it.
   */
  whaleBlow(distance: number, size: number, fog = 0): boolean {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise || ctx.state !== 'running') return false;

    const gain = this.carry(distance, 520 * (1 + clamp(fog, 0, 1) * 1.5)) * 0.5;
    if (gain < 0.01) return false;

    /*
     * Heard late, by however long the sound takes to arrive.
     *
     * 343 m/s, so a blow at 400 m is heard more than a second after the spout
     * is drawn. This is free -- WebAudio schedules against its own clock, so it
     * costs one addition -- and it is one of the few places where the delay is
     * long enough to notice and true enough to be worth having. It is also the
     * right way round: you see the spout, and then it reaches you.
     */
    const t = ctx.currentTime + distance / 343;
    // Bigger animals blow lower. Referenced to a 15 m adult so the constants
    // below read as the sound rather than as a ratio.
    const scale = 15 / clamp(size, 8, 25);

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
      g.gain.linearRampToValueAtTime(peak * gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      src.connect(f).connect(g).connect(master);
      src.start(t0, Math.random() * 2);
      src.stop(t0 + attack + decay + 0.05);
      this.pending.push(src);
      src.onended = () => {
        const i = this.pending.indexOf(src);
        if (i >= 0) this.pending.splice(i, 1);
      };
    };

    // The lungful. A 25 ms edge, which is as sharp as anything in this file --
    // a blow is a burst, and softening it turned it into a passing wave.
    layer('bandpass', 320 * scale, 0.8, 0, 0.025, 0.85, 1);
    // Spray, and the breath still going after the crack of it has gone. Late,
    // slow and bright: this is the half that says water rather than air.
    layer('highpass', 1900 * scale, 0.4, 0.05, 0.16, 1.1, 0.42);
    return true;
  }

  /**
   * Drop anything scheduled but not yet heard.
   *
   * For a new world, where the sound in flight belongs to an ocean that no
   * longer exists. Not called on pause: a blow already on its way is a second
   * of air travel rather than a state of the simulation, and silencing it there
   * would mean pausing at the wrong instant quietly ate the whale.
   */
  silencePending(): void {
    for (const src of this.pending) {
      try {
        src.stop();
      } catch {
        // Already finished between the check and here; nothing to stop.
      }
    }
    this.pending.length = 0;
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
