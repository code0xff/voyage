# The keel when she goes backwards

> **Fixed.** The force missing from this investigation was the rudder's
> unreported longitudinal drag, which closes both the 84% drift equilibrium and
> the runaway exactly — see [keel-sternway-resolution.md](keel-sternway-resolution.md)
> for the arithmetic and the proposed repair, and the section at the foot of
> this file for what was actually done. This document is kept as the evidence
> trail: it is wrong about the runaway being unexplained, and that is the point
> of keeping it.

A confirmed bug, an attempted fix that makes things worse, and one measurement
that does not add up. Written down mid-investigation so that whoever picks it up
— including me — starts from the evidence rather than from the beginning.

**Written before the fix.** Everything below describes the shipped behaviour as
it was; `src/sim/boat.ts` has since been corrected.

---

## The bug

`leeway` is the angle of the boat's velocity *through the water* relative to her
heading:

```ts
const leeway = speed > 0.05 ? wrapPi(compassAngle(velWaterW) - s.heading) : 0;
```

which is `atan2(v, u)`. A boat with sternway has `u < 0`, so it reads **±180
degrees**.

That angle indexes the keel's coefficients:

```ts
const bDeg = Math.abs(leeway) * RAD;
const clk = sample(FOIL_CL, bDeg) * Math.cos(s.heel);
const cdk = sample(FOIL_CD, bDeg) + (clk * clk) / (Math.PI * cfg.keelAR);
```

`FOIL_CD` is tabulated over 0–90 degrees and `sample()` clamps anything above it
to the last entry, **1.32** — the coefficient for water hitting the keel
broadside. A keel moving backwards is edge-on rather than broadside, so `1.32`
is the wrong endpoint.

The table's `0.01` value is for flow into the leading edge, not reverse flow
into the trailing edge, so the correct sternway coefficient and the exact
overstatement cannot be inferred from this table. That distinction was found
after the original investigation; see the resolution linked above.

### It is not a rounding error

Measured at the drift equilibrium (flat calm, 1 m/s stream, heading pinned so
she cannot yaw out of it), the fore-and-aft forces are:

| term | N |
|---|---|
| windage | −3.29 |
| hull resistance | +1.41 |
| **keel** | **+56.68** |

and the arithmetic closes exactly:

```
q     = 0.5 · 1025 · 0.1618²  = 13.42 Pa
keel  = 13.42 · 3.2 m² · 1.32 = 56.7 N
```

on a keel slipping at 16 cm/s. It is seventeen times the windage that
`open-questions.md` used to say was the only thing holding her back. The later
resolution found that it does not set the 84% figure alone: the omitted rudder
drag supplies 54.8 N astern, and hull resistance and windage close the balance.

### Where it shows

Anything that gives her sternway: backing a jib, missing a tack, coming astern
off a berth, lying to a stream in a calm. Never while sailing forwards, which is
why it lasted.

---

## Reproducing it

Drive `step()` directly; no engine or browser needed.

```ts
const s = initialState({ u: 0, v: 0, heading: 0, stowed: true });
const env = { ...DEFAULT_ENV, tws: 0, twd: 0, current: { x: 0, y: 1 } };
for (let n = 0; n < 3000 * 120; n++) {
  step(s, CRUISER, env, { rudder: 0, sheet: 20 * DEG, twist: 12 * DEG }, 1 / 120,
       { sea: { h13: 0, heave: 0, pitchSlope: 0, rollSlope: 0, dir: 0, depth: Infinity } });
  s.heading = 0; s.r = 0;          // pin the heading; see the trap below
}
```

Converges by 300 s and holds to 16 hours: **sog 0.8382, u −0.1618**.

**Two traps, both of which cost time here.**

- **Do not pin `s.v`.** Setting it to zero every step injects momentum and the
  run stops converging — it read 0.954 at 1200 s and 0.843 at 1500 s, which is
  not a decay. With the heading pinned and the stream dead ahead, symmetry keeps
  `v` at zero on its own.
- **Do not let her yaw.** Left free she lies across the stream and the vector sum
  of drift and slip reads *over* 100% of the tide, which looks like a sign error
  and is not.

---

## The obvious fix, and why it is not enough

Take the angle from the hull-frame components instead:

```ts
const bDeg = Math.atan2(Math.abs(s.v), Math.abs(s.u)) * RAD;
```

This folds sternway onto zero by construction, cannot ask the table for anything
outside the range it was measured over, and is **identical whenever `u > 0`** —
`leeway` is `atan2(v, u)`, so for positive `u` the magnitude and the sign are
already this. It looked safe.

It is not:

| tried | drift | polar |
|---|---|---|
| shipped | 84% | matches the README table |
| fold the angle | 279% | 7.38 kn at 6, 12 and 25 kn of wind |
| fold, lift keyed on `side(s.v)` not `side(leeway)` | 279% | same |
| fold, lift suppressed entirely while `u < 0` | 279% | same |

All three fail identically, so the runaway is insensitive to the keel lift
direction tried here. They do not establish what the correct trailing-edge-first
lift curve is. What the fold removes is 56 N of keel drag while leaving the
rudder's reversed-flow errors in place.

### What the runaway looks like

With the fold applied, traced from rest in a 1 m/s stream:

```
t=  20  u=-0.019  sog=0.981   windFx=-4.507
t=  60  u=-0.120  sog=0.880   windFx=-3.632  keelFx=+0.234  hullFx=+0.769
t= 100  u=-1.758  sog=0.758   windFx=+2.669  keelFx=+50.50  hullFx=+169.1
t= 200  u=-3.796  sog=2.796   windFx=+36.64  keelFx=+236.4  hullFx=+8502
t= 300  u=-3.796  sog=2.796   (held)
```

