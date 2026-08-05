import { compassVec, type Vec2 } from './math';

/**
 * A windward-leeward race.
 *
 * This course shape is chosen because it forces every sailing skill:
 *  - the upwind leg demands tacking, reading shifts and judging laylines
 *  - the downwind leg demands gybing and trading angle against speed
 *  - mark roundings demand slowing down and accelerating again
 * A round course or a simple A-to-B run drops half of that.
 *
 * The course rotates to match the true wind direction, which is exactly what a
 * race committee does on the water.
 */

export type MarkRounding = 'port' | 'starboard';

export interface Mark {
  id: string;
  name: string;
  pos: Vec2;
  radius: number; // m, rounding zone radius
  rounding: MarkRounding;
  /** Direction of travel on the leg approaching this mark. The rounding axis. */
  axis: Vec2;
}

export type RacePhase = 'prestart' | 'racing' | 'finished';

export interface RaceConfig {
  /** Distance to the windward mark, m. */
  legLength: number;
  /** Length of the start line, m. */
  lineLength: number;
  laps: number;
  /** Countdown to the start, s. */
  countdown: number;
}

/**
 * Default course. The first attempt was 700 m over two laps, which turned out
 * to take twenty-five minutes to sail (an upwind leg covers 1.41 times its
 * straight-line distance because of the tacking). That is a fine club race but
 * far too long for a game, so it was halved.
 */
export const DEFAULT_RACE: RaceConfig = {
  legLength: 380,
  lineLength: 110,
  laps: 2,
  countdown: 45,
};

export interface Gate {
  /** The two ends of the line. */
  a: Vec2;
  b: Vec2;
}

export interface Course {
  cfg: RaceConfig;
  /** True wind direction the course is aligned to, rad. */
  twd: number;
  start: Gate;
  finish: Gate;
  windward: Mark;
  leeward: Mark;
  /** The points that must be taken in order. */
  legs: Leg[];
}

export interface Leg {
  kind: 'start' | 'mark' | 'finish';
  label: string;
  mark?: Mark;
  gate?: Gate;
  /** Target point for this leg, used for distance and layline readouts. */
  target: Vec2;
}

export function buildCourse(cfg: RaceConfig, twd: number, origin: Vec2 = { x: 0, y: 0 }): Course {
  // Unit vector pointing upwind (towards where the wind comes from).
  const up = compassVec(twd);
  const right = { x: up.y, y: -up.x }; // to starboard when heading upwind

  const at = (alongWind: number, across: number): Vec2 => ({
    x: origin.x + up.x * alongWind + right.x * across,
    y: origin.y + up.y * alongWind + right.y * across,
  });

  const half = cfg.lineLength / 2;
  const start: Gate = { a: at(0, -half), b: at(0, half) };
  // Finish across the start line, a common real-world arrangement.
  const finish: Gate = start;

  const windward: Mark = {
    id: 'W',
    name: 'Windward mark',
    pos: at(cfg.legLength, 0),
    radius: 30,
    rounding: 'port',
    axis: up, // the upwind leg climbs towards the wind
  };
  const leeward: Mark = {
    id: 'L',
    name: 'Leeward mark',
    pos: at(-60, 0),
    radius: 30,
    rounding: 'port',
    axis: { x: -up.x, y: -up.y }, // the downwind leg runs back
  };

  const legs: Leg[] = [{ kind: 'start', label: 'Start', gate: start, target: at(0, 0) }];
  for (let lap = 0; lap < cfg.laps; lap++) {
    legs.push({
      kind: 'mark',
      label: `Windward mark (${lap + 1}/${cfg.laps})`,
      mark: windward,
      target: windward.pos,
    });
    if (lap < cfg.laps - 1) {
      legs.push({
        kind: 'mark',
        label: `Leeward mark (${lap + 1}/${cfg.laps})`,
        mark: leeward,
        target: leeward.pos,
      });
    }
  }
  legs.push({ kind: 'finish', label: 'Finish', gate: finish, target: at(0, 0) });

  return { cfg, twd, start, finish, windward, leeward, legs };
}

/** Signed distance of p from segment ab. Positive = left when looking along ab. */
function sideOfLine(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Is the perpendicular projection of p between the ends of the segment? */
function withinSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return t >= 0 && t <= 1;
}

export interface RaceState {
  phase: RacePhase;
  /** Negative before the gun (time to start), elapsed time while racing. */
  clock: number;
  legIndex: number;
  /** Time at each point taken. */
  splits: number[];
  finishTime: number | null;
  /** Crossed the start line early. Must go back before starting. */
  ocs: boolean;
  /** Entered the mark zone on the approach. Rounding only counts once armed. */
  markArmed: boolean;
  /** Which side of the line we were on last frame, for crossing detection. */
  lastLineSide: number;
  message: string;
  messageTimer: number;
}

