# Sailing a map of a real place

The goal: a bounded region of a real coast, sailed freely, where the shape of
the land is genuinely that place rather than a suggestion of it.

Not built. This is the design and the evidence behind it, so the work can start
from here rather than from the beginning.

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

### 1. A raster terrain

`elevationAt` becomes a bilinear sample of a heightmap rather than a loop over
circles.

Size: a 10 km radius at 25 m resolution is 800×800 samples. As 16-bit that is
about 1.3 MB — committable, and no network call, which the persistence decision
in AGENTS.md requires.

### 2. A shelter model that is data rather than two formulas

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

### 3. A chunked terrain mesh

Land meshes are built per island today. A raster wants a tiled grid with the
sampling code that already exists behind it.

---

## The data, honestly

Coastline is the easy half and depth is the hard one.

| Source | Licence | Use |
|---|---|---|
| OpenStreetMap coastline | ODbL — attribution and share-alike on derived data | Usable; the obligation is real but ordinary |
| Copernicus / SRTM | Open | Land elevation |
| GSHHG | LGPL | ~100–200 m coastline, usable |
| Natural Earth | Public domain | 1:10M — kilometre-scale, useless at this scale |
| NOAA ENC | US federal work | Good bathymetry, US waters only |
| UKHO | Crown copyright | Not usable |

**Nearshore bathymetry is the problem.** GEBCO is about 450 m and useless close
in; good surveys are patchy and often licensed.

The pragmatic answer is **a real coastline with synthesised depths** — the shape
of the land is genuinely the place, the depths are a plausible shelf. That is
what carries the feeling of sailing somewhere, and it must be labelled as such,
exactly as the venues already are.

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
