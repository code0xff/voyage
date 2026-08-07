# voyage

A sailing simulator that runs in the browser and actually computes the physics:
apparent wind, sail lift and induced drag, keel side force, wave-making
resistance, added resistance in waves, and a six-degree-of-freedom hull response.

The wind varies from place to place and drifts downwind, the weather turns on
its own, the sun rises and sets, and islands steal your breeze and ground you if
you cut the corner. The ocean has no edge: keep sailing and new land keeps
coming over the horizon.

```bash
npm install
npm run dev        # simulator
npm run polar      # headless polar validation (npm run polar -- 6 12 25 35)
npm run verify     # typecheck + lint + test
npm run build
```

Press `Esc` for the menu and settings.

Contributing? Read [AGENTS.md](AGENTS.md) first. Known limitations and designs
for what is not built yet are in [docs/](docs/).

---

## Layout

```
src/sim/     pure physics core -- no Three.js, no React, no browser APIs
  math       coordinate and angle conventions, vector helpers
  units      SI <-> knots, hull speed
  tables     foil coefficient tables (tables + interpolation, not formulae)
  config     boat particulars; every tuning knob lives here
  sailplan   reefing and furling -> effective area and centre of effort
  boat       state and step(). This one file is the boat
  wind       a wind field that varies with position and drifts downwind
  waves      wind sea, and four-point hull sampling
  terrain    islands: depth field, wind shadow, wave shelter, grounding
  sky        time of day -- sun position, light and colour palettes
  weather    conditions that evolve on their own
  noise      deterministic value noise
  polar      steady-state polar solver -- the physics validation tool
  passage    where you are bound: bearing, VMC, ETA and the course to steer
  anchorage  whether a spot will hold her
  current    tidal streams as a function of position
  regions    bounded pieces of real coast, surveyed

src/engine.ts  the 120 Hz loop, the render loop and everything imperative

src/view/    3D rendering
  scene      scene assembly, lofted hull, camera, wind streaks, wake
  water      wave surface (GPU vertex shader, land shelter included), and the
             flat sea that carries it on to the horizon
  skydome    sky gradient and sun glow
  islands    island meshes, sampled from the same elevation field
  rain       wind-slanted rain around the camera
  telemetry  rolling time-series graph
  polarplot  polar diagram, drawn with the UI design tokens
  audio      procedural sound, no external assets

src/ui/      React overlay, built on the shadcn/ui design system
  App             layout shell
  engine-context  the bridge that keeps 60 Hz readouts out of React
  Instruments     gauges, sail plan, alerts
  PassageBar      where she is bound, and what to steer
  Logbook         the passages she has made
  PolarCard       the polar diagram
  MenuDialog      menu, settings, results

scripts/polar.ts   runs the same core headless, without a browser
```

**The physics core is kept separate from the renderer for development speed,
not for tidiness.** Instead of restarting the browser and sailing around after
every parameter change, `npm run polar` reports the steady state at 37 wind
angles in a few hundred milliseconds. Most of the real bugs found in this
project were caught that way.

