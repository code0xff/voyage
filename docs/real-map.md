# Sailing a map of a real place

The goal: a bounded region of a real coast, sailed freely, where the shape of
the land is genuinely that place rather than a suggestion of it.

Built. All three pieces below are done, and three regions are sailable from the
menu: San Francisco Bay, Newport and Merchant Row. What follows is the design
and the evidence behind it, updated as each piece lands rather than left as it
was first written.

The second and third regions were the real test of the machinery, and it
passed: each took a `Region` entry and a run of `scripts/fetch-terrain.ts`, and
not one line of engine, renderer or shader code. What they cost instead was
reconnaissance and measurement — see "Choosing where the square goes" below,
which is now the longest-earned section in this document.

---

## Why this is nearer than it looks

**The renderer is already decoupled from the island shape.** Island meshes
(`src/view/islands.ts`) and the chart's coastlines (`src/view/minimap.ts`) are
both built by *sampling* `terrain.elevationAt(x, y)`. Neither uses the circle
formula. The island list is only a work-list saying where to build a mesh.

So the physics asks the terrain one real question — `elevationAt` — and
everything downstream of it, including grounding, depth, the chart and the land
you can see, follows from that one function. Replacing what is behind it is
therefore a much smaller change than the shape of the code suggests.

**A bounded region is easier than the endless ocean, not harder.** No streaming
window, no `MAX_ACTIVE_ISLANDS` cap, no relevance ranking. The whole place is
known and finite.

---

## The three real pieces of work

### 1. A raster terrain — **done**

`elevationAt` becomes a bilinear sample of a heightmap rather than a loop over
circles.

Size: a 10 km radius at 25 m resolution is 800×800 samples. As 16-bit that is
about 1.3 MB — committable, and no network call, which the persistence decision
in AGENTS.md requires.

Built as `src/sim/heightfield.ts`, described by `src/sim/regions.ts` and baked
by `scripts/fetch-terrain.ts`. The estimate held: `public/terrain/sf-bay.bin` is
1.2 MB of int16 decimetres.

Two things the sketch did not say. The grid is projected UTM rather than lat/lon,
so it is square in metres by construction — which costs 0.35° of grid
convergence at San Francisco and buys a plane with no distortion inside it. And
sampling is defined *everywhere*, clamping outside the square, because the
physics reads it at 120 Hz and the renderer reads it to the horizon; `contains`
and `distanceOutside` are what the edge decision below will be built on.

Not yet wired into the engine — see piece 3.

### 2. A shelter model that is data rather than two formulas — **done**

This is the interesting one, and it comes out *better* than what exists.

Today `Terrain.waveShelter` is duplicated into GLSL by hand and the two must be
kept identical — the project's most-watched hazard, and the one a Codex review
has already caught diverging. The wake model behind it is written for a circle
with a downwind wake and does not generalise to a coastline: it would need
rethinking, not reshaping.

For a *fixed* region there is a better answer. Compute a fetch/shelter field on
the CPU once per change of wind direction, upload it as a texture, and have the
physics and the shader **read the same data**. The duplication disappears
entirely, and fetch — how far upwind the open water reaches — is both the honest
physical quantity and cheap to compute by marching a grid.

Built as `src/sim/shelter.ts`. Marching per cell would be 640,000 marches of
four hundred steps; ordering the cells so the upwind neighbour is always already
computed makes it one pass, and it costs **16 ms** — cheap enough to rebuild on
every 2° of wind shift.

The water shader now reads that field as a texture rather than recomputing the
circle model, so for a region the hand-copied GLSL is gone: the shader is not a
copy of the model, it samples the model's own output. The duplication survives
only for the procedural ocean, where there is no field and the islands are the
whole world.

Three things the sketch did not anticipate, all found by looking at the field
rather than at the code:

- **A ray must be shaded by the summit it crossed, not by the cell it left
  over.** Ground is lowest at the water's edge, so a ray over Alcatraz crosses
  39 m and exits over a 2.9 m beach — which turned a 500 m lee into a 100 m one,
  everywhere, while leaving it in the right *place*. This is the failure a
  coastline provokes that a circle never could.
