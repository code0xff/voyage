# voyage

A sailing simulator that runs in the browser and actually computes the physics:
apparent wind, sail lift and induced drag, keel side force, wave-making
resistance, added resistance in waves, and a six-degree-of-freedom hull response.

```bash
npm install
npm run dev        # simulator
npm run polar      # headless polar validation (npm run polar -- 6 12 25 35)
npm run verify     # typecheck + lint + test
npm run build
```

Press `Esc` for the menu and settings.

Contributing? Read [AGENTS.md](AGENTS.md) first.

---

## Layout

```
src/sim/     pure physics core, with no dependency on Three.js at all
  math       coordinate and angle conventions, vector helpers
  units      SI <-> knots, hull speed
  tables     foil coefficient tables (tables + interpolation, not formulae)
  config     boat particulars; every tuning knob lives here
  sailplan   reefing and furling -> effective area and centre of effort
  boat       state and step(). This one file is the boat
  wind       a wind field that varies with position and drifts downwind
  waves      wind sea, and four-point hull sampling
  noise      deterministic value noise
  polar      steady-state polar solver -- the physics validation tool
  race       course generation, start/mark/finish judging
  replay     ghost recording and playback, personal bests

src/view/    rendering and UI
  scene      scene assembly, lofted hull, camera, wind streaks, wake
  water      wave surface (GPU vertex shader)
  course     marks, start line, ghost boat
  hud        instruments and polar plot
  telemetry  rolling time-series graph
  racehud    race clock, layline, start timing
  menu       menu, settings and results
  audio      procedural sound, no external assets

scripts/polar.ts   runs the same core headless, without a browser
```

**The physics core is kept separate from the renderer for development speed,
not for tidiness.** Instead of restarting the browser and sailing around after
every parameter change, `npm run polar` reports the steady state at 37 wind
angles in a few hundred milliseconds. Most of the real bugs found in this
project were caught that way.

---

## Coordinate conventions

One-line summary of the sign rules: **positive means starboard**.

| | |
|---|---|
| World | `x` = east, `y` = north (a 2D plane) |
| Bearing | compass convention: 0 = north, clockwise positive. The unit vector for angle `a` is `(sin a, cos a)` |
| Hull | `x_b` = forward (surge `u`), `y_b` = starboard (sway `v`) |
| Yaw rate `r` | positive = bow swinging to starboard |
| `AWA > 0` | wind coming over the starboard side |
| Rendering | three `(x, y=up, z)` = sim `(x, height, -y)`. The bow points along local `-Z` |

---

## The physics

### 1. Apparent wind

Where everything starts. The moment the boat moves, the sail feels the true
wind minus the boat's own velocity.

```
A = W_true - V_boat
```

### 2. Sails

The boom always swings to leeward, so the angle of attack is a subtraction.

```
AoA = |AWA| - sheet
```

- `AoA < 0` means luffing; the force fades out over five degrees.
- Coefficients are tables with linear interpolation rather than closed-form
  curves, so tuning is editing a few numbers and measured data can be dropped
  straight in.
- **Induced drag, `CDi = CL²/(πAR)`, governs upwind performance.** Close-hauled,
  drive is the small difference between a large forward lift component and a
  large drag; leave this term out and the boat points impossibly high.
- Lift is perpendicular to **the apparent wind, not the sail chord**. Model it
  as a flat-plate normal force and sailing upwind becomes physically impossible.
- Hull and rig windage is added separately.

### 3. Reefing and balance

Main and jib are modelled separately. Only the total area would be needed for
force, but keeping them apart lets reefing and furling move the **centre of
effort**:

- reefing the main moves CE forward -> lee helm
- furling the jib moves CE aft -> weather helm

Shorten only the main in a blow and the boat has to be held straight with the
rudder, and rudder angle is drag. That is where the real decision to reduce both
together comes from.

### 4. Keel and hull

A boat does not travel along its heading; it slips slightly sideways. That angle
— **leeway** — is the keel's angle of attack, and the lift it generates balances
the sail's side force. Upwind it settles at three to four degrees.

```
hull speed = sqrt(g*LWL / 2pi) ~= 1.25*sqrt(LWL)
resistance = 0.5*rho*S*Cf*v^2 * (1 + k*Fr^8) + added resistance in waves
```

Added resistance scales with wave height squared and is worst punching straight
into a head sea. Without it, more wind would simply mean more speed, and the
real decision to crack off a few degrees to ease the pounding would disappear.

### 5. Roll, pitch and heave

Roll is integrated as a second-order system, and the righting moment is
referenced to **the local water surface normal rather than to vertical**:

```
I*phi'' = M_heel - rm90*sin(phi - surface slope) - c*phi'
```

That single detail gives wave-induced rolling for free, and because it is
second order it also produces heel overshoot in gusts and the settling wobble
after a tack. A quasi-static model gives none of the three.

Waves are sampled at four points on the hull (bow, stern, both beams) and a
plane is fitted. Waves shorter than the boat should be bridged by the hull, and
a single sample at the centre of gravity loses exactly that attenuation.

### 6. Yaw

**Every hydrodynamic moment must scale with `v²`.** Leave one at `v¹` and that
term swamps the rudder at low speed, making the boat impossible to steer.

