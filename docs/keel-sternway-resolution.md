# The missing force in the sternway investigation

`keel-sternway.md` found a real coefficient-domain bug, then found that the
obvious correction made the boat accelerate backwards despite every measured
force pointing forwards. This note resolves that contradiction, separates what
is proven from what still needs foil data, and sets out the repair constraints.

**Written as a proposal, before the fix.** It shipped in the same commit as the
implementation, so "nothing in `src/` has been changed" was true when this was
written and is not now. What was actually done, and where it departs from the
proposal below, is at the foot of `keel-sternway.md`.

---

## The force that was missing

The runaway is not an instability exposed by correcting the keel. It is rudder
drag that the instrumentation did not report.

The rudder shares the keel's coefficient-domain error and adds two of its own:
a fabricated minimum speed in its dynamic pressure and drag that always points
in negative surge.

```ts
const uSafe = Math.max(Math.abs(s.u), 0.3) * Math.sign(s.u || 1);
const vRud = s.v - s.r * cfg.rudderArm;
const alphaR = s.rudder + Math.atan2(vRud, uSafe);
const qR = 0.5 * rhoWater * (uSafe * uSafe + vRud * vRud) * rudderArea;
const cdr = sample(FOIL_CD, Math.abs(alphaR) * RAD);

fx -= qR * cdr;
```

With the helm centred, `u < 0` and `vRud` approximately zero,
`atan2(0, uSafe)` is plus or minus 180 degrees. `FOIL_CD` clamps that to its
90-degree endpoint, so an edge-on rudder receives the broadside coefficient
`1.32`. The resulting drag is then applied with `fx -= ...` whatever direction
the boat is moving, so while going astern it accelerates her farther astern.

`rudderForce` does not reveal this. That diagnostic contains only the rudder's
lateral lift; the longitudinal drag is added directly to `fx` and is not
published anywhere.

## The original equilibrium closes exactly

At the shipped drift equilibrium, `u = -0.1618 m/s`. The rudder calculation does
not use that speed: the `uSafe` floor substitutes `0.3 m/s`. Its unreported drag
is therefore

```text
0.5 * 1025 kg/m3 * 0.3^2 m2/s2 * 0.9 m2 * 1.32 = 54.80 N astern
```

The three forces recorded in the first investigation sum to precisely the
opposite value:

```text
keel + hull + windage = 56.68 + 1.41 - 3.29 = 54.80 N ahead
```

The 84% drift is thus not a broadside keel propping up an otherwise inadequate
low-speed resistance curve. It is a balance dominated by two reversed-flow
errors, with the legitimate hull and windage remainder closing the gap:

| term | N |
|---|---:|
| keel, broadside coefficient while edge-on | +56.68 |
| hull resistance and windage | -1.88 |
| rudder, broadside coefficient plus fabricated minimum speed | -54.80 |
| net | 0.00 |

That is why folding only the keel angle removes the apparent equilibrium.

## The runaway closes too

Once the keel angle is folded but the rudder is left unchanged, the omitted
rudder term explains the apparently impossible acceleration.

At `t = 100 s`, with `u = -1.758 m/s`, the rudder term is

```text
qR             = 0.5 * 1025 * 1.758^2 * 0.9 = 1425.52 N
rudder drag    = 1425.52 * 1.32              = 1881.69 N astern
measured terms = 169 + 50.5 + 2.7            = 222.2 N ahead
net            = about 1659 N astern
```

The surge integrator is therefore doing exactly what its inputs ask: `u` must
become more negative.

At `t = 200 s`, with `u = -3.796 m/s`, rudder drag is `8773 N` astern. The
recorded hull, keel and windage terms sum to about `8775 N` ahead. That is the
new equilibrium at the hull-speed wall. Both unexplained measurements are the
same omitted force at different speeds.

---

## Proposed repair

The keel and rudder must be corrected together. Changing the hull resistance
law or retuning `CRUISER` before doing that would tune the boat around two known
sign and coefficient-domain errors.

### 1. Separate track angle from foil inflow angle

`leeway` should remain the signed angle from heading to the through-water track.
It is a diagnostic and a real track angle, so a boat making sternway genuinely
reads plus or minus 180 degrees.

It must not index the present foil table directly. `FOIL_CL` and `FOIL_CD` only
describe forward inflow from 0 to 90 degrees. A symmetric foil section is
symmetric from port to starboard, not from leading edge to trailing edge:
straight reverse flow reaches a sharp trailing edge and cannot be assumed to
have the forward zero-degree coefficient.

The real coefficient input is therefore a signed angle over the full
`[-180 degrees, +180 degrees]` inflow range. Extend the keel and rudder curves
through reverse flow, with a documented source or a stated deliberate model.
An aligned keel or centred rudder in exact sternway should have zero lateral
lift by symmetry, but its drag coefficient is a reverse-flow question that the
current table cannot answer. A deflected rudder can still make lift in sternway.

Folding the angle modulo 180 degrees is still a possible interim
approximation. It removes the absurd broadside clamp and is forward-identical
for the keel, but it explicitly assumes leading-edge/trailing-edge symmetry and
must not be presented as measured physics. Its predicted drift is provisional.

### 2. Derive force direction from the actual flow

Drag must point opposite the foil's local velocity through the water. The keel
already does this through `flowW`; the rudder's unconditional subtraction from
hull surge does not.