The UI is React, but the loop is not. `engine.ts` publishes one mutable snapshot
per frame and the instruments write straight into the DOM; React only renders
structure and things that change rarely. A dozen readings through the reconciler
at 60 Hz would cost frame budget for nothing.

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
A = W_true - V_ground
```

**Over the ground, not through the water.** The two are the same until a tide
runs; see below.

### 1b. Set and drift

The water itself can move. That splits the boat's velocity in two, and the whole
current model is the discipline of keeping them apart:

```
V_ground = V_water + set*(1 - aground)
```

- **Through the water** drives everything hydrodynamic — hull resistance, keel
  lift, leeway, rudder, wave-making, yaw damping. A boat carried along by a
  current is not sailing through anything and feels no force from it. Leeway in
  particular is an angle of attack, and a keel being set sideways by the tide is
  not at an angle to anything.
- **Over the ground** drives position, the apparent wind, and VMG. Air is not
  carried along by the water, which is why a boat drifting in a dead calm makes
  her own breeze from dead ahead at exactly the rate she is drifting — the model
  reproduces this, and it is the check that the split is the right way round.

The consequence worth knowing: **the polar stops describing the boat the moment
there is a current**, because the apparent wind is no longer what still water
would give at that speed. `Environment.current` is therefore optional, and the
polar solver leaves it off, so a still-water measurement cannot acquire a tide
by accident.

A boat hard aground is held by the ground and the tide runs past her instead of
carrying her, so the drift is scaled by the same grip that kills her way. The
apparent wind uses that same scaled drift: otherwise she would sit stopped on
the bank while feeling the breeze of a passage she is not making.

The stream is a **field**, not one vector. It runs at its full rate in deep
water and gives up in the shallows, which is the oldest piece of tidal tactics
there is — cheat the tide inshore — and falls out of bottom friction and of the
shallow margins sitting outside the main flux. It costs nothing to compute,
because the depth is already there for grounding.

Two useful things fall out. The stream reaches zero at the shoreline, so the
model never has to think about flow running onto a beach. And open water has no
land, so the depth is the deep-water constant and the field is uniform — a
player who sets a plain set and drift gets exactly that, everywhere.

There is a set and a drift; there is no tidal *cycle*. See the deliberate
simplifications.

### 1c. Regions

A region is a bounded piece of a **real coast**, sailed freely, where the shape
of the land is genuinely that place. Two ship, both 20 km square at 25 m:
**San Francisco Bay**, from the Golden Gate to the Berkeley flats, and
**Newport**, holding the East Passage from Prudence Island out past Beavertail
and Castle Hill into Rhode Island Sound.

They are two regions rather than two of the same one because they ask different
questions. San Francisco is a bay, and the decision is the tide and where the
bottom is: a hard westerly, two and a half knots of foul flood, and a shallow
lane inshore that costs breeze and eventually the keel. Newport is a coast, and
the decision is the sea breeze and when to leave shelter — a steadier southerly
at 14 knots, a little over a knot of stream, and a passage deep almost to the
rocks, with swell outside that is not there inside.

The land and the depths are surveyed, not sketched. They come from NOAA NCEI's
CUDEM 1/9 arc-second topobathymetry — one continuous measured surface carrying
the hills and the sea floor together — baked to a committed raster by
`scripts/fetch-terrain.ts`. The Gate is 100 m deep because it is. Checked
against the chart by latitude and longitude: Alcatraz 39 m, Angel Island 180 m,
Raccoon Strait −20 m, the Berkeley flats −2.6 m. And at Newport: Beavertail
8.1 m, the East Passage entrance −55 m where it scours between the headlands,
the West Passage −15 m at the same latitude, Newport Harbour −7.4 m.

**Still not a chart.** 25 m between soundings, no height of tide, and the grid
is UTM so bearings are grid bearings — 0.35° off true at San Francisco, and
1.55° at Newport, which sits further from its zone's central meridian. Do not
take a boat anywhere on it.

Shelter is *data*, not a formula, and this is what a fixed region buys. Fetch
and wind shadow are swept over the whole grid once per two degrees of wind
shift, in 16 ms, and the water shader samples that same field as a texture. The
hand-copied GLSL that had to be kept in step with the TypeScript is gone for a
region: the shader is not a copy of the model, it reads the model's output.

The conditions are a different matter and are labelled apart. The prevailing
breeze and the stream on `Region.conditions` are the broad, well-known character
of the place, not a climatological mean or a tidal diamond. A real one would be
worth having; inventing one and writing it down beside real soundings would be
worse than admitting the sketch.

**The city front** is the decision the tidal field exists for. A hard summer
westerly, a flood setting east against it, and the beat has to go out into both.
Measured on the surveyed water: 1.4 knots of foul stream offshore in 17 m
against 0.2 knots in the lane at 5 m, with the ground a hundred metres past it.
That is the shape of a decision — a lane that were only better would be the
answer, not a choice. The set is the flood and not the ebb deliberately: an ebb
runs out of the Gate within twenty degrees of the way a westerly makes you beat,
so it would carry the boat towards the mark and leave nothing to escape.

Venues — named places sketched from overlapping circles — were the earlier
answer and none ship now. The type survives because it is still right for a
coast with no open survey behind it: CUDEM covers US waters and nothing else.

### 2. Sails

The boom always swings to leeward, so the angle of attack is a subtraction. The
sail is integrated in five horizontal strips, each with its own height, its own
wind and therefore its own angle of attack:

```
AoA(u) = |AWA(u)| - (sheet + twist * u)      u = 0 at the foot, 1 at the head
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

