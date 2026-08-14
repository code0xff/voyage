import { compassVec, wrap2Pi, type Vec2 } from './math';
import { fbm2 } from './noise';
import type { Environment } from './config';
import { EMPTY_TERRAIN, type TerrainQuery } from './terrain';

/**
 * A wind field that varies with position and drifts downwind over time.
 *
 * Why this exists: with a constant wind there is no tactical layer at all.
 * Find the optimum angle once and you are done forever. What makes real
 * sailing interesting is
 *   - seeing a puff running across the water and setting up for it
 *   - reading a shift and tacking onto the favoured side
 * and neither is possible unless the wind is a function of *where you are*.
 *
 * The puff pattern is a fixed noise field, and the whole field is advected
 * downwind. That is what makes "there is a puff coming from over there" a true
 * statement rather than a decoration.
 */

/** Size of a single puff, in metres. Smaller is more frantic. */
const GUST_SCALE = 130;
/** Spatial scale of shifts. Must dwarf the puff scale for "a favoured side" to exist. */
const SHIFT_SCALE = 620;
/** How fast the puff pattern drifts downwind, relative to true wind speed. */
export const ADVECTION = 0.8;

export interface WindSample {
  tws: number;
  twd: number;
  /** Strength relative to the mean. 1 = average, >1 = puff, <1 = lull. */
  gust: number;
  /** Direction offset from the mean, rad. Positive = right shift. */
  shift: number;
  /** How much wind survives the land shadow here, 0..1. */
  exposure: number;
}

export class WindField {
  /** Mean true wind speed, m/s. */
  baseTws: number;
  /** Mean true wind direction (the direction it blows from), rad. */
  baseTwd: number;
  /** 0 = dead steady, 1 = very gusty. */
  gustiness: number;
  /** Shift amplitude, rad. */
  shiftAmplitude: number;
  /**
   * Land that steals the wind. Kept inside the wind field rather than composed
   * outside it so that "the wind at a point" has exactly one definition, shared
   * by the physics and by the streaks drawn on the water.
   */
  terrain: TerrainQuery = EMPTY_TERRAIN;

  private t = 0;
  /**
   * How far the puff pattern has been carried downwind so far, m.
   *
   * Integrated, not computed from the elapsed time. It used to be
   * `baseTws * ADVECTION * t`, which reads the *current* wind speed back over
   * the *whole* history: change the wind and every second already sailed is
   * re-advected at the new speed, so the pattern teleports. Harmless while the
   * mean wind never moved; once the weather started turning inside a session,
   * a squall thirty minutes in swept the entire puff field past the boat at
   * about 590 knots. What has blown is what has blown, so it is accumulated.
   */
  private driftX = 0;
  private driftY = 0;
  private seed: number;

  constructor(baseTws: number, baseTwd = 0, gustiness = 0.45, shiftAmplitude = 0.19, seed = 1337) {
    this.baseTws = baseTws;
    this.baseTwd = baseTwd;
    this.gustiness = gustiness;
    this.shiftAmplitude = shiftAmplitude;
    this.seed = seed;
  }

  /**
   * Sail a different sea.
   *
   * The seed places the puffs and the shifts, so it is what "the same water
   * twice" actually means once the land is fixed -- in a surveyed region it is
   * the only thing about the sailing that can vary at all. The drift is reset
   * with it because it is an accumulated history of a pattern that no longer
   * exists.
   */
  reseed(seed: number): void {
    this.seed = seed;
    this.driftX = 0;
    this.driftY = 0;
    this.t = 0;
  }

  update(dt: number): void {
    this.t += dt;
    // Direction as well as speed: turn the mean wind and the pattern starts
    // travelling the new way from here, rather than from the beginning.
    const windDir = compassVec(this.baseTwd);
    this.driftX -= windDir.x * this.baseTws * ADVECTION * dt;
    this.driftY -= windDir.y * this.baseTws * ADVECTION * dt;
  }

  get time(): number {
    return this.t;
  }

  /** The mean environment, for steady-state work such as the polar solver. */
  meanEnv(base: Environment): Environment {
    return { ...base, tws: this.baseTws, twd: this.baseTwd };
  }