- **The sweep needs lateral diffusion or it draws scan lines.** One tap per ray
  makes each ray independent and a 25 m pier throws a hard shadow three
  kilometres downwind. Averaging the cross-wind neighbours at every step *is*
  diffusion, and compounds into a wake widening as √distance — the right shape,
  for three reads instead of one.
- **Only amounts may diffuse.** Fetch and deficit are amounts. Reach is the
  decay length of whatever cast the shadow — a parameter — and averaging it
  sideways lends it between wakes, which let a 10 m islet borrow a 100 m ridge's
  lee from the water beside it.

Still not modelled: wake spreading beyond that diffusion, and refraction around
a headland. AGENTS.md section 9 already records the latter as deliberate.

### 3. A chunked terrain mesh — **done**

Land meshes are built per island today. A raster wants a tiled grid with the
sampling code that already exists behind it.

Built as `src/view/region-mesh.ts`, on the same terms as `islands.ts`: every
vertex comes from the `elevationAt` the physics grounds the boat on, and tiles
are built a couple per frame so a coastline arriving does not drop one. Two
filters keep it affordable — tiles with no land in them are measured once at
load and never considered again (about two thirds of San Francisco), and of
what remains only what is within drawing range is held.

The chart could not be tiled the same way. It traced a shoreline outward from
each island's centre at 36 bearings, which needs a centre and one radius per
bearing; Raccoon Strait would come out as a bite. It now samples the ground and
colours by what is under you, which is how a chart is actually made.

Two chart changes came with it, both forced by the scale. The ranges gained
2.5 km and 5 km, because a 20 km bay cannot be planned on a 1200 m chart where
the Gate is off the edge from the city front. And the chart can be dragged
around and enlarged, because a passage is planned by looking at water you have
not reached yet.

---

## The data, honestly

Coastline was expected to be the easy half and depth the hard one. In US waters
that turned out to be wrong, and in a useful direction.

| Source | Licence | Use |
|---|---|---|
| **NOAA NCEI CUDEM** | **US federal work, public domain** | **1/9 arc-second (~3.4 m) topobathymetry: land and sea floor as one surveyed surface. US coasts only. This is what is used.** |
| OpenStreetMap coastline | ODbL — attribution and share-alike on derived data | Usable; the obligation is real but ordinary |
| Copernicus / SRTM | Open | Land elevation |
| GSHHG | LGPL | ~100–200 m coastline, usable |
| Natural Earth | Public domain | 1:10M — kilometre-scale, useless at this scale |
| GEBCO | Open | ~450 m, useless close in |
| UKHO | Crown copyright | Not usable |

**Nearshore bathymetry is the problem everywhere CUDEM does not reach.** This
section used to conclude that the pragmatic answer was *a real coastline with
synthesised depths* — the shape genuinely the place, the depths a plausible
shelf, labelled as such. That compromise was not needed for San Francisco.
CUDEM covers the whole square, so both halves are surveyed: the shoal you can
see is the one you will touch, and the Golden Gate is 100 m deep because it is.

It remains the answer for anywhere outside US waters. A Korean or European
region would still be a real coastline over an invented shelf, and would have to
say so — the venues already carry that warning and it would still be true there.
`Region.source` and `Region.licence` exist so the claim on screen can be checked
rather than trusted.

What is baked, and how, is in `scripts/fetch-terrain.ts`; what the numbers mean
is in `src/sim/regions.ts`.

---

## The two decisions, as made

**The edge.** A fade, not a wall. `RegionTerrain` opens into deep water over
800 m past the survey; a test walks the boundary and holds the depth continuous
across it, because a step there is a cliff at a line drawn on nothing. It fades
to plain open sea rather than into the procedural islands — those are a
different world with its own seed, and stitching one to the other is a larger
question than the edge of the chart.

**Scale.** As sketched: 20 km square, about 1.8 hours across at 6 knots.

---

## Choosing where the square goes

Learned adding the second region, and the part that actually took the time. The
code was ready; knowing where to point it was not.

**The centre is the start line, not just the framing.** A region's centre is the
world origin and `placeAtStart` puts the boat 90 m from it, so the centre has to
be water she floats in — in every direction, because the offset is taken
downwind and the wind can be anywhere. Newport was first centred where the
square framed best, which put the origin on a two metre shoal for a boat drawing
1.8. `heightfield.test.ts` now holds every region to this, not just the two that
exist.

