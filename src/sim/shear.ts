/**
 * The vertical wind profile.
 *
 * Wind is slowed by friction against the water, so it blows harder at the head
 * of the sail than at the foot. That single fact is the whole reason sails are
 * built with twist: the boat's own velocity is the same at every height, so a
 * stronger true wind up top means the *apparent* wind up there comes from
 * further aft. Trim the sail as one flat plane and either the head is over-
 * trimmed and stalled or the foot is under-trimmed and lazy.
 *
 * The profile is the engineering power law rather than the log law. Over the
 * range that matters here -- two to fourteen metres -- the two are within a
 * couple of percent of each other, and the power law needs no roughness length
 * and no stability correction to stay well behaved near the surface.
 */

/**
 * Power-law exponent. 0.10-0.11 is the neutral open-sea value; sailing air is
 * more often mildly stable, warm air sitting over colder water, which stiffens
 * the gradient. 0.14 is a compromise that puts about 18 degrees of apparent
 * wind spread across the rig on a broad reach and about 3 upwind -- which is
 * the right shape: sails are trimmed nearly flat upwind and twisted a long way
 * open downwind.
 */
export const SHEAR_EXPONENT = 0.14;

/**
 * The profile is frozen below this height, m.
 *
 * z^0.14 is not merely small near zero, its slope is infinite there, so a boom
 * that dips towards the water in a heavy reef would otherwise see the wind fall
 * off a cliff. Half a metre is well below any part of a sail.
 */
const Z_FLOOR = 0.5;

/**
 * Wind speed at height `z` as a fraction of the speed at `zRef`, both in metres
 * above the water.
 */
export function shearFactor(z: number, zRef: number): number {
  return Math.pow(Math.max(z, Z_FLOOR) / Math.max(zRef, Z_FLOOR), SHEAR_EXPONENT);
}

/**
 * Real shear veers as well as strengthens -- the Ekman spiral turns the wind to
 * starboard with height in the northern hemisphere. Over water, in the first
 * fifteen metres, that is a degree or so: far smaller than the speed effect and
 * invisible to a helmsman. Deliberately not modelled.
 */
