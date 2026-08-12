import { assetUrl } from './asset';
import { heightFieldFromBytes } from './sim/heightfield';
import { RegionTerrain } from './sim/region-terrain';
import { rasterBytes, type Region } from './sim/regions';

/**
 * Fetching a region's raster.
 *
 * Here rather than in `src/sim` because `src/sim` may not touch the network --
 * AGENTS.md section 3 -- which is the same reason `HeightField` takes bytes
 * rather than a URL. The tests and the polar run read the very same bytes off
 * disk and build the very same object.
 *
 * Cached by region, because building one costs a chamfer distance transform
 * over 640,000 cells and a player switching back and forth between the open
 * ocean and a region should pay for that once.
 */

const cache = new Map<string, Promise<RegionTerrain>>();

export function loadRegion(region: Region): Promise<RegionTerrain> {
  const hit = cache.get(region.id);
  if (hit) return hit;

  // Through the deploy base, because `Region.raster` is a root-relative path
  // and `src/sim` may not know where the app is served from.
  const pending = fetch(assetUrl(region.raster))
    .then(async (res) => {
      if (!res.ok) throw new Error(`${region.raster}: HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      // A truncated or misrouted response is the failure worth naming: a dev
      // server answering with index.html for a missing file yields a body that
      // is the wrong length rather than an error, and without this check it
      // would be read as terrain and sailed into.
      if (bytes.byteLength !== rasterBytes(region)) {
        throw new Error(
          `${region.raster}: ${bytes.byteLength} bytes, expected ${rasterBytes(region)}`,
        );
      }
      return new RegionTerrain(region, heightFieldFromBytes(bytes, region));
    })
    .catch((err) => {
      // Not kept, so a failure caused by a dropped connection can be retried by
      // choosing the region again rather than being remembered forever.
      cache.delete(region.id);
      throw err;
    });

  cache.set(region.id, pending);
  return pending;
}