  /**
   * The wind at a point, read through the same formulas the renderer's batch
   * path (`sampleInto`) uses for the streaks on the water. If the puff drawn
   * and the puff the boat actually hits were to diverge, the player could not
   * trust what they see, and the whole tactical layer would collapse.
   *
   * @param leadSeconds look ahead: the wind that will have *arrived* here by
   *   then, rather than the wind here now.
   *
   * One extra field sample per reading is all a forecast costs, and that it is
   * possible at all is the whole reason the pattern is a fixed field rather
   * than noise in time. The air that reaches a point in ten seconds is upwind
   * of it right now by however far the pattern travels in ten seconds, so the
   * forecast is the present field read at a shifted coordinate. Reading the
   * water ahead is what a helmsman actually does, and until this existed the
   * readouts could only report a puff once it had already arrived.
   *
   * Right while the field's own knobs hold still, which is not quite always.
   * The lead is worked from `baseTws` and `baseTwd` as they are now; the
   * weather moves the speed and the gustiness, and the direction moves only by
   * the player's hand. A speed change in flight carries the pattern a little
   * further or less far than assumed -- a few metres out of fifty over ten
   * seconds against the weather's 22-second ease -- and a gustiness change
   * rescales the puff that does arrive. It degrades the way a real forecast
   * does, and integrating a future drift it cannot know would not fix it.
   *
   * `exposure` is not led -- a land shadow is a fact about where the boat is,
   * not about where the air has come from, and the wind field has no idea
   * where she will have sailed to. Which means `tws`, being the product of the
   * led gust and the present exposure, is a hybrid under a lead and not a
   * forecast of anything. Callers that want the forecast want `gust` and
   * `shift`, and the one caller that asks ahead reads exactly those.
   */
  sample(pos: Vec2, leadSeconds = 0): WindSample {
    // The noise field is fixed; rewinding the sample coordinate upwind is what
    // makes the whole pattern drift downwind.
    const driftX = this.driftX;
    const driftY = this.driftY;
    // Upwind by exactly what the drift will have added by then, which is what
    // makes this the future field and not a guess at it. Skipped entirely at
    // no lead, so the physics' 120 Hz call keeps its exact old arithmetic.
    let leadX = 0;
    let leadY = 0;
    if (leadSeconds !== 0) {
      const up = compassVec(this.baseTwd);
      leadX = up.x * this.baseTws * ADVECTION * leadSeconds;
      leadY = up.y * this.baseTws * ADVECTION * leadSeconds;
    }

    const gx = (pos.x + leadX - driftX) / GUST_SCALE;
    const gy = (pos.y + leadY - driftY) / GUST_SCALE;
    // 0..1 -> -1..1
    const g = fbm2(gx, gy, this.seed, 3) * 2 - 1;

    // The shift pattern is carried at 0.55 of the gust pattern's rate, so its
    // lead has to be scaled by the same 0.55 or the two would be forecasts of
    // different moments -- the puff right and the shift somewhere past it.
    const sx = (pos.x + leadX * 0.55 - driftX * 0.55) / SHIFT_SCALE;
    const sy = (pos.y + leadY * 0.55 - driftY * 0.55) / SHIFT_SCALE;
    const s = fbm2(sx, sy, this.seed + 4111, 2) * 2 - 1;

    // Real wind gusts harder than it lulls, so the response is asymmetric.
    const gust = 1 + this.gustiness * (g > 0 ? g * 0.5 : g * 0.35);
    const shift = s * this.shiftAmplitude;
    const exposure = this.terrain.windExposure(pos.x, pos.y, this.baseTwd);

    return {
      tws: Math.max(0.2, this.baseTws * gust * exposure),
      twd: wrap2Pi(this.baseTwd + shift),
      gust,
      shift,
      exposure,
    };
  }

  /**
   * Batch sample for the renderer. Called hundreds of times per frame, so it
   * writes [gust, shift] into a caller-owned array instead of allocating.
   *
   * The renderer needs the shift as well as the gust: if it only drew gusts,
   * shifts would be completely invisible on screen, and something the player
   * cannot see might as well not exist.
   */
  sampleInto(x: number, y: number, out: [number, number]): void {
    const driftX = this.driftX;
    const driftY = this.driftY;

    const g = fbm2((x - driftX) / GUST_SCALE, (y - driftY) / GUST_SCALE, this.seed, 3) * 2 - 1;
    const s =
      fbm2(
        (x - driftX * 0.55) / SHIFT_SCALE,
        (y - driftY * 0.55) / SHIFT_SCALE,
        this.seed + 4111,
        2,
      ) *
        2 -
      1;

    out[0] =
      (1 + this.gustiness * (g > 0 ? g * 0.5 : g * 0.35)) *
      this.terrain.windExposure(x, y, this.baseTwd);
    out[1] = s * this.shiftAmplitude;
  }
}
