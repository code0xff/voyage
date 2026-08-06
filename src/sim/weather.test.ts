import { describe, expect, it } from 'vitest';
import { Weather, WEATHER_KINDS } from './weather';
describe('weather', () => {
  it('replays exactly from a seed', () => {
    const a = new Weather(5);
    const b = new Weather(5);
    for (let i = 0; i < 4000; i++) {
      a.update(1);
      b.update(1);
    }
    expect(a.state).toEqual(b.state);
  });

  it('changes on its own but never teleports', () => {
    const w = new Weather(17);
    const seen = new Set<string>();
    let prevWind = w.state.windScale;
    for (let i = 0; i < 8000; i++) {
      w.update(1);
      seen.add(w.state.kind);
      // One second must never move the wind more than a few per cent.
      expect(Math.abs(w.state.windScale - prevWind)).toBeLessThan(0.05);
      prevWind = w.state.windScale;
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('can be pinned to one condition', () => {
    const w = new Weather(3);
    w.evolve = false;
    w.set('fog');
    for (let i = 0; i < 5000; i++) w.update(1);
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

