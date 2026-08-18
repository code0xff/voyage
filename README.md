# voyage

A sailing simulator that runs in the browser and actually computes the physics:
apparent wind, sail lift and induced drag, keel side force, wave-making
resistance, added resistance in waves, and a six-degree-of-freedom hull response.

The wind varies from place to place and drifts downwind, the weather turns on
its own, the sun rises and sets, and the land steals your breeze and grounds you if
you cut the corner. The ocean has no edge: keep sailing and new land keeps
coming over the horizon.

That ocean is the real one. The boat has a latitude and a longitude, the coast
that comes over the horizon is where the Earth says a coast is, and the wind at
a latitude is the wind that belongs to it -- the trades from the east, the
westerlies from the west, and the doldrums in between where a day can go by.

```bash
npm install
npm run dev        # simulator
npm run polar      # headless polar validation (npm run polar -- 6 12 25 35)
npm run verify     # typecheck + lint + test
npm run build
```

Press `Esc` for the menu and settings.

The build is a static site and needs nothing behind it. It assumes it is served
from the root; to serve it from a subpath, name the subpath at build time:

```bash
VOYAGE_BASE=/voyage/ npm run build
npm run check:base -- dist /voyage/    # nothing still points at the root
```

The check is worth running because that mistake is invisible at the root, which
is where everyone develops: the models, the attribution notices and the
planet's raster are fetched at runtime, so the bundler never sees those paths
and cannot correct them. `.github/workflows/deploy.yml` does both on request.

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
  terrain    the terrain interface every world answers, and an empty sea
  sky        time of day -- sun position, light and colour palettes
  weather    conditions that evolve on their own
  wildlife   gull calls and occasional seeded coastal flocks
  whales     seeded whale encounters, kept outside boat physics
  sharks     seeded shark encounters, kept outside boat physics
  giveway    how an animal clears the track of an approaching boat
  noise      deterministic value noise
  rng        the seeded stream, stirred so nearby seeds start apart
  polar      steady-state polar solver -- the physics validation tool
  passage    where you are bound: bearing, VMC, ETA and the course to steer
  anchorage  whether a spot will hold her
  current    tidal streams as a function of position
  regions    what a height-field world is, and what a passage's place was called
  globe      the tangent plane <-> latitude and longitude, and great circles
  earth      the coarse planet, asked one question: where is the land
  climate    what the latitude does to the wind -- the belts a pilot chart has

src/engine.ts  the 120 Hz loop, the render loop and everything imperative

src/view/    3D rendering
  scene      scene assembly, lofted hull, camera, wind streaks, wake
  water      wave surface (GPU vertex shader, land shelter included), and the
             flat sea that carries it on to the horizon
  skydome    sky gradient and sun glow
  region-mesh land tiles, sampled from the same elevation field the boat grounds on
  eye        where the camera is and which way it faces, for both views
  creature   what the animal views share: scale, waterline, wave slope, disposal
  whale      humpback: dive cycle, blow and the footprint it leaves
  shark      a fin holding its course across yours
  gull       an authored flock, circling within sight of a coast
  minimap    the chart: land, breeze, tide, and where she is bound
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
  MinimapCard     the chart panel, and the full-screen view of it
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

The stream turns. `driftKnots` is its rate at full run, and it dies to slack
about three hours in, runs back the other way and returns — a 12.42-hour cycle
measured from the session's start hour, which the player can lengthen, shorten
or switch off. What there is no model of is the *height*: see the deliberate
simplifications.

### 1c. One world, and the six that were retired

The Earth is the only world with land in it now. Six **surveyed regions** used
to ship beside it — twenty kilometres square at 25 m, from NOAA NCEI's CUDEM
1/9 arc-second topobathymetry — San Francisco Bay, Newport, Merchant Row, Puget
Sound, Chesapeake Bay and Buzzards Bay. Each was chosen for being extreme on a
measured axis, the survey of nine US coasts that picked them is written up in
[docs/real-map.md](docs/real-map.md), and the rasters are in the history of this
repository.

They were removed because of what they turned out to be, which is the part
worth recording. **They bought a true bottom and not a chart.** The chart draws
land and one contour — the water shallower than your own draft — so a surveyed
shoal was something you struck rather than something you planned around; there
are no soundings, no buoys, no leading marks; and the stream, at San Francisco
the whole point of the place, does not turn with a tide this simulator does not
have. Twenty kilometres of measured ground under a boat that cannot read it is
a great deal of machinery for one decision.

