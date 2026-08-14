import { DEG, approach } from './math';

/**
 * Watching for a tack or a gybe, and saying what it cost.
 *
 * The one thing a player practises in this game is putting the bow through the
 * wind, and until this existed the game never answered it: the physics charged
 * for a bad tack in boat speed, and boat speed is a continuous number that
 * never says "that was the turn". A tack that comes out reading "9s, lost
 * 2.1 kn" is a skill with a measure, and one that reads "23s, lost 3.8 kn" is
 * its own explanation of what went wrong.
 *
 * Detection is from a signed wind angle alone -- positive means the wind over
 * the starboard side -- crossing zero for a tack and 180 for a gybe, with the
 * boundary read off how large the angle was as it flipped.
 *
 * The angle handed in must be to the **mean** wind, not the local one. The
 * whole scheme rests on the sign only changing when the boat herself crosses
 * the wind, and against the local wind that is not true: the shift can swing
 * the sign across the bow of a boat holding her course, arming turns nobody
 * made and reading a real tack as an abort when it swings back mid-turn.
 * Against the mean wind the sign is the boat's to change -- the engine feeds
 * `baseTwd - heading` -- and the few degrees it disagrees with the panel's TWA
 * are nothing against bands drawn thirty degrees wide.
 */

export type ManeuverKind = 'tack' | 'gybe';

export interface Maneuver {
  kind: ManeuverKind;
  /** Seconds from the crossing to being settled and back up to speed. */
  seconds: number;
  /** m/s the turn cost: the way she carried in, less the low point. */
  lost: number;
  /** m/s, the speed she carried into the turn. */
  entrySpeed: number;
}

/**
 * Clearly on one side and clearly sailing: the band in which a tack is a fact
 * and not a flicker.
 *
 * The lower edge is what separates a tack from wobbling in irons -- near zero
 * the sign of TWA dithers with every shift, and a "side" read there means
 * nothing. The upper edge does the same work at the other boundary, where a
 * dead run dithers across 180.
 */
const SIDE_KNOWN_LO = 30 * DEG;
const SIDE_KNOWN_HI = 150 * DEG;

/**
 * How far onto the new gybe she must come for the gybe to have happened,
 * measured off dead astern: 180 - 160 = 20 degrees of commitment.
 *
 * This is the filter that keeps a dead run quiet. Running deep, the wind's own
 * shifts carry TWA back and forth across 180, and the boom crossing on a shift
 * is physically a gybe -- but reporting "GYBE, lost 0.0 kn" every time the
 * breeze wanders would bury the reports that mean something. A blow-through
 * never commits twenty degrees to the new side; a steered gybe does.
 */
const GYBE_DONE = 160 * DEG;

/** Recovered means back to this fraction of the speed she carried in. */
const RECOVERED = 0.9;

/**
 * m/s. Below this there is no way to lose and nothing worth judging: a boat
 * brought head to wind from a standstill is manoeuvring, not tacking.
 */
const MIN_ENTRY = 1.0;

/**
 * Seconds before an unfinished maneuver is dropped without a report.
 *
 * Not a judgement on a slow tack -- a botched one that hangs in irons for
 * half a minute and claws out still reports, and that report is the useful
 * kind. This is for the turn that never completes at all: the wind died under
 * her, or she was left head to wind on purpose. There is no honest number to
 * print for those.
 *
 * Exported because the tests have to outlast it, and a test that writes the
 * seconds out stops covering the timeout the day it is retuned -- the shark's
 * dive and the gull flock both taught that lesson already.
 */
export const MANEUVER_TIMEOUT = 120;

/**
 * Seconds of lag on the entry-speed reference.
 *
 * The speed she "carried in" must not be the speed at the instant of crossing,
 * which is already down -- the luff up to the wind sheds way before the bow
 * ever gets there. A first-order lag a few seconds long remembers the speed
 * she was actually making on the old tack.
 */
const REF_TAU = 3;

/** Which side of the boat the wind is on. Zero counts as starboard, so the answer is always one or the other. */
const sideOf = (twa: number): 1 | -1 => (twa >= 0 ? 1 : -1);

const sideKnown = (twa: number): boolean => {
  const m = Math.abs(twa);
  return m > SIDE_KNOWN_LO && m < SIDE_KNOWN_HI;
};

interface Turning {
  kind: ManeuverKind;
  /** The side the wind was on before the crossing. */
  from: 1 | -1;
  entry: number;
  min: number;
  seconds: number;
}

export class ManeuverTracker {
  /** The side last known for certain, or null when there is nothing to arm from. */
  private side: 1 | -1 | null = null;
  /** Lagged speed: what she was making before any of this started. */
  private ref = 0;
  private prev = 0;
  private primed = false;
  private turning: Turning | null = null;

  /**
   * One step. Returns the finished maneuver on the step it completes, else null.
   *
   * @param twa signed angle to the mean wind, rad -- positive is wind over
   *   starboard. See the note above on why the local TWA must not be fed here.
   * @param speed her speed through the water, m/s
   */
  update(twa: number, speed: number, dt: number): Maneuver | null {
    if (!this.primed) {
      this.primed = true;
      this.prev = twa;
      this.ref = speed;
      if (sideKnown(twa)) this.side = sideOf(twa);
      return null;
    }

    const wasSide = sideOf(this.prev);
    const flipped = sideOf(twa) !== wasSide;
    const wasNearBow = Math.abs(this.prev) < Math.PI / 2;
    this.prev = twa;

    if (this.turning) {
      const turn = this.turning;
      turn.seconds += dt;
      if (speed < turn.min) turn.min = speed;

      if (sideKnown(twa) && sideOf(twa) === turn.from) {
        // She came back. An aborted tack is not a tack, and reporting one
        // would charge the player for a maneuver they decided against.
        this.turning = null;
        this.side = turn.from;
        this.ref = speed;
        return null;
      }

      const m = Math.abs(twa);
      const settled = sideOf(twa) !== turn.from && m > SIDE_KNOWN_LO && m < GYBE_DONE;
      if (settled && speed >= RECOVERED * turn.entry) {
        this.turning = null;
        this.side = sideOf(twa);
        this.ref = speed;
        return {
          kind: turn.kind,
          seconds: turn.seconds,
          // Clamped, because the reference lags: a boat still accelerating
          // into a gust as she turns can bottom out above the speed the lag
          // remembers, and a negative loss is not a fact about the turn.
          lost: Math.max(0, turn.entry - turn.min),
          entrySpeed: turn.entry,
        };
      }

      if (turn.seconds > MANEUVER_TIMEOUT) {
        this.turning = null;
        // The side is genuinely unknown now -- she has been neither here nor
        // there for two minutes -- so nothing arms until she settles somewhere.
        this.side = null;
      }
      return null;
    }

    if (flipped && this.side !== null) {
      this.side = null;
      if (this.ref >= MIN_ENTRY) {
        this.turning = {
          kind: wasNearBow ? 'tack' : 'gybe',
          from: wasSide,
          entry: this.ref,
          min: speed,
          seconds: 0,
        };
      }
      return null;
    }

    if (sideKnown(twa)) this.side = sideOf(twa);
    this.ref = approach(this.ref, speed, REF_TAU, dt);
    return null;
  }

  /** Forget everything, for a teleport or a new world. A jump is not a turn. */
  reset(): void {
    this.side = null;
    this.turning = null;
    this.primed = false;
  }
}