**Landmarks remembered are landmarks wrong.** Coordinates recalled from memory
came out one to three hundred metres off, which at a coastline is the wrong side
of the waterline: Castle Hill and Brenton Point both read as water. Test points
have to be found in the raster and named afterwards, not named and assumed. And
a lighthouse is a poor assertion in the first place — Castle Hill Light stands
on a rock at the water's edge, and the 25 m cell holding it correctly averages
to a metre below the surface. Assert island interiors and mid-channel water.

**Decide what the region is *for* by measuring, not by arguing.** Maine was
going to be Penobscot Bay proper, because the Camden Hills stand 398 m off the
water and a hill that size should make the biggest lee in the project. The
square was baked and its shelter field measured against the other two regions.
It came last — a mean wind deficit over water of 0.038 against Newport's 0.041
and San Francisco's 0.173 — and swept across every wind direction the place
plausibly gets it never beat 0.098. The hills are real; the bay is too open to
sit behind them, and at 21% land it has the least of any region here.

What did survive measurement was something the argument had not thought of: of
the water the boat can actually sail, the square 20 km east has 16% of it
within 200 m of a shore, against 8% and 9% elsewhere. So the region moved and
the claim changed to the one the data supported. Both numbers are now
regression tests — `region-terrain.test.ts` holds the pilotage property that
justifies the region existing, because a claim worth choosing on is a claim
worth locking down.

The general point: a region is chosen for a reason, the reason is a claim about
the water, and claims about the water can be computed from the raster in
seconds. Baking a candidate square costs four requests and a minute. Do that
before writing prose about what a place is like.

**Look at the whole square before baking it.** A coarse `exportImage` over the
20 km box, drawn as ASCII, answers "is this the shape of the place" for the cost
of one request — and the mosaic's `identify` endpoint names the source dataset
per point, which is how CUDEM coverage was confirmed at all four edges rather
than assumed from the table above. Rendering the already-baked SF raster the
same way, and getting a picture identical row for row, is what made the tool
trustworthy enough to choose on.

## What is still owed

**Tests for the renderer.** Two Codex reviews running have said the same thing:
there are none for the shader, the field texture or the mesh. Two of the three
P1 defects in this work were renderer defects — a triangle winding that faced
the land away from the sun, and a texture the shader read on a different
convention from the writer. Both were caught by hand, one by a screenshot and
one by working a cross product out on paper. A thin headless test over geometry
normals and the texture encoding would have caught both.

**Conditions are still a sketch, and say so.** `Region.conditions` carries the
prevailing breeze and the stream, and they are the broad character of the place
rather than a climatological mean or a tidal diamond. The land and the depths
are surveyed; those are not, and the two are labelled apart in the menu for
exactly that reason. A real tidal atlas is a piece of work in its own right.

**Only US waters.** CUDEM reaches no further, so a region anywhere else is back
to a real coastline over an invented shelf — see the table above.

This paragraph used to say the opposite of the one above it: that a region
brings no wind, tide or start time, that `Region` has no fields for it
deliberately, and that you sail a region in whatever the sliders say. That was
the plan, and it was reversed — `Region.conditions` exists, `withRegion` writes
it into the settings and `engine.ts` takes the wind direction from it — but the
paragraph stayed. The concern behind it was real and was answered differently:
the conditions are labelled apart from the survey rather than omitted, in the
menu and in `regions.ts`, so a sketched breeze never reads as a sounded depth.

---

## What carries over from the venue work

Kept: the tidal field, SOG and COG, the tide-aware readouts and chart arrows,
anchoring and the logbook, and the venue record itself (wind, stream, sea) —
which now lives on `Region.conditions`, labelled as the sketch it is.

Replaced: the venue's land, which was circles. **Done.** San Francisco was the
only venue and it is gone; two entries for one place, one of them a drawing of
the other, was a menu asking the player to choose between a chart and a sketch
of the same water. The `Venue` type survives with no entries, because it is
still the right answer for a coast with no open survey behind it.

The landmass grouping that lets circles form a coast is only needed while
circles remain, and they no longer do. It is still in `Terrain` for the
procedural ocean, which is built from circles and always will be.

Passages logged under the old `sf` id resolve forward to the region, so the
logbook does not forget where anyone has been.