What the Earth answers instead is *where*: the passage, the bearing, the
distance, the landfall, the belt and the ocean floor offshore, all of it real.
What it invents is the shoreline inside the right gulf, at anything finer than
the planet's 7 km cell. Those are different questions, and the second one is
the game this is.

`Region` survives as a type because the generated coast is one: a name, a grid
and where its samples came from, read by the same `HeightField` and
`RegionTerrain` the surveyed rasters went through.

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
I*phi'' = M_heel - rm90*sin(phi + rollSlope) - c*phi'
```

The slope is added rather than subtracted, and that is not a typo. Heel is
positive starboard-*down* while `rollSlope` is positive starboard-*up*, so the
two are measured in opposite directions and lining the hull up with the water
means adding them. Subtracting, which this said and did until it was caught,
settles the boat at twice the slope on the wrong side of it.

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

Land is only worth having if it changes how you sail. Three effects make it
tactical rather than decorative:

- **Wind shadow.** Land steals the wind downwind of it, in a wake that
  spreads and weakens with distance. Sailing into a lee is a real and painful
  mistake. This was nearly free to add, because the wind is already a pure
  function of position — the shadow is one more term composed into
  `WindField.sample()`.
- **Flat water in the lee.** Waves need fetch, so shelter reaches much further
  downwind than the wind shadow does. Sometimes the smooth water is worth the
  lost breeze, which is exactly the kind of trade worth offering.
- **Grounding.** The seabed shoals towards the shore, and the shallows stop you
  dead. That is what makes cutting a corner a gamble.

The land is a height field: the meshes are built by sampling the very same
`elevationAt()` the boat grounds on, and the water shader reads the shelter the
physics computed as a texture, so what you see and what you sail through cannot
drift apart.

**The ocean has no edge.** The ground is a pure function of world position and
seed, so nothing is stored: the world costs the same whether you sail a mile or
fifty, and a headland you passed an hour ago is still there when you come back
to it.

It is sampled into a 20 km height-field window — the same one the surveyed
regions used — and the engine re-bakes that window about the boat as she sails
along the shore, a few raster rows per physics step (the full field is a
measured ~190 ms, too much for one frame).
Windows are pinned to a shared 25 m world lattice, so any two of the same seed
agree exactly where they overlap: the swap moves the horizon, never the water
under the keel, and the mainland goes on however far you follow it.

The chart is drawn wider still, and it is the one thing here that is not about
the boat: its whole job at a passage scale is water she has not reached.
`CHART_RANGE` covers the widest range, how far the chart may be held off the
boat, and how far a coastline is drawn past its own centre; `minimap.test.ts`
adds those three up from the same constants, so a range added without the sea to
back it fails a test rather than quietly drawing an empty sea.

### 7b. The planet

The endless coast is not invented any more. `globe-4m.bin` is ETOPO 2022's
surface elevation at four arc-minutes — 5,400 × 2,700 int16 metres, 29 MB — and
`Earth` is asked exactly one question of it: **where is the land**. Seven
kilometres a cell (north-south; less east-west, and much less near the poles) is
a quarter of the window the boat sails inside, so it is far too coarse to anchor
in and is never used as terrain. It decides continents, gulfs, and islands big
enough to have a name; the metres under the keel are still the coast generator's,
conditioned on it.

That division is worth being plain about. Sail from Gibraltar to the Canaries
and the passage, the bearing, the distance and the landfall are the real Earth's.
The beach you anchor off is invented — a plausible coast in the right place, not
the coast that is there, and the menu says so. Six surveyed squares used to be
the exception; see 1c for what they were and why they went.

Eleven **departures** are offered outright — the Golden Gate, Cádiz, the Cape of
Good Hope, the Korea Strait, Sydney, Cape Horn, Antigua, Oahu, Reykjanes,
Zanzibar and the Galápagos. An ocean that may be entered at any point is an
ocean with no doors, and a player who wants to sail the Cape should not have to
spend a fortnight getting there. They are spread across the belts on purpose,
each named with the one it sits in, and every position is *verified against the
shipped raster* rather than remembered: about four kilometres off its coast --
the distance the generated coast has always put its own spawn at -- with a
coast filling a fifth of the window she opens in and ten metres of water all
round her. `waters.test.ts` builds each window and checks exactly that. Three of
the first draft's coordinates were dry land, and the draft after that put every
departure twelve kilometres out, which passes a distance check and opens on an
empty sea.

A session opens where the last one got to. That is what makes the planet a
place rather than a backdrop: a boat that reached the Azores and reopened off
San Francisco has had a passage taken away from her. One row in localStorage
holds the position and nothing else — not the trim, not the heading, not the
hour — because every session in this game is a *departure*, prepared for the
conditions of the moment, and restoring an exact instant would fight that
rather than extend it. The menu shows where the next departure opens and offers
to forget it.

The sim works in metres on a tangent plane, and it keeps doing so: `globe.ts`
converts to latitude and longitude at the edges. A plane is honest near its pin
and not far from it — measured against the great circle, 0.001% at 100 km due
east, 0.06% at 1,000 km, 1.6% at 5,000 — so the pin moves, every 200 km, and
every plane position the session holds is *reprojected* through latitude and
longitude rather than offset (an offset is 43 m wrong over 100 km, because
mean-latitude scaling is not a translation).

It answers a second question with the same read: **how deep it is out there**.
A generated coast fades to a 42 m floor, which is a fair coastal shelf and a lie
two thousand kilometres from anywhere: every ocean on the planet sounded like
one. The shelf stays a shelf, and past everything the
generator invents (the outer islands reach 16 km) a second, much wider ramp
takes the ground down to the ocean's own floor by 32 km offshore. The soundings
are stored as int16 at 20 cm, which reaches 6,553 m.

Which half of the pair is the shoreline, in one number: the coast generator was
already built around a single input, the signed distance to the waterline, so
conditioning it on the Earth is a matter of handing it a distance field read off
the planet instead of one made from a straight line and three octaves of noise.
The meso and crenellation octaves are still added on top — the real gulf, with an
invented shoreline inside it — because the source has no feature finer than a
cell. Only the macro swing drops out, which is the scale the Earth now supplies.

### 7c. The wind belts

Latitude is not decoration here: it is what decides the wind. `climate.ts` is a
climatology — the long-run averages a pilot chart carries, not a forecast, with
the weather still deciding what today does on top of it.

| belt | latitude | from | mean |
|---|---|---|---|
| doldrums | 0-5° | — | 4 kn |
| trades | 5-28° | NE (north), SE (south) | 15 kn |
| horse latitudes | 28-34° | — | 6 kn |
| westerlies | 34-62° | W, backing NW | 22 kn, ×1.25 in the south |
| polar easterlies | 62-90° | NE (north), SE (south) | 11 kn |

Blended along the latitude with overlapping smoothsteps rather than branched on,
so crossing 30° is a day of the wind swinging and easing rather than a line where
it changes. The direction is built as *how much comes from the east* and *how
much from the north* and turned into a bearing only at the end, which is what
keeps it continuous across the equator, where the meridional lean changes sign
— it fades through zero over the ITCZ's own five degrees rather than flipping,
so the doldrums blow from due east, which is what the two trades leave when they
cancel.
The Southern Ocean is the one asymmetry: nothing is in its way, so the same belt
that gives Biscay a gale gives Cape Horn a bigger one.

The player's wind slider is scaled, not replaced. It sets what trade-wind
strength means and every belt is relative to it, so 25 knots is still a hard sail
everywhere and the doldrums are still the softest place they can be. Direction is
taken outright — a compass bearing has no slider to honour.

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
rain, squall, shower, fog), with every continuous quantity easing towards its target
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

`shower` — rain with the sky broken behind it — was added late, after a
measurement. Every other wet condition sits at 0.95 cover or above, and `rain`
eases out faster than `cloud` does, so drops in the air with the sun on them was
a combination the model simply could not produce: over thirty simulated days it
happened for one minute out of 720 hours, both times as an accident on the
leading edge of a front. A passing shower — bright, brief, a hard gust under it
and then gone — is one of the most common things that happens on the water, and
it was missing.

What it makes possible is a rainbow, and the bow is worth having precisely
because it is not random. It is drawn on the sky dome at 42° from the antisolar
point, with the secondary at 51° and its colours the other way round, and the
sky between the two darker than the sky outside either — Alexander's band, known
since about 200 AD, and the detail that stops a drawn bow looking like a decal.
None of those numbers is tuned: they are where water refracts sunlight back at
its minimum deviation, and they are the same over every ocean on earth.

The consequence people notice is that there is no such thing as a midday
rainbow. The arc is centred as far below the horizon as the sun is above it, so
with this sky peaking at 62° the bow belongs to morning and evening and stands
highest when the sun is barely up. Over thirty simulated days it shows eight
times, for a median of 38 minutes of world time each — about half a minute of
play at the default time scale.

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

Anything else drawn on the water reads it through `Water.surfaceHeight`, which
is that same formula plus the two things the shader does to it and the boat
never sees: the fade that flattens the grid towards its edge, and the land
shelter. A whale lying on the swell in the lee of a headland would otherwise be
riding a sea nobody is drawing.

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

### And one the polar could not catch

Worth recording, because it is where the method above has an edge.

**The righting moment took the wave slope with the wrong sign**, so a hull left
to itself on a wave leaned *into* its face rather than lying along it, at twice
the slope angle. `rollSlope` is positive starboard-up and `heel` is positive
starboard-down, and the difference of the two was taken as though they ran the
same way.

The polar could not have found it, and no polar ever will: `solvePolar` sets
`rollSlope` to zero deliberately -- a rolling boat has no steady state to solve
for -- so the term is identically zero in every polar this project has ever run,
and all four rows are unchanged by the fix. Nor was there a rule test that put
the boat on a slope; there is now, and it catches it in a tenth of a second.

So this is not a bug headless work *cannot* find. It is one that nothing which
existed was pointed at, and the thing that eventually pointed at it was drawing
a whale: the animals were laid on the water by copying this line, and checking
their attitude against the analytic normal of a sloping plane showed it
mirrored. The renderer is supposed to be the part that takes its answers from
the physics. Here it was the only place anyone had looked.

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
| `C` | camera: astern / on deck / overhead |
| `0` | hand all sail, or set it again |
| `A` | let go the anchor, or weigh it |
| `B` | binoculars — the wheel or a pinch sets the power, and it is remembered |
| `U` | fire a parachute flare — one a minute, and the night answers |
| `N` | chart range |
| wheel or pinch over the chart | chart range |
| drag the chart | look around it; double-click recentres on the boat |
| click the chart | set where you are bound; right-click clears it |
| drag | look around — the eye follows your hand, as in a first-person view |
| wheel or pinch anywhere else | the eye closer in or further out — or the power, through the glasses |
| double-click | recentre the view astern |
| `P` | recompute polar |
| `R` | restart |
| `K` | photograph the sea — the view alone, no instruments |
| `M` | sound |
| `L` | navigation lights |
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

Player-facing conditions (wind, sea state, tidal set and drift, the departure) live in
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
- Wind against tide raises the sea and turns it — the wave field is built from
  the wind relative to the moving water — and the waves are now carried along
  by the stream as well: their displacement is integrated and folded into each
  component's phase. One vector for the whole field, the deep-water set, so
  what the sea is carried along with is that set rather than the local stream —
  the same thing in open water, and a little faster than the water itself where
  depth throttles it. The wake is laid in the water with them, kept in the
  water's frame and moved by the same offset the sea uses. Physics and renderer
  agree throughout — both read the same field, and the shader is handed the
  drifted phase rather than recomputing it.
- There is a stream that turns, but no tidal **height**. The set runs at its
  full rate, dies to slack about three hours in, and runs back — a 12.42-hour
  cycle on the world clock, which the player can lengthen, shorten or switch
  off — and it still varies with depth, running in the channel and giving up in
  the shallows. What is missing is the height: no springs and neaps, no depth
  that changes with the tide, and no gate that opens and shuts. The height is
  not another phase term: a falling tide has to decide what happens to a boat
  anchored over a bank, and what the soundings on the chart are measured from.
- No wave orbital velocity acting on the hull, and no surfing.
- No AI opponents, and nothing to chase. Racing's ghost — your own best run,
  replayed alongside you — was put to the question again for passages and
  turned down. See [docs/open-questions.md](docs/open-questions.md).
- No boat-to-boat collision.
- **The whales and sharks are sightings, not bodies.** They exert no force, they
  are not in the way, and losing one changes no outcome; what they do is happen
  where you can see them — now and then, and as often as you ask: the slider
  runs from an empty sea to a busy one, and the default is a whale about every
  eight minutes. It used to be one every eighty seconds, in sight for two fifths
  of every passage, which is scenery rather than an event. Both give way to an approaching boat, which is both
  what an animal does and what keeps the hull out of it, but only against a boat
  sailing a course. Chase one deliberately and you will catch it: she makes
  3.09 m/s to a whale's 1.8 and a shark's 1.6, and a pursuer that keeps
  re-aiming at something slower than itself always closes. Preventing that would
  need the animal able to outrun you, or a collision model, and neither is worth
  it for a thing you have to go out of your way to see.
- The sun is not astronomical, and land shadows the wind without bending it
  around headlands. Both are deliberate: see AGENTS.md.
- **The planet is a coastline and a climate, not a world.** The Earth decides
  where the land is and the latitude decides what the wind does; nothing else
  follows from where you are. There is no season, so day length is the same at
  the equator and at 60 north; the sea state comes from the local wind rather
  than from an ocean's own swell; the animals are the same animals everywhere;
  and there is no port to make for and nothing to carry there. Each of those is
  a real difference between one sea and another, and each is a separate piece of
  work rather than a gap in this one.
- **No time compression at sea.** The clock speeds up — day and night, the
  weather, the sea building — but the boat does not. A circumnavigation is
  therefore possible in the world and impossible in practice: 32,000 km at six
  knots is 120 days of real time, and nothing shortens it. The eleven
  departures are the answer to "let me sail that sea", and they are enough for
  it; crossing the ocean between two of them is a separate feature that has
  not been built.

  **Shrinking the planet is not the alternative it looks like.** A 1:20 Earth
  does not just move the coasts closer, it shrinks *them*: the four-arc-minute
  grid becomes 350 m a cell, and the Strait of Gibraltar is 700 m wide instead
  of 14 km. The boat also sails in real m/s from real physics, so a scaled map
  would leave the logbook's distances, the ETA and the polar describing a world
  the boat is not in — one of the two would have to be a lie.

  If it is ever wanted, the shape it should take is already here: `solvePolar`
  gives the steady-state speed at a wind angle, and *that is the same physics'
  own solution*. Offshore, the boat can be advanced along her polar in
  minute-long steps with the wind and weather still running, and dropped back
  into the 120 Hz model when land is near or the helm is taken. Running the
  existing integrator faster is not an option: 500× is 60,000 steps a second,
  and enlarging `dt` instead breaks it, because the roll period is about a
  second.
- **No ice, and a wall at 89.5°.** The Arctic reads as open water, because the
  grid is surface elevation and sea ice is not in it — so the polar easterlies
  can be sailed in a way they cannot be sailed. The plane's latitude is clamped
  short of the pole (crossing it would have to reverse the y axis), which is the
  one hard wall in the world model. Both are stated in `globe.ts` where they
  live.

---

## Credits

Everything in this repository is written for it, with three exceptions. The
animals you meet at sea are authored models, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- **Humpback whale** — [eelislay](https://sketchfab.com/eelislay),
  [model](https://sketchfab.com/3d-models/humpback-whale-d3f5039a8c624e099724dd7bcd51a680)
- **Shark** — [eelislay](https://sketchfab.com/eelislay),
  [model](https://sketchfab.com/3d-models/shark-1b45eb40145a4cf981c601f5d9f168d3)
- **Seagulls animated** — [vicente betoret ferrero](https://sketchfab.com/deathcow),
  [model](https://sketchfab.com/3d-models/seagulls-animated-73aed843190a4dfda55f2b65cc0f8d63)

All three live under `public/assets/`, each beside an `ATTRIBUTION.txt` giving
the same notice and stating what was changed, which the licence asks for. All
three are compressed (`EXT_meshopt_compression`, `KHR_mesh_quantization`, and
WebP textures where there are any) and all three are scaled, positioned and
animated at runtime. Nothing has been added to or taken out of them.

That compression is worth its own line: 5.0 MB became 700 kB, and the shark
alone went from 3.9 MB to 509 kB. It is all geometry — sixty-five thousand
vertices for an animal a few hundred pixels wide at the range it is seen from.
Meshopt rather than Draco, which is five times smaller again but arrives with a
300 kB wasm decoder that has to be served separately; the meshopt decoder is a
25 kB module that bundles with the rest.

None is fetched when the page opens. Each is requested only when its first
sighting exists to draw.

Using an authored asset at all is a reversal, and worth recording as one.
Hand-modelled whales, dolphins and gulls were built early and all cut: a
low-poly animal reads as geometry rather than as life, and a bad animal is worse
than none, because it tells you the sea is a set. That argument was about
*modelling* them and it still stands — which is exactly why these three are not
modelled here. The procedural gull call remains the navigational cue; an
occasional authored flock now gives the same cue a body, holding its patch of
sky for a quarter of a minute within sight and then gone. Long enough to look up
at, which six seconds was not: it read as a glitch rather than as birds.

The asset is four birds on one baked circuit, and a flock is three to five
copies of it, turned away from each other and started at different points in
the loop. One copy is four birds beating in step and showing the same
silhouette at the same moment, which is a formation; several are twelve to
twenty with no two doing the same thing, which is a flock. The circuit itself
is closed — net displacement over a loop is zero, on a ring 6 to 9 m across —
so the turning is what varies the profiles, not what stops the birds going
anywhere. They never went anywhere. A flock holds station while you sail past
it, and that parallax is why one can look like it is moving.

The sound is still entirely procedural. There are no audio assets.