She accelerates backwards through the water until the hull-speed wall stops her
at 8500 N, drifting 2.8 m/s **backwards** over the ground in a following tide.

---

## The measurement that did not add up

> **Resolved:** the missing force is the rudder's unreported longitudinal drag:
> `1882 N` astern at `t = 100` and `8773 N` astern at `t = 200`. The original
> reasoning is retained below as the evidence trail.

At `t = 100` she is making sternway at 1.76 m/s, and the fore-and-aft forces are
`hull +169 N`, `keel +50 N`, `windage +2.7 N` — **about 222 N, all of it
forward**, all of it opposing her sternway. Surge is a plain integration of that
sum:

```ts
s.u += dt * (fx / mx + s.v * s.r);     // r is pinned to 0, so the cross term is nil
```

so `u` should climb back towards zero. Between `t = 100` and `t = 200` it
instead falls from −1.76 to −3.80.

Ruled out already:

- `drive` is captured before the keel and hull block adds to `fx`, but it is
  only used for diagnostics and the trim moment — the surge equation reads the
  full `fx`.
- No sail force: `stowed: true`, and `sailFx` reads 0 throughout.
- Not the yaw cross-term: `s.r` is pinned to 0.
- Not a stale probe: `keelFx` and `hullFx` are captured in the same step, inside
  the `speed > 0.02` block, which runs at these speeds.

The force not captured by that instrumentation is rudder drag. `rudderForce`
reports only lateral lift, while `qR * cdr` is added directly to surge. In
sternway it reads the broadside coefficient and is always subtracted from `fx`.

---

## What not to try

The ITTC-57 friction line with a form factor — what `open-questions.md` used to
prescribe — was measured on a surge-only model (no keel or rudder, which is why
its baseline reads 77% where the simulator reads 84%):

| law | drift | coast to 1 kn | drag at 3 m/s |
|---|---|---|---|
| flat `Cf = 0.0042` | 77.2% | 134 s | 484 N |
| ITTC × (1+k = 1.25) | 79.2% | **140 s** | 377 N |
| ITTC + 8 N/(m/s) linear | 83.5% | 120 s | 401 N |

It moves the drift two points, makes the coast-down *worse*, and costs 22% of
the drag at sailing speed — a full retune of `CRUISER` for nothing. The linear
term does move both, but it is a fudge at these Reynolds numbers and it is not
the diagnosed cause.

---

## Where it stands

The shipped behaviour is unchanged and the polar still matches the README. The
84% figure is a balance dominated by two reversed-flow errors: the keel reads
the broadside coefficient while edge-on, and the centred rudder does the same
while also substituting at least `0.3 m/s` for surge in its dynamic-pressure
calculation and always applying drag astern. The latter is the force that
resolves the contradiction above.

The remaining work is to correct both foils together, choose and document a
trailing-edge-first coefficient model, make rudder drag oppose its actual local
flow, and remove the dynamic-pressure floor. The detailed constraints and tests
are in [keel-sternway-resolution.md](keel-sternway-resolution.md).

---

## What was done

Four changes, each pinned by a test that fails without it.

1. **The keel's angle comes from the chord axis.** `foilAoA(u, v)` in
   `tables.ts` returns `atan2(|across|, |along|)`, which is 0..90 by
   construction: edge-on is zero whichever end the water arrives at. Identical
   to `|leeway|` while `u > 0`.
2. **The rudder's angle is folded the same way** before it reaches the tables,
   keeping the old signed `alphaR = rudder + atan2(vRud, u)` so that forward
   flow is untouched. `wrapPi` turning the angle end for end *is* the reversal
   of the helm in sternway, which a boat really does.
3. **The rudder's drag opposes her way through the water** instead of always
   pointing aft. `fx -= qR * cdr` drove her when she was already going astern.
4. **The rudder's dynamic pressure uses the real speed.** The `uSafe` floor
   clamped `|u|` up to 0.3 m/s before squaring it, so a blade lying still in the
   water was handed 54.8 N — half of the pair that made the false equilibrium.

Two smaller things fell out of it. The weathervane moment took the full track
angle, so exact sternway fed ±pi to a term derived for small forward sideslip
and chose its direction from the sign of a numerical zero; it now takes the
folded sideslip. And `rudderDrag` is published, because the whole investigation
above happened for want of it.

### What moved

The polar is **unchanged** and still matches the README table at all four wind
speeds, which is the point: the fold is algebraically identical for `u > 0`, and
every steady polar solution has forward way.

The drift in a calm is now **80.0% of the tide at every stream speed** — 0.25,
0.5, 1 and 2 m/s alike. It used to read 37%, 68%, 84% and 91%. Scale-free is
what a balance between two quadratic drags has to be, and the old spread was the
clearest sign that something in it was not quadratic at all.

Head to wind she is now blown **astern at 2.3 kn** where she used to sit nearly
still. That is what a boat with her sails up does head to wind; what held her
before was the same broadside coefficient. `polar.test.ts` asserted the *speed*
was under 1.5 kn and so passed for the wrong reason; it now asserts the VMG is
not positive, which is what "cannot sail into the no-go zone" means.

### What this does not fix

The coast-down is still long, and `open-questions.md` still carries the
resistance-curve question. What has been removed is the reason to distrust every
low-speed measurement taken before it.