### 2b. The wind gradient and twist

Friction against the water slows the wind near the surface, so the head of the
sail stands in a stronger true wind than the foot. The profile is the power law
`V(z) = V_ref · (z/z_ref)^0.14`, which puts the head of this rig in about 28%
more wind than its foot.

`V_ref` is quoted at the height of the **full-sail centre of effort**, not the
10 m meteorological standard. That choice is the whole design: referenced
anywhere else, adding a gradient would simply mean every sail on the boat saw
less wind, the boat would be slower everywhere, and `CRUISER` would be retuned
until the polar came back to where it started.

That reference height is an authoring choice, not a claim about instruments. A
boat has one wind sensor and it is at the masthead, 14 m up, so **AWA and AWS on
the display are read there**, along with the vane drawn on the mast — one
sample, one instrument. TWS stays the quoted reference wind, which is the number
the conditions are set in and the polar is indexed by. Reading the sail's wind
into the AWA gauge put a figure on screen that disagreed with the vane beside it
by up to twenty degrees off the wind.

The boat's own velocity is the same at every height, so a stronger true wind up
top means the apparent wind up there comes **from further aft**. The gap between
the apparent wind angle at the head and at the foot is exactly the twist the
sail wants. It is small on a beat, where boat speed dominates the apparent wind
and compresses the spread, and large on a broad reach — which is why sails are
trimmed nearly flat upwind and let right open downwind.

The auto-trim states this as: trim the foot to the target angle of attack with
the sheet, then put the head at the same angle with the twist. While the boom is
free those two are the same thing and the twist comes out as exactly the
gradient's spread.

Once the boom is against the shrouds the sheet has run out of travel, the foot
is stuck well past its stall, and there is a real choice: twist the head back to
where the flow reattaches, or leave it stalled. Which is faster is not the same
at every angle, because lift acts across the flow and its forward component dies
away as the boat bears away, while stalled drag acts along it and grows. On a
broad reach reattaching the head is worth 1%; by a dead run the same move throws
away almost all the drive, since a running sail does its job *by* being stalled.
The trim compares the drive each choice would make, read out of the same
coefficient tables the sail forces come from, rather than hard-coding the angle
where they cross.

Twist has a second job, and measurement says it is the more valuable one:
**twisting the head open depowers the boat**. The head has the longest lever on
heel, so spilling it sheds heeling moment while the foot keeps driving — and
what that buys is sail area. Hard on the wind in 20 knots, twisting off carries
65% of full sail where an untwisted rig has to reef to 54% to hold the same 27
degrees of heel, and goes 8% faster for it. The auto-trim therefore trims for
power until the boat is overpowered and then twists off, and because that band
opens well below the auto-reef's trigger — twist starts at 24 degrees of
sustained heel and is three-quarters on by the 30 that starts a reef — the cheap
depowering goes in before the expensive one.

It is not tuned to the last percent. In the same 20 knots, holding full twist
by hand carries the whole mainsail at that heel and is a further 5% faster than
the auto-trim manages, so the depowering ramp is conservative: it reefs a little
earlier than it needs to. That is a tuning question about how much heel a
cruiser should accept, not a modelling one, and it is deliberately left open.