| Term | Meaning |
|---|---|
| `sideForce * ceX` | sail centre of effort |
| `keelFy * clrX` | keel centre of lateral resistance; the gap is the "lead" |
| `-heelHelm * sin(phi) * u²` | heel-induced luffing tendency |
| `+weathervane * beta * v²` | directional stability |
| `-yawDamp * r * (0.6 + v)` | yaw damping |

### 7. The wind field

A constant wind leaves the game with no tactics: find the optimum angle once and
you are done. So the wind is a function of position and time.

- Puffs are a fixed noise field, and the whole field is advected downwind.
- Shifts use a much larger spatial scale, which is what creates a favoured side.
- The wind streaks on screen are drawn with **the same function the physics
  samples**. If the visible puff and the felt puff disagreed, the player could
  not trust the display and the tactical layer would collapse.

### 8. Wave rendering

Vertex displacement runs in a GPU vertex shader; the height the boat floats at
is computed on the CPU. The two use *literally the same formula*, which is why
the wave model is restricted to a sum of sines whose parameters fit in uniforms.

### 9. Integration

Three degrees of freedom in hull axes plus roll, pitch and heave, semi-implicit
Euler, **fixed 1/120 s timestep**.

```
u' = X/mx + v*r
v' = Y/my - u*r
r' = N/Izz
```

Tie the physics to the frame rate and every tuned number produces different
results on different machines. The accumulator loop in `main.ts` prevents that.

---

## Validation

### The polar diagram

The only objective yardstick for whether the physics is right. The output of
`npm run polar` has to reproduce the characteristics of a real yacht polar.

Voyager 33 (10 m cruiser, LWL 9 m, hull speed 7.29 kn):

| TWS | Best upwind VMG | Tacking angle | Top speed | Upwind sail |
|---|---|---|---|---|
| 6 kn | TWA 50° | 100° | 4.57 kn | 100% |
| 12 kn | TWA 45° | 90° | 6.11 kn | 100% |
| 25 kn | TWA 55° | 110° | 7.31 kn | 43% |
| 35 kn | TWA 55° | 110° | 7.89 kn | 33% |

The boat **points highest in medium air and worse at both extremes** — light air
lacks the power to drive through drag, heavy air means reefed sails and a head
sea. That is the real pattern.

### Bugs the headless validation caught

None of these were visible while sailing the boat around; all of them were found
by the polar solver or the rule tests:

1. **Missing sail induced drag** — produced a 60-degree tacking angle, which is
   physically impossible.
2. **Directional stability with the wrong sign** — it accelerated the luff-up
   instead of damping it, so the boat rounded into the wind and stalled no
   matter which way the helm was pushed.
3. **Yaw moments with inconsistent velocity scaling** — heel helm was the only
   `v¹` term, and it swamped the rudder at low speed.
4. **Zero handling in line-crossing detection** — with the boat exactly on the
   line the stored side became zero, and **every subsequent crossing was
   silently dead**: start, marks and finish alike.
5. **The mark rounding rule was simply wrong** — it required 165 degrees of
   accumulated bearing sweep, but a real windward rounding turns about 90. No
   realistic track could ever satisfy it, and the autopilot orbited the mark
   forever. Swept angle was the wrong measure; it is now a two-stage
   "close enough" plus "passed on the correct side" test.
6. **Inverted pitch sign in the renderer** — the bow moved the wrong way.
7. **One-shot keys accumulating while the tab was hidden** — they all fired at
   once on return.

Also fixed: sails not rendering at all because a `Shape` was closed with a
duplicate vertex; the camera flying across the ocean on race restart; auto-reef
reacting to a single gust peak and reefing in 12 knots.

---

## Racing

A windward-leeward course, because it forces every sailing skill: tacking,
reading shifts and judging laylines upwind; gybing and trading angle against
speed downwind; slowing and accelerating at the mark roundings.

The course rotates with the true wind. Crossing the start line early (OCS)
must be cleared by returning below the line, as in the real rules. Finishing
with a personal best updates the ghost you race against next time.

---

## Controls

| Key | |
|---|---|
| `← →` / `A D` | helm |
| `↑ ↓` / `W S` | trim in / ease out |
| `T` | auto-trim |
| `1 2 3 4` | reef 0-3 |
| `F` / `G` | furl / unfurl jib |
| `Y` | auto-reef |
| `Q E` / `[ ]` | mean wind direction / speed |
| `C` | camera (chase / top-down) |
| `P` | recompute polar |
| `R` | restart |
| `M` | sound |
| `Esc` | menu / settings |

From the console: `voyage.setWind(25)`, `voyage.advance(60, 0.5)`.

---

## Tuning

Boat performance lives entirely in `CRUISER` in `src/sim/config.ts`; the
coefficient curves are in `src/sim/tables.ts`. The loop:

1. change one number
2. `npm run polar` — see which way the diagram moved
3. compare against a real yacht polar
4. only then start the dev server and check the feel

Player-facing conditions (wind, sea state, course) live in `src/settings.ts`,
deliberately separate from the physics constants. Mixing them would mean the
boat's performance changed whenever a setting moved, and the polar would stop
meaning anything.

---

## Deliberate simplifications

- Sails are modelled as a single area. The two sails in the renderer are
  visual; there is no main/jib slot interaction.
- No spinnaker, so downwind is slower than reality.
- Wind sea only: no swell and no current.
- No wave orbital velocity acting on the hull, and no surfing.
- No AI opponents; the only thing to race is your own ghost.
- No collision, grounding or mooring.
