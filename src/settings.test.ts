import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, currentVec, loadSettings, wildlifeSpacing } from './settings';
import { MAX_MAGNIFY, MIN_MAGNIFY } from './view/orbit';

/**
 * The set is quoted as the direction the water is going *to*, the opposite of
 * the convention for wind direction, and this function is the one place that
 * fact turns into a vector. Getting it backwards would send every boat uptide,
 * which looks entirely plausible until you check it against a compass -- so it
 * is checked against a compass.
 */
describe('set and drift', () => {
  const at = (setDeg: number, driftKnots: number) =>
    currentVec({ ...DEFAULT_SETTINGS, setDeg, driftKnots });

  it('sends the water the way the set points, not the way it comes from', () => {
    // World frame is x = East, y = North.
    const east = at(90, 2);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 9);

    const north = at(0, 2);
    expect(north.y).toBeGreaterThan(0);
    expect(north.x).toBeCloseTo(0, 9);

    const west = at(270, 2);
    expect(west.x).toBeLessThan(0);
  });

  it('is slack water at zero drift, whatever the set says', () => {
    for (const deg of [0, 90, 180, 270]) {
      const v = at(deg, 0);
      expect(Math.hypot(v.x, v.y)).toBe(0);
    }
  });

  it('scales with the drift, in metres per second', () => {
    const rate = (driftKnots: number) => {
      const v = at(45, driftKnots);
      return Math.hypot(v.x, v.y);
    };
    // Two knots is 1.03 m/s. A drift that reached the physics still in knots
    // would be a factor of two fast and would still look like a tide.
    expect(rate(2)).toBeCloseTo(1.0289, 3);
    expect(rate(4)).toBeCloseTo(2 * 1.0289, 3);
  });
});

/**
 * The binocular power survives a reload, and a stored file cannot open the
 * game at a power the wheel could never reach.
 *
 * Kept here rather than left to a screenshot because it is a boundary, not a
 * look: the wheel already clamps, and the whole risk of persisting the value
 * is that the file becomes a second, unclamped door into the same number.
 */
describe('binocular power', () => {
  /*
   * A local store, rather than jsdom. The suite runs headless on purpose --
   * that is the whole point of the physics core -- and pulling a DOM in for
   * four assertions about a number would be the wrong trade. This is the only
   * browser API `loadSettings` touches.
   */
  const shim = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => shim.get(k) ?? null,
    setItem: (k: string, v: string) => void shim.set(k, v),
    removeItem: (k: string) => void shim.delete(k),
    clear: () => shim.clear(),
    key: () => null,
    length: 0,
  };

  const stored = (v: unknown) => {
    localStorage.setItem(
      'voyage.settings.v2',
      JSON.stringify({ ...DEFAULT_SETTINGS, binocularPower: v }),
    );
    return loadSettings().binocularPower;
  };

  it('comes back as it was left', () => {
    expect(stored(9.5)).toBeCloseTo(9.5, 9);
  });

  it('is held to the range the wheel allows', () => {
    expect(stored(1000)).toBe(MAX_MAGNIFY);
    expect(stored(-4)).toBe(MIN_MAGNIFY);
  });

  it('falls back to the default when the file is nonsense', () => {
    expect(stored('very')).toBe(DEFAULT_SETTINGS.binocularPower);
    expect(stored(NaN)).toBe(DEFAULT_SETTINGS.binocularPower);
    expect(stored(undefined)).toBe(DEFAULT_SETTINGS.binocularPower);
  });

  /**
   * The default has to be a power the control can actually reach, or the
   * glasses would open somewhere the wheel can never return them to.
   */
  it('defaults inside the range', () => {
    expect(DEFAULT_SETTINGS.binocularPower).toBeGreaterThanOrEqual(MIN_MAGNIFY);
    expect(DEFAULT_SETTINGS.binocularPower).toBeLessThanOrEqual(MAX_MAGNIFY);
  });
});

/**
 * The wildlife slider's meaning, pinned at its three anchors.
 *
 * The mapping is two arms meeting at the default, and each anchor is a claim
 * about the player's intent rather than a restatement of the formula: zero
 * means none, the default means the tuned rarity the game shipped with, and
 * the top means "I want to see them this session" -- which the old single
 * hyperbola did not deliver, its top measuring one whale per four minutes in
 * water that is never that ideal.
 */
describe('wildlife spacing', () => {
  const at = (wildlife: number) => wildlifeSpacing({ ...DEFAULT_SETTINGS, wildlife });

  /**
   * Off for every *future* sighting, that is. An animal already in the water
   * when the slider hits zero finishes its half-minute and goes -- the fields
   * check the spacing before spawning, not mid-encounter -- which is the right
   * behaviour for a slider and not a leak.
   */
  it('is off at zero, exactly', () => {
    expect(at(0)).toBe(Infinity);
  });

  it('leaves the default feel exactly where it shipped', () => {
    expect(at(DEFAULT_SETTINGS.wildlife)).toBe(10);
  });

  it('means minutes at the top, not slightly-less-rare', () => {
    expect(at(10)).toBe(2);
  });

  /**
   * More slider is never less wildlife. Sampled at the slider's own integer
   * stops, and that is the whole domain rather than a shortcut: `loadSettings`
   * rounds the value and the control steps by one, so nothing between the
   * stops is reachable and a seam only a fraction could feel is a seam nobody
   * can. A review pointed out this loop cannot prove continuity between the
   * arms -- true, and between these inputs there is no between.
   */
  it('tightens monotonically from one end of the slider to the other', () => {
    for (let w = 1; w < 10; w++) {
      expect(at(w + 1)).toBeLessThan(at(w));
    }
  });
});
