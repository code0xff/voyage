import { assetUrl } from './asset';
import { Earth, GLOBE_4M } from './sim/earth';

/**
 * Fetching the planet.
 *
 * Here rather than in `src/sim` because `src/sim` may not touch the network --
 * AGENTS.md section 3 -- which is the same reason `Earth` takes samples rather
 * than a URL. The tests and the polar run read the very same bytes off disk
 * and build the very same object.
 */

/**
 * The coarse global grid, fetched once and kept.
 *
 * Same arrangement as a region's raster and for the same reason -- `src/sim`
 * may not touch the network, so `Earth` takes samples and this fetches them.
 * One promise for the session: it is 29 MB, it never changes, and every
 * window the boat sails through reads it.
 */
let globe: Promise<Earth> | null = null;

export function loadEarth(): Promise<Earth> {
  if (globe) return globe;
  // The literal is the direct argument on purpose: `check-base.ts` matches
  // lexically, so a path hidden behind a constant is a path it cannot see --
  // and this one is fetched at runtime, which is exactly the case that
  // breaks under a deploy base.
  globe = fetch(assetUrl('/terrain/globe-4m.bin'))
    .then(async (res) => {
      if (!res.ok) throw new Error(`globe raster: HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const expected = GLOBE_4M.width * GLOBE_4M.height * 2;
      // The same guard the regions carry, for the same failure: a dev server
      // answering with index.html is a body of the wrong length rather than
      // an error, and an Earth built from it would be a planet of noise.
      if (bytes.byteLength !== expected) {
        throw new Error(`globe raster: ${bytes.byteLength} bytes, expected ${expected}`);
      }
      return new Earth(new Int16Array(bytes), GLOBE_4M);
    })
    .catch((err) => {
      // Dropped, so a failed fetch can be retried rather than remembered.
      globe = null;
      throw err;
    });
  return globe;
}