All of this is held in place by a test that sweeps fixed twist angles at each
operating point and requires the auto-trim to land within 1% of the best of
them, with the deep angles in its grid because that is where the rules tried on
the way here went wrong. It catches two of the three; the third costs only 0.2%
and is pinned by a separate test asserting that close-hauled, with the boom on
its inhaul, the head still follows the foot.

What under-twisting costs depends entirely on where the boom is. On and around
the wind it is nearly free — about 1% at worst — because the spread is small
and the sail's lift curve is flat near its peak, so a head a few degrees off
ideal hardly notices. On a broad reach it is not free at all: sailing TWA 150 with
the sail untwisted costs 3.2% in 6 knots and 2.0% in 10, because the boom is
against the shrouds and twist is the only trim left that can reach the top of
the sail.

In a breeze the sign flips. Dropping the twist to zero hard on the wind in 18
knots is 0.5–0.8% *faster* through the water, because it undoes the depowering
— and buys that speed with several more degrees of heel. Which is the whole
point: twist is first a depowering control, and only second a way of matching
the gradient.

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

### 7. Land

Islands are only worth having if they change how you sail. Three effects make
them tactical rather than decorative:

- **Wind shadow.** An island steals the wind downwind of it, in a wake that
  spreads and weakens with distance. Sailing into a lee is a real and painful
  mistake. This was nearly free to add, because the wind is already a pure
  function of position — the shadow is one more term composed into
  `WindField.sample()`.
- **Flat water in the lee.** Waves need fetch, so shelter reaches much further
  downwind than the wind shadow does. Sometimes the smooth water is worth the
  lost breeze, which is exactly the kind of trade worth offering.
- **Grounding.** The seabed shoals towards the shore, and the shallows stop you
  dead. That is what makes cutting a corner a gamble.

Island shapes are analytic — a noise-modulated radius — so every query is a few
arithmetic operations and the physics can call them at 120 Hz. The meshes are
built by sampling the very same `elevationAt()` the boat grounds on, and the
water shader recomputes `waveShelter()` in GLSL, so what you see and what you
sail through cannot drift apart.

**The ocean has no edge.** Islands are not a list generated at the start. The sea
is divided into cells, and whether a cell holds an island — and what shape it is
— comes from hashing its coordinates with the world seed. Nothing is stored, so
the world costs the same whether you sail a mile or fifty, and an island you
passed an hour ago is still there when you come back to it.

The boat, though, is handed a plain finite list: the physics, the water shader
and the meshes must all agree on the same islands, and a shader cannot hash an
infinite plane. `IslandField` keeps that list up to date as the boat moves, and
the window is provably big enough — a wake is over by `WAKE_MAX` from the island
that casts it, and nothing is asked about the terrain further than `QUERY_REACH`
from the boat, so land outside the window cannot change any answer. That bound
is why the wake is faded to exactly zero at the end of its reach rather than
being left to decay forever: an unbounded tail and a finite window cannot both
be honest. The cost is that a large island's flat water now ends by 1.5 km
instead of thinning out to 2.5 km, which is a long way downwind of anywhere.

The meshes are drawn from a wider window than the physics uses, out past the fog
at any visibility, so land is always born unseen rather than appearing out of
clear air. Nothing in that outer ring affects the boat, so the two windows are
allowed to differ.

### 8. Time of day and weather

The sun is not astronomical: elevation is a sine between fixed sunrise and sunset
hours. What matters to a helmsman is how much light there is and where the glare
sits, and a real ephemeris would add nothing on top of that. Everything visual —
sky gradient, sun glow, light colour, water colour, fog — is a pure function of
the hour, so the renderer, the shader and the HUD can ask independently and never
disagree. Night is never pitch black, because a moonlit night at sea is genuinely
sailable and an unplayable one would just be a black screen.

The sky itself carries two things beyond the gradient, both drawn in the dome's
fragment shader and neither touching the physics. **Cloud** is the cover the
weather already publishes, drawn as a flat deck seen in perspective: dividing
the view direction by its own height is what makes it a deck rather than a
pattern on a dome, so it foreshortens towards the horizon the way a real layer
does. It drifts downwind, at a rate chosen to read rather than at the wind's own
speed — cloud rides a wind that is neither the surface wind nor at its speed,
and at 60× an honest rate would strobe. Past about eight eighths the gaps close
completely, because the alternative is blue puddles punched through grey, which
looks worse than the featureless lid this replaced.

