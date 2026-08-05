import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RACE,
  buildCourse,
  initialRaceState,
  updateRace,
  type Course,
  type RaceState,
} from './race';
import type { Vec2 } from './math';

/**
 * Race judging is driven with synthetic paths rather than by actually sailing
 * the boat. Two very different things can be wrong -- "can the boat get there"
 * and "does the rule fire" -- and mixing them makes both untestable.
 */
const DT = 1 / 30;

function drive(rs: RaceState, course: Course, from: Vec2, to: Vec2, seconds: number): Vec2 {
  const n = Math.round(seconds / DT);
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    updateRace(rs, course, { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }, DT);
  }
  return to;
}

function wait(rs: RaceState, course: Course, at: Vec2, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) updateRace(rs, course, at, DT);
}

/** Round a mark the correct way: bearing from mark to boat sweeps forward. */
function roundMark(rs: RaceState, course: Course, centre: Vec2, from: Vec2, seconds: number): Vec2 {
  const r = Math.hypot(from.x - centre.x, from.y - centre.y);
  const a0 = Math.atan2(from.x - centre.x, from.y - centre.y);
  const n = Math.round(seconds / DT);
  let p = from;
  for (let i = 1; i <= n; i++) {
    const a = a0 + Math.PI * 1.15 * (i / n);
    p = { x: centre.x + Math.sin(a) * r, y: centre.y + Math.cos(a) * r };
    updateRace(rs, course, p, DT);
  }
  return p;
}

describe('course layout', () => {
  it('aligns with the true wind direction', () => {
    // Wind from the north: upwind is +y, so the windward mark sits north.
    const north = buildCourse(DEFAULT_RACE, 0);
    expect(north.windward.pos.y).toBeCloseTo(DEFAULT_RACE.legLength, 5);
    expect(north.windward.pos.x).toBeCloseTo(0, 5);

    // Wind from the east: the whole course rotates with it.
    const east = buildCourse(DEFAULT_RACE, Math.PI / 2);
    expect(east.windward.pos.x).toBeCloseTo(DEFAULT_RACE.legLength, 5);
    expect(east.windward.pos.y).toBeCloseTo(0, 5);
  });

  it('visits every mark once per lap plus a finish', () => {
    const c = buildCourse({ ...DEFAULT_RACE, laps: 3 }, 0);
    const marks = c.legs.filter((l) => l.kind === 'mark');
    expect(marks).toHaveLength(5); // W L W L W
    expect(c.legs.at(-1)!.kind).toBe('finish');
  });
});

describe('start line', () => {
  it('flags an early crossing as OCS and clears it on the way back', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);

    const p = drive(rs, course, { x: 0, y: -80 }, { x: 0, y: 30 }, 10);
    expect(rs.ocs).toBe(true);
    expect(rs.phase).toBe('prestart');

    drive(rs, course, p, { x: 0, y: -80 }, 10);
    expect(rs.ocs).toBe(false);
  });

  it('starts the race on a clean crossing after the gun', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    const p: Vec2 = { x: 0, y: -80 };

    wait(rs, course, p, DEFAULT_RACE.countdown + 1);
    expect(rs.phase).toBe('prestart');

    drive(rs, course, p, { x: 0, y: 40 }, 12);
    expect(rs.phase).toBe('racing');
    expect(rs.legIndex).toBe(1);
  });

  /**
   * Regression: the crossing test stored the signed side of the line every
   * frame, including the frame where the boat sat exactly on it (side === 0).
   * From then on the "did the sign flip" test compared against zero and never
   * fired again -- the start, every mark and the finish were silently dead.
   */
  it('survives a position exactly on the line', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    wait(rs, course, { x: 0, y: -80 }, DEFAULT_RACE.countdown + 1);

    // Step onto the line exactly, then continue across.
    updateRace(rs, course, { x: 0, y: -1 }, DT);
    updateRace(rs, course, { x: 0, y: 0 }, DT);
    updateRace(rs, course, { x: 0, y: 1 }, DT);
    expect(rs.phase).toBe('racing');
  });

  it('ignores a crossing outside the ends of the line', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    wait(rs, course, { x: 400, y: -80 }, DEFAULT_RACE.countdown + 1);
    drive(rs, course, { x: 400, y: -80 }, { x: 400, y: 40 }, 12);
    expect(rs.phase).toBe('prestart');
  });
});

describe('mark rounding', () => {
  /**
   * Regression: rounding used to require ~165 degrees of accumulated bearing
   * change about the mark. A real windward rounding only sweeps about 90,
   * so the rule could never fire and the boat orbited the mark forever.
   */
  it('accepts a realistic windward rounding', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    wait(rs, course, { x: 0, y: -80 }, DEFAULT_RACE.countdown + 1);
    let p = drive(rs, course, { x: 0, y: -80 }, { x: 0, y: 40 }, 12);
    expect(rs.legIndex).toBe(1);

    const w = course.windward.pos;
    // Approach from below on the correct side, pass the mark, bear away.
    p = drive(rs, course, p, { x: w.x + 12, y: w.y - 45 }, 30);
    p = drive(rs, course, p, { x: w.x + 14, y: w.y + 12 }, 12);
    drive(rs, course, p, { x: w.x + 30, y: w.y - 30 }, 12);
    expect(rs.legIndex).toBe(2);
  });

  it('rejects sailing past the mark on the wrong side', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    wait(rs, course, { x: 0, y: -80 }, DEFAULT_RACE.countdown + 1);
    let p = drive(rs, course, { x: 0, y: -80 }, { x: 0, y: 40 }, 12);

    const w = course.windward.pos;
    // Same approach, but leaving the mark to starboard instead of to port.
    p = drive(rs, course, p, { x: w.x - 12, y: w.y - 45 }, 30);
    drive(rs, course, p, { x: w.x - 14, y: w.y + 40 }, 14);
    expect(rs.legIndex).toBe(1);
  });

  it('rejects passing far outside the zone', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    wait(rs, course, { x: 0, y: -80 }, DEFAULT_RACE.countdown + 1);
    let p = drive(rs, course, { x: 0, y: -80 }, { x: 0, y: 40 }, 12);

    const w = course.windward.pos;
    p = drive(rs, course, p, { x: w.x + 300, y: w.y - 45 }, 30);
    drive(rs, course, p, { x: w.x + 300, y: w.y + 60 }, 14);
    expect(rs.legIndex).toBe(1);
  });
});

describe('a whole race', () => {
  it('runs start, both laps and the finish in order', () => {
    const course = buildCourse(DEFAULT_RACE, 0);
    const rs = initialRaceState(DEFAULT_RACE);
    const w = course.windward.pos;
    const l = course.leeward.pos;

    let p: Vec2 = { x: 0, y: -80 };
    wait(rs, course, p, DEFAULT_RACE.countdown + 1);
    p = drive(rs, course, p, { x: 0, y: 40 }, 12);

    for (let lap = 0; lap < DEFAULT_RACE.laps; lap++) {
      p = drive(rs, course, p, { x: w.x + 15, y: w.y - 40 }, 40);
      p = roundMark(rs, course, w, p, 20);
      if (lap < DEFAULT_RACE.laps - 1) {
        p = drive(rs, course, p, { x: l.x + 15, y: l.y + 40 }, 40);
        p = roundMark(rs, course, l, p, 20);
      }
    }

    p = drive(rs, course, p, { x: 0, y: 40 }, 40);
    drive(rs, course, p, { x: 0, y: -40 }, 12);

    expect(rs.phase).toBe('finished');
    expect(rs.finishTime).toBeGreaterThan(0);
    expect(rs.splits).toHaveLength(course.legs.length);
  });
});
