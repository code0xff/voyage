import { describe, expect, it } from 'vitest';
import { Weather, WEATHER_KINDS } from './weather';
/** The default time scale: a second of play is a minute of world time. */
const SCALE = 60;

describe('weather', () => {
  it('replays exactly from a seed', () => {
    const a = new Weather(5);
    const b = new Weather(5);
    for (let i = 0; i < 4000; i++) {
      a.update(1, SCALE);
      b.update(1, SCALE);
    }
    expect(a.state).toEqual(b.state);
  });

  it('changes on its own but never teleports', () => {
    const w = new Weather(17);
    const seen = new Set<string>();
    let prevWind = w.state.windScale;
    for (let i = 0; i < 8000; i++) {
      w.update(1, SCALE);
      seen.add(w.state.kind);
      // One second must never move the wind more than a few per cent.
      expect(Math.abs(w.state.windScale - prevWind)).toBeLessThan(0.05);
      prevWind = w.state.windScale;
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  /**
   * Locks down the bug this was written to fix: the dwell times are world time,
   * but they were being counted down in wall-clock seconds. The sun crossed the
   * whole sky in twenty minutes of play while the weather sat on 'fair', so the
   * one system that was supposed to make two races differ never did anything.
   */
  it('turns several times over a sailing session, not once an hour of play', () => {
    // Averaged over seeds on purpose. Any single one can roll the condition it
    // is already in twice running and sit still for ten minutes, which is
    // weather being weather, not the bug this is guarding.
    const counts = [];
    for (let seed = 1; seed <= 12; seed++) {
      const w = new Weather(seed);
      let changes = 0;
      let prev = w.state.kind;
      // Ten minutes of play at the default time scale.
      for (let i = 0; i < 600; i++) {
        w.update(1, SCALE);
        if (w.state.kind !== prev) changes++;
        prev = w.state.kind;
      }
      counts.push(changes);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(2);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });

  it('holds still when world time does', () => {
    const w = new Weather(11);
    const kind = w.state.kind;
    for (let i = 0; i < 5000; i++) w.update(1, 0);
    expect(w.state.kind).toBe(kind);
  });

  it('can be pinned to one condition', () => {
    const w = new Weather(3);
    w.evolve = false;
    w.set('fog');
    for (let i = 0; i < 5000; i++) w.update(1, SCALE);
    expect(w.state.kind).toBe('fog');
    expect(w.visibility).toBeLessThan(400);
  });

  it('keeps visibility and wind within sane bounds in every condition', () => {
    for (const kind of WEATHER_KINDS) {
      const w = new Weather(1, kind);
      w.evolve = false;
      for (let i = 0; i < 2000; i++) w.update(1);
      expect(w.visibility).toBeGreaterThan(80);
      expect(w.state.windScale).toBeGreaterThan(0.4);
      expect(w.state.windScale).toBeLessThan(2.2);
    }
  });
});

