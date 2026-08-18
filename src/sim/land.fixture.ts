import { HeightField } from './heightfield';
import { RegionTerrain } from './region-terrain';
import type { Region } from './regions';

/**
 * A round island in a square of water, for tests that need *some* land.
 *
 * Several tests -- the anchorage judge, the tide, the animals, the gulls --
 * are about what happens near a shore and do not care whose shore it is. They
 * used to build a `Terrain` from one circle, which was the island field's own
 * primitive; with the circles gone the honest fixture is the real class the
 * game runs on, handed a height field somebody drew an island into.
 *
 * Not a test file itself, because five test files share it and a helper copied
 * five times is how the corrections stop being shared. It is imported by
 * nothing the game ships.
 */

/** 8 km square at 25 m, which is room enough for a lee to end inside it. */
const GRID = { width: 320, height: 320, cell: 25, unit: 1 } as const;

/**
 * Water `deep` metres deep with one island in the middle of it.
 *
 * The island is a cone: `height` at the centre falling to sea level at
 * `radius`, and on to the sea floor over the same distance again, so the
 * shallows around it are a beach rather than a cliff.
 */
export function roundIsland({
  radius = 200,
  height = 70,
  deep = 40,
  centre = { x: 0, y: 0 },
}: {
  radius?: number;
  height?: number;
  deep?: number;
  centre?: { x: number; y: number };
} = {}): RegionTerrain {
  const region: Region = { id: 'fixture', name: 'Fixture', grid: GRID, source: 'a test' };
  const samples = new Int16Array(GRID.width * GRID.height);
  const half = (GRID.width * GRID.cell) / 2;
  for (let row = 0; row < GRID.height; row++) {
    for (let col = 0; col < GRID.width; col++) {
      const x = -half + (col + 0.5) * GRID.cell;
      const y = half - (row + 0.5) * GRID.cell;
      const d = Math.hypot(x - centre.x, y - centre.y);
      samples[row * GRID.width + col] =
        d <= radius
          ? Math.round(height * (1 - d / radius))
          : Math.round(-deep * Math.min(1, (d - radius) / radius));
    }
  }
  return new RegionTerrain(region, new HeightField(samples, region));
}

/** Open water, with no land in it at all. */
export const openWater = (): RegionTerrain => roundIsland({ radius: 0, height: 0 });
