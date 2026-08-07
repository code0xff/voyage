# Sailing a map of a real place

The goal: a bounded region of a real coast, sailed freely, where the shape of
the land is genuinely that place rather than a suggestion of it.

Partly built. Piece 1 below is done and San Francisco Bay is baked; pieces 2 and
3 are not. What follows is the design and the evidence behind it, updated as
each piece lands rather than left as it was first written.

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

### 2. A shelter model that is data rather than two formulas — next

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

### 3. A chunked terrain mesh — not started

Land meshes are built per island today. A raster wants a tiled grid with the
sampling code that already exists behind it.

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

## Two decisions to make

**What happens at the edge of the circle.** An invisible wall, or a fade into
the existing procedural ocean. The second is recommended: the machinery exists,
and sailing out of the surveyed area into open sea is what actually happens.

**Scale.** A 10 km radius crossed at 6 knots is about 1.8 hours of real time, or
two minutes at the default time scale. That is a passage rather than a pond.

---

## What carries over from the venue work

Kept: the tidal field, SOG and COG, the tide-aware readouts and chart arrows,
anchoring and the logbook, and the venue record itself (wind, stream, sea).

Replaced: the venue's land, which is circles today. The landmass grouping that
lets circles form a coast is only needed while circles remain.
