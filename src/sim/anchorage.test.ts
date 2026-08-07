import { describe, expect, it } from 'vitest';
import { CLEARANCE, MAX_DEPTH, MAX_WAY, anchorProblem, anchorage } from './anchorage';
import { CRUISER } from './config';
import { Terrain } from './terrain';

/**
 * An anchorage is a judgement, not a coordinate, and these pin the judgement.
 * The band of water that will do is narrow at both ends, which is exactly why
 * finding one is worth doing rather than stopping wherever you happen to be.
 */
describe('anchorage', () => {
  const shore = new Terrain([{ pos: { x: 0, y: 0 }, radius: 400, height: 60, seed: 3 }]);
  const at = (x: number, y: number, sog = 0) => anchorage(shore, CRUISER, { x, y }, sog, 0);

  /**
   * March out from the shore to the first radius with a given verdict.
   *
   * Searched rather than guessed at with an offset: the shelf falls at 0.09 m
   * per metre, so the whole band that is afloat but too shallow to swing in is
   * about thirteen metres wide, and a guessed offset of forty lands on the
   * beach.
   */
  const firstAt = (want: string) => {
    for (let r = 380; r < 3000; r += 1) if (at(0, r).holding === want) return r;
    return null;
  };
  const firstGood = () => firstAt('good');

  it('refuses water she is already sitting on the bottom of', () => {
    expect(at(0, 0).holding).toBe('aground');
    expect(at(0, 0).canAnchor).toBe(false);
  });

  it('refuses water too shallow to swing in, even when she is afloat in it', () => {
    // Afloat but with less than the swinging clearance: the boat floats now and
    // takes the ground when she turns to the tide, which is the worse outcome
    // because it happens after everyone has gone to sleep.
    const shallow = at(0, firstAt('shoal')!);
    expect(shallow.depth).toBeGreaterThan(CRUISER.draft);
    expect(shallow.depth).toBeLessThan(CRUISER.draft + CLEARANCE);
    expect(shallow.holding).toBe('shoal');
    expect(shallow.canAnchor).toBe(false);
  });

  it('refuses water deeper than there is cable for', () => {
    const offshore = at(0, 2500);
    expect(offshore.depth).toBeGreaterThan(MAX_DEPTH);
    expect(offshore.holding).toBe('deep');
    expect(offshore.canAnchor).toBe(false);
  });

  it('finds a band of water between the two that will do', () => {
    const r = firstGood();
    expect(r).not.toBeNull();
    const good = at(0, r!);
    expect(good.depth).toBeGreaterThanOrEqual(CRUISER.draft + CLEARANCE);
    expect(good.depth).toBeLessThanOrEqual(MAX_DEPTH);
    expect(good.canAnchor).toBe(true);
  });

  it('will not let go of a boat still carrying way', () => {
    const r = firstGood()!;
    expect(at(0, r, MAX_WAY * 0.5).canAnchor).toBe(true);
    // Letting go at speed does not anchor a boat, it drags a hook along behind
    // one, so the check is on the ground track and not on the log.
    expect(at(0, r, MAX_WAY * 3).canAnchor).toBe(false);
    expect(at(0, r, MAX_WAY * 3).holding).toBe('good');
  });

  it('reports shelter the way the word reads, not the way the wave term does', () => {
    // The wave field's own number is 1 for the open sea. Reporting that as
    // "shelter" would have described the most exposed water as the best.
    const r = firstGood()!;
    const lee = at(0, -r); // downwind of the island, with the wind from the north
    const exposed = at(0, r); // upwind of it
    expect(lee.shelter).toBeGreaterThan(exposed.shelter);
    expect(exposed.shelter).toBeCloseTo(0, 6);
  });

  it('says what is wrong, and says nothing when nothing is', () => {
    expect(anchorProblem(at(0, 0))).toBe('aground');
    expect(anchorProblem(at(0, 2500))).toMatch(/deep/);
    const r = firstGood()!;
    expect(anchorProblem(at(0, r, MAX_WAY * 3))).toMatch(/way/);
    expect(anchorProblem(at(0, r))).toBeNull();
  });

  it('has nowhere to anchor in an ocean with no bottom', () => {
    const open = new Terrain([]);
    const a = anchorage(open, CRUISER, { x: 0, y: 0 }, 0, 0);
    expect(a.holding).toBe('deep');
    expect(a.canAnchor).toBe(false);
  });
});