Lift must use one fixed oriented perpendicular to that same flow multiplied by
a signed coefficient. In the existing world-coordinate convention, use
`rotCW90(flow)` with signed `CL(inflow)`: positive forward rudder inflow then
pushes the rudder to port and yaws the bow to starboard, matching the shipped
forward sign. Do not also choose CW or CCW from the coefficient sign; that would
apply the sign twice. Keying direction only on `side(leeway)` is insufficient
in sternway.

The safest formulation is geometric:

1. construct the foil's chord axis in hull coordinates;
2. find the velocity at the foil;
3. measure the signed inflow angle over the full 360-degree circle;
4. sample the forward or reverse lift and drag model;
5. apply drag opposite velocity and lift on the signed perpendicular.

The sign is not optional. In the repository convention, positive rudder turns
the bow to starboard and the shipped forward-flow expression is
`alphaR = betaR + s.rudder`. A geometric helper must therefore give the rudder
chord an oriented hull-frame bearing of `-s.rudder`. Keeping that orientation is
what distinguishes inflow into the leading edge from inflow into the trailing
edge:

```text
betaR       = atan2(vRud, u)
chordR      = -s.rudder
rudderInflow = wrapPi(betaR - chordR) = wrapPi(betaR + s.rudder)
```

Here `vRud = v - r * rudderArm`. The keel has chord bearing zero and uses the
hull's `u`, `v`. Forward steering must retain its existing sign.

### 3. Remove fabricated rudder dynamic pressure

The `0.3 m/s` floor may have been intended to keep an angle calculation away
from zero, but `atan2` needs no division guard. Feeding the floor into `qR`
creates force when that longitudinal flow does not exist.

Rudder dynamic pressure and its area-scaled force factor should use the actual
local speed:

```text
rudderSpeed = hypot(u, vRud)
q = 0.5 * rhoWater * rudderSpeed^2       // Pa
qR = q * rudderArea                      // N before CL or CD
```

At zero local flow every rudder force must be exactly zero.

### 4. Audit the other hydrodynamic use of `leeway`

The directional-stability moment currently multiplies the full track angle by
`speed^2`. Exact sternway therefore supplies plus or minus pi radians to a term
derived for small forward sideslip, choosing a large yaw direction from the
sign of numerical zero.

That term needs a deliberate sternway rule. Exact sternway must not choose an
arbitrary port or starboard yaw from signed zero, and small forward sideslip
must keep the existing behaviour. Whether small reverse sideslip is stable or
unstable is a hull asymmetry question; it should be modelled deliberately, not
decided by folding an angle or by an accident of wrapping at pi.

### 5. Publish the missing diagnostic

Rename or supplement `rudderForce`, which currently means lateral lift only.
Expose either:

- `rudderLift` and `rudderDrag`; or
- `rudderFx` and `rudderFy`.

The full force balance should be reconstructible from diagnostics. Otherwise a
future tuning run can repeat exactly the contradiction that led here.

---

## Regression and acceptance tests

Every regression below must first be seen failing against the shipped model.
They should exercise an extracted foil-force function where possible; otherwise
zero unrelated areas and moments in a copy of `CRUISER` so the shipped keel and
rudder errors cannot cancel.

1. **No hydrodynamic propulsion.** Across forward, lateral and reverse cases,
   `dot(drag, localVelocity) <= 0` and
   `dot(lift, localVelocity)` is approximately zero. This directly catches the
   rudder adding energy in sternway.
2. **Coefficient domain.** Straight reverse flow uses the documented reverse
   endpoint, not the 90-degree broadside endpoint or an undocumented reuse of
   the forward zero-degree value.
3. **Neutral rudder in sternway.** A centred rudder moving straight astern has
   zero lateral lift and drag that reduces, rather than increases, sternway.
4. **Zero local rudder flow while the hull moves.** Use `u = 0` and
   `v = r * rudderArm`, so the hull passes the `speed > 0.05` guard while
   `vRud = 0`. The rudder must produce exactly zero force; the shipped
   `0.3 m/s` floor does not.
5. **Reverse steering in isolation.** With keel area, weathervane and unrelated
   moments disabled, the same rudder angle produces the opposite yaw sign in
   sternway. The existing isolated forward sign remains unchanged.
6. **Sternway yaw symmetry.** With centred helm, `v = 0` and `r = 0`, exact
   sternway does not choose an arbitrary port or starboard yaw.

Then run two acceptance checks. These need not fail on the shipped model; they
guard the complete repair rather than one regression:

1. the flat-calm 1 m/s stream reproduction converges, its published force
   breakdown closes, and every foil has non-positive drag power;
2. existing steering, tack, current and polar tests remain clean or move only
   for a measured and explained reason.

## Expected polar result

Keel angle handling can remain algebraically identical in forward flow. The
proposed geometric rudder cannot: at nonzero leeway it adds axial lift and
lateral drag components that the shipped scalar `fx`/`fy` treatment omits, and
its full inflow angle can cross 90 degrees.

The polar may therefore move. Run `npm run polar -- 6 12 25 35`, read the
direction and size of the change, and decide whether the geometric correction
is right before retuning anything. A reverse-only scalar patch would not
satisfy the force-direction properties required above and is not the proposed
repair. Do not treat either movement or invariance as proof on its own, and do
not retune `CRUISER` until the force directions and coefficient domains are
verified.

Only after keel and rudder reverse flow are correct should the low-speed drift
and coast-down measurements decide whether the resistance law itself needs
work. The evidence in `keel-sternway.md` does not currently justify an ITTC
replacement or a linear damping term.
