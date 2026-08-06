import { describe, expect, it } from 'vitest';
import { Wildlife } from './wildlife';
import { Terrain, type Island } from './terrain';

const OPEN = new Terrain([]);
const island = (x: number, y: number): Island => ({
  pos: { x, y },
  radius: 200,
  height: 70,
  seed: 3,
});

/** Sit a boat somewhere for a while and collect what it heard. */
function calls(seed: number, terrain: Terrain, at: { x: number; y: number }, seconds = 600) {
  const w = new Wildlife(seed);
  const boat = { ...at };
  const heard: { x: number; y: number }[] = [];
  for (let t = 0; t < seconds; t += 0.25) {
    w.update(0.25, boat, terrain);
    for (const e of w.events) heard.push({ ...e.pos });
  }
  return heard;
}

describe('gulls', () => {
  it('replays exactly from a seed', () => {
    const land = new Terrain([island(0, 0)]);
    expect(calls(11, land, { x: 420, y: 0 })).toEqual(calls(11, land, { x: 420, y: 0 }));
  });

  it('gives different seeds different birds', () => {
    const land = new Terrain([island(0, 0)]);
    expect(calls(11, land, { x: 420, y: 0 })).not.toEqual(calls(9812, land, { x: 420, y: 0 }));
  });

  /**
   * The whole point of them: a cue that says land is near before the haze gives
   * it up. Silent offshore, frequent close in.
   */
  it('calls near a shore and not in open water', () => {
    const land = new Terrain([island(0, 0)]);
    // 260 m off the beach of a 200 m island, and half a sea away from it.
    expect(calls(33, land, { x: 460, y: 0 }).length).toBeGreaterThan(0);
    expect(calls(33, land, { x: 4000, y: 0 }).length).toBe(0);
    expect(calls(33, OPEN, { x: 0, y: 0 }).length).toBe(0);
  });

  it('gets busier the closer in you are', () => {
    const land = new Terrain([island(0, 0)]);
    const far = calls(7, land, { x: 850, y: 0 }).length;
    const near = calls(7, land, { x: 260, y: 0 }).length;
    expect(near).toBeGreaterThan(far);
  });

  /** A call has to come from somewhere a bird could be, not from the masthead. */
  it('places calls off the boat, between it and the land', () => {
    const boat = { x: 350, y: 0 };
    const heard = calls(12, new Terrain([island(0, 0)]), boat, 900);
    expect(heard.length).toBeGreaterThan(0);
    for (const pos of heard) {
      expect(Math.hypot(pos.x - boat.x, pos.y - boat.y)).toBeGreaterThan(10);
      // Roughly shorewards: the offset is towards the island, not away from it.
      expect(pos.x).toBeLessThan(boat.x + 60);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});
