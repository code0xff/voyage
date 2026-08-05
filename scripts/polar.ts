/**
 * Headless polar validation.
 *
 *   npm run polar                 # 12 knots
 *   npm run polar -- 6 12 25 35   # several wind speeds
 *
 * The physics core has no Three.js dependency, so it runs unchanged without a
 * browser. Running this after touching a parameter is far faster than starting
 * the renderer and sailing around to see what changed.
 */
import { CRUISER, DEFAULT_ENV } from '../src/sim/config';
import { formatPolar, solvePolar } from '../src/sim/polar';
import { knotsToMs, hullSpeed, msToKnots } from '../src/sim/units';

const args = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isFinite(n) && n > 0);
const windsKn = args.length ? args : [12];

const cfg = CRUISER;
console.log(`Hull speed: ${msToKnots(hullSpeed(cfg.lwl)).toFixed(2)} kn (LWL ${cfg.lwl} m)\n`);

for (const kn of windsKn) {
  const env = { ...DEFAULT_ENV, tws: knotsToMs(kn) };
  console.log(formatPolar(solvePolar(cfg, env), cfg));
  console.log('');
}