**Stars** are procedural and make no claim to be a catalogue; a sky with a faked
sun has no business asserting real constellations. What is real is that the field
turns about a celestial pole at fifteen degrees an hour. They are occluded by the
cloud cover *at that pixel*, so a broken night shows stars through the gaps and
closes them again as the deck goes over.

Weather is a slow random walk between named conditions (clear, fair, overcast,
rain, squall, fog), with every continuous quantity easing towards its target
rather than snapping. It drives mean wind, gustiness, visibility, cloud cover and
rain. This is what makes two passages over the same water different: a squall
arriving halfway forces a reef and changes which side of the bay pays. It is seeded, so a
given seed replays exactly.

Weather runs on two clocks, deliberately. *When* it turns is world time — a
front lasts a couple of hours, on the same clock that moves the sun, so at the
default 60× time scale the conditions turn every minute or two of play. *How
fast the change looks* is real time, eased over tens of seconds, because a
squall that arrived in a third of a second would read as a bug rather than as
weather. Counting the dwell in wall-clock seconds, as it once did, meant the sun
crossed the entire sky while the weather sat on `fair` — the one system meant to
make two sessions differ never did anything inside one.

### 9. The wind field

A constant wind leaves the game with no tactics: find the optimum angle once and
you are done. So the wind is a function of position and time.

- Puffs are a fixed noise field, and the whole field is advected downwind.
- Shifts use a much larger spatial scale, which is what creates a favoured side.
- The wind streaks on screen are drawn with **the same function the physics
  samples**. If the visible puff and the felt puff disagreed, the player could
  not trust the display and the tactical layer would collapse.

### 10. Wave rendering

Vertex displacement runs in a GPU vertex shader; the height the boat floats at
is computed on the CPU. The two use *literally the same formula*, which is why
the wave model is restricted to a sum of sines whose parameters fit in uniforms.

### 11. Integration

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

| TWS | Best upwind VMG | Tacking angle | Top speed | Upwind sail | Twist |
|---|---|---|---|---|---|
| 6 kn | TWA 50° | 100° | 4.56 kn | 100% | 3° |
| 12 kn | TWA 45° | 90° | 6.10 kn | 100% | 4° |
| 25 kn | TWA 45° | 90° | 7.30 kn | 54% | 17° |
| 35 kn | TWA 55° | 110° | 7.88 kn | 33% | 17° |

The boat **points highest in medium air and worse at both extremes** — light air
lacks the power to drive through drag, heavy air means reefed sails and a head
sea. That is the real pattern.

In a breeze the boat now twists the head of the sail open instead of reefing so
early: at 25 knots it carries 54% of full sail where it used to carry 43%, and
points 20 degrees closer to the wind for it. At 35 knots the trade runs the
other way — it holds a steady 28 degrees of heel where it used to lie over at
36, and gives up about 7% of upwind VMG to do it. That is the intended answer.
A polar is the speed you could hold *if you sailed the boat well*, and nobody
sails a cruiser to windward in a gale at 36 degrees of heel.

Those 28 degrees are not a target the boat aims at and falls short of. Nothing
in the model holds a heel; the reef fires once the six-second average passes 30
degrees and takes off enough sail to put it back under, so the settled angle in
any real breeze sits just below the trigger by construction. Moving it means
moving `REEF_UP`, and the price is sail area and upwind VMG in exactly the
conditions that have least of both to give away.

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
duplicate vertex; the camera flying across the ocean on restart; auto-reef
reacting to a single gust peak and reefing in 12 knots.

---

## Passage making

There is no race. A passage has a start, an end and a written record,
which is everything a race supplied — a measured time, something kept, and a
reason to sail well — without a gun, a penalty or an opponent.

