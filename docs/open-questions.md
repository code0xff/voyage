# Open questions

Known limitations. Each one records what was measured, so that nobody has to
find it out twice.

---

## The keel is broadside to the flow when she makes sternway

**Symptom.** In a flat calm with a 1 m/s stream she settles at **0.838 m/s** —
84% of the tide — and a boat with the way off her takes a long time to stop.

**Cause, and it is not the one this entry used to name.** `leeway` is
`atan2(v, u)`, so a boat moving backwards through the water reads ±180 degrees.
`FOIL_CD` is measured over 0–90 and `sample()` clamps above it, so the keel is
given **1.32 — the coefficient for water hitting it broadside** — when it is in
fact edge-on. Measured at the drift equilibrium, the fore-and-aft forces are:

| | N |
|---|---|
| windage | −3.29 |
| hull resistance | +1.41 |
| **keel** | **+56.68** |

`0.5·1025·0.162² × 3.2 m² × 1.32 = 56.8 N` — the arithmetic closes exactly, on
a keel slipping at 16 cm/s. It is seventeen times the windage that this entry
used to say was the only thing holding her back, and it, not the resistance
law, is what sets the 84%.

**The obvious fix does not work, and that is the finding.** Taking the angle
from the hull-frame components — `atan2(|v|, |u|)`, which folds sternway onto
zero by construction and cannot ask the table for anything outside its range —
is right on its own terms and identical for `u > 0`. It also breaks the boat:

| tried | result |
|---|---|
| fold the angle | drift 279%, polar pinned at 7.38 kn at every wind speed |
| fold, and key the lift on sideslip rather than leeway | the same |
| fold, and suppress lift entirely on sternway | the same |

All three fail the same way, so it is not the lift direction. Instrumented, the
reason is that the oversized keel term is *load-bearing*: remove it and windage
drives her backwards over the ground with nothing to arrest it, and she
accelerates to −3.8 m/s through the water before the hull-speed wall stops her
at 8500 N. **The 84% is two errors holding each other up** — a foil coefficient
read outside its domain, propping up a low-speed force balance that is not
otherwise well posed.

**What it would take.** The same deliberate physics project this entry always
called for, now with a diagnosis: a resistance curve, a foil model that is
honest at large flow angles and in reversed flow, and a low-speed balance that
stands without the accident above. Then `CRUISER` retuned until the polar comes
back to the table in the README.

The full investigation — how to reproduce it, the three fixes that fail, and one
force measurement that does not add up and should be settled before trying again
— is in [docs/keel-sternway.md](keel-sternway.md).

**Measured on the way, so nobody repeats it.** The ITTC-57 friction line with a
form factor — what this entry used to prescribe — does not fix either symptom.
On a surge-only model (no keel or rudder, which is why its baseline reads 77%
where the simulator reads 84%): drift goes 77.2% → 79.2%, the coast down to one
knot goes 134 s → **140 s, slightly worse**, and drag at 3 m/s falls 22%, which
costs a full retune. A linear damping term of 8 N/(m/s) does move both (83.5%,
120 s) for 5% more drag at 3 m/s, but it is a fudge at these Reynolds numbers.

**What it costs today.** The anchoring manoeuvre is slower than it should be.
Anything that gives her sternway — backing a jib, missing a tack, coming astern
off a berth — meets a keel with a hundred times the drag it should have.
Neither is visible while sailing forwards, which is why it lasted.

---

## Waves do not move with the water

The wave field is a function of world position and time. With a tide running it
stays put rather than being carried along, and the wake is a trail of ground
positions rather than something laid in the water and drifting with it.

This is a *simplification and not a divergence*, which is the distinction that
matters here: the physics and the water shader read the same field, so they
agree with each other. They agree on something slightly wrong.

Fixing it means offsetting the wave field by the integrated displacement of the
water — cheap in the physics, and a matching uniform in the shader, which
duplicates the wave formula. Worth doing when the shader is next opened.

Note that wind against tide *does* now raise the sea (the sea is built from the
wind relative to the moving water), so the most visible part of this is covered.

---

## No layline advice when a tide is running

The layline readout switches itself off with a stream running, and says so.

A layline is where the *ground* track fetches the mark, and the number behind
the readout is a still-water polar's best upwind angle, which cannot express
where a tide has moved it to. Silence beats a confident lie.

A tidal layline is a feature rather than a patch: it needs the polar solved for
ground-referenced VMG in a given stream, which is a different solve.

---

## The passage ghost

Racing had a ghost — your own best run, replayed alongside you. It was deleted
with the rest of the race machinery because it was built around a race clock.

It belongs on a passage, and is *better* there: a race course rotates with the
wind, so two runs of it were never the same course, while A to B on a chart
always is. The logbook already stores what would key it.

What it needs: a track recorded alongside the passage record (the accumulator
deliberately keeps only totals today), a store for it, and a rule for which run
is the one worth chasing.

---

## Local-first, with no sync

The logbook lives in this browser. Export to a file is the durability answer and
it is built, but nothing follows you to another device.

That is a decision rather than an omission — see AGENTS.md section 2 — and the
records are plain serialisable rows with stable ids so that a sync layer is a new
storage adapter rather than a migration. The cost that would be paid for it is
accounts, not a database.

---

## Islands do not bend the wind

Land blocks the wind and shelters the sea; it does not refract the breeze around
a headland or accelerate it through a gap. Parking in a lee is the dominant
effect by a wide margin, and this is documented in the README as deliberate.

It matters more for venues than it did for procedural islands, because real
places are known for exactly these effects. It is the single largest gap between
a venue and the place it is named after.