export function initialRaceState(cfg: RaceConfig): RaceState {
  return {
    phase: 'prestart',
    clock: -cfg.countdown,
    legIndex: 0,
    splits: [],
    finishTime: null,
    ocs: false,
    markArmed: false,
    lastLineSide: 0,
    message: '',
    messageTimer: 0,
  };
}

function say(rs: RaceState, msg: string, seconds = 3.5): void {
  rs.message = msg;
  rs.messageTimer = seconds;
}

/** Advance race judging. Call once per physics step. */
export function updateRace(rs: RaceState, course: Course, pos: Vec2, dt: number): void {
  rs.clock += dt;
  if (rs.messageTimer > 0) {
    rs.messageTimer -= dt;
    if (rs.messageTimer <= 0) rs.message = '';
  }

  if (rs.phase === 'finished') return;

  const leg = course.legs[rs.legIndex];
  if (!leg) return;

  // --- Start and finish lines ---------------------------------------------
  if (leg.gate) {
    const g = leg.gate;
    const s = sideOfLine(g.a, g.b, pos);
    // Never store s === 0 (the instant the boat sits exactly on the line).
    // If lastLineSide becomes zero, the sign-flip test can never fire again and
    // every subsequent crossing -- start, marks, finish -- is silently dead.
    const crossed =
      rs.lastLineSide !== 0 &&
      s !== 0 &&
      Math.sign(s) !== Math.sign(rs.lastLineSide) &&
      withinSegment(g.a, g.b, pos);
    if (s !== 0) rs.lastLineSide = s;

    if (leg.kind === 'start') {
      // The line must be crossed from the downwind side towards the course.
      const goingUp = s > 0;
      if (crossed && goingUp) {
        if (rs.clock < 0) {
          // Over early. As in the real rules, the boat has to return.
          rs.ocs = true;
          say(rs, 'OCS - over early! Return below the line', 5);
        } else {
          rs.phase = 'racing';
          rs.legIndex++;
          rs.markArmed = false;
          rs.splits.push(rs.clock);
          say(rs, `Started, ${rs.clock.toFixed(1)}s late`);
        }
      } else if (crossed && !goingUp && rs.ocs) {
        rs.ocs = false;
        say(rs, 'Clear to restart', 2.5);
      }
      return;
    }

    if (leg.kind === 'finish') {
      const goingDown = s < 0;
      if (crossed && goingDown) {
        rs.phase = 'finished';
        rs.finishTime = rs.clock;
        rs.splits.push(rs.clock);
        say(rs, `Finished, ${formatTime(rs.clock)}`, 12);
      }
      return;
    }
  }

  // --- Mark rounding --------------------------------------------------------
  //
  // "How many degrees has the boat swept around the mark" does not work. A real
  // windward rounding only turns about 90 degrees, so a high threshold never
  // fires and a low one counts merely sailing past. Swept angle is simply the
  // wrong measure.
  //
  // What the rules actually require is two things:
  //   1) did you come close enough (no cutting the corner wide), and
  //   2) did you *pass* the mark with it on the required side
  // which maps directly onto a two-stage arm-then-pass test.
  const mark = leg.mark;
  if (!mark) return;

  const dx = pos.x - mark.pos.x;
  const dy = pos.y - mark.pos.y;
  const dist = Math.hypot(dx, dy);

  // Component along the leg axis. along > 0 means the mark is behind us.
  const along = dx * mark.axis.x + dy * mark.axis.y;
  // The axis rotated 90 degrees clockwise: the starboard side on the approach.
  // A port rounding (mark to port) means the boat must be to starboard of it.
  const across = dx * mark.axis.y - dy * mark.axis.x;
  const wantSide = mark.rounding === 'port' ? 1 : -1;

  if (!rs.markArmed) {
    // Approach: arm only when inside the zone and not yet past the mark.
    if (dist < mark.radius * 2.2 && along < 0) rs.markArmed = true;
  } else if (dist > mark.radius * 4) {
    // Wandered far outside the zone; the approach is void and must be redone.
    rs.markArmed = false;
  } else if (along > 0 && across * wantSide > 0 && dist < mark.radius * 2.2) {
    rs.markArmed = false;
    rs.legIndex++;
    rs.splits.push(rs.clock);
    const next = course.legs[rs.legIndex];
    say(rs, `${mark.name} rounded, ${formatTime(rs.clock)}${next ? ` -> ${next.label}` : ''}`);
  }
}

export function formatTime(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${neg ? '-' : ''}${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/**
 * Distance and bearing to the next target. On an upwind leg the straight-line
 * distance is not the whole story, which is what the layline readout is for.
 */
export interface RaceGuidance {
  legLabel: string;
  distance: number;
  bearing: number; // rad, compass
}

export function guidance(rs: RaceState, course: Course, pos: Vec2): RaceGuidance | null {
  const leg = course.legs[rs.legIndex];
  if (!leg) return null;
  const dx = leg.target.x - pos.x;
  const dy = leg.target.y - pos.y;
  return {
    legLabel: leg.label,
    distance: Math.hypot(dx, dy),
    bearing: Math.atan2(dx, dy),
  };
}