Click the chart to say where you are bound. The bar at the top carries the
bearing, the distance, an arrival time worked from speed made good *on course*
rather than boat speed, and the two judgements that decide a passage: what to
steer so the tide sets you onto the track rather than off it, and whether the
light will last.

Arriving means bringing her to rest somewhere she will stay: water between
three and twelve metres, the way off her, and the anchor down. Then the passage
writes itself into the logbook.

---

## Controls

| Key | |
|---|---|
| `← →` / `A D` | helm — the keys move it, it holds where you leave it |
| `Space` | centre the helm (or hold both directions) |
| `↑ ↓` / `W S` | trim in / ease out |
| `Z X` | vang: close the leech / let the head twist open |
| `T` | auto-trim |
| `H` | autopilot: off → compass → wind (any helm input drops it) |
| `1 2 3 4` | reef 0-3 |
| `F` / `G` | furl / unfurl jib |
| `Y` | auto-reef |
| `Q E` | mean wind direction |
| `[ ]` | mean wind speed |
| `C` | camera (chase / top-down) |
| `0` | hand all sail, or set it again |
| `A` | let go the anchor, or weigh it |
| `N` | chart range |
| wheel over the chart | chart range |
| drag the chart | look around it; double-click recentres on the boat |
| click the chart | set where you are bound; right-click clears it |
| drag | orbit the camera around the boat |
| wheel anywhere else | zoom the camera |
| double-click | recentre the view astern |
| `P` | recompute polar |
| `R` | restart |
| `M` | sound |
| `Esc` | menu / settings |

From the console the whole engine is exposed as `voyage`: `voyage.advance(60, 0.5)`
runs the physics without rendering (useful because a backgrounded tab freezes
`requestAnimationFrame`), and `voyage.snapshot` is the live world state.

---

## Tuning

Boat performance lives entirely in `CRUISER` in `src/sim/config.ts`; the
coefficient curves are in `src/sim/tables.ts`. The loop:

1. change one number
2. `npm run polar` — see which way the diagram moved
3. compare against a real yacht polar
4. only then start the dev server and check the feel

Player-facing conditions (wind, sea state, tidal set and drift, region) live in
`src/settings.ts`, deliberately separate from the physics constants. Mixing them would mean the
boat's performance changed whenever a setting moved, and the polar would stop
meaning anything.

---

## Deliberate simplifications

- Main and jib are integrated as one equivalent sail — separate areas and
  centres of effort, but a single set of strips. The two sails in the renderer
  are visual; there is no main/jib slot interaction.
- The wind gradient changes wind *speed* with height but not direction. Real
  shear veers a degree or so over a rig this size, which no helmsman notices.
- No spinnaker, so downwind is slower than reality.
- Wind sea only: no swell.
- Wind against tide *does* now raise the sea, and turn it: the wave field is
  built from the wind relative to the moving water. What is still missing is
  that the current moves the boat but not the sea around her. Waves are a function of
  world position and time, and they stay that way with a tide running instead of
  being carried along by it; the wake is a trail of ground positions rather than
  something laid in the water and drifting with it. Physics and renderer agree
  with each other here — both read the same wave field — so this is a
  simplification and not the kind of divergence the water shader exists to
  avoid.
- There is a current, but no **tide**. The stream varies with depth — it runs in
  the channel and gives up in the shallows — but it does not vary with *time*:
  no cycle, no turn of the tide mid-passage, no springs and neaps, no change of
  depth with the height of tide, and no gate that opens and shuts. Reversing the
  stream is a phase term and nearly free; the height is not, because a falling
  tide has to decide what happens to a boat anchored over a bank, and the two
  belong together.
- No wave orbital velocity acting on the hull, and no surfing.
- No AI opponents, and nothing to chase: the passage ghost is designed and not
  built. See [docs/open-questions.md](docs/open-questions.md).
- No boat-to-boat collision.
- The sun is not astronomical, and islands shadow the wind without bending it
  around headlands. Both are deliberate: see AGENTS.md.
