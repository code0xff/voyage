# Open questions

Known limitations. Each one records what was measured, so that nobody has to
find it out twice.

---

## Hull resistance is a single v² law, so the way comes off her slowly

**The part that was a bug is fixed:** the keel and the rudder were both being
given the broadside drag coefficient in sternway, because `leeway` reads 180
degrees and `FOIL_CD` stops at 90; the rudder's drag was taken off the surge
unconditionally; and its dynamic pressure came off a fabricated 0.3 m/s floor.
Those were what set the drift lag, not the resistance law.

**What replaced it is an approximation, not measured physics.** The tables are
forward-inflow data, and a blade meeting the water trailing edge first is a poor
foil by an amount nobody here knows. Reverse flow now reads the same
coefficients as forward flow. That is an assumption -- the honest case for it
is that a blade lying along the flow is not presenting the area a blade square
to it does -- and not a measurement.
See
[docs/keel-sternway.md](keel-sternway.md) and
[docs/keel-sternway-resolution.md](keel-sternway-resolution.md).

**What is left.** The way still comes off her slowly, and that part is the
resistance law: `0.5·ρ·S·Cf·v²` decays as 1/t, so the tail is long by
construction.

**Measured after the fix.** In a flat calm she now makes **80.0% of the tide at
every stream speed** — 0.25, 0.5, 1 and 2 m/s alike, once settled, which for the
weakest sets takes an hour rather than the fifteen minutes the stronger streams
need. It used to read 37%, 68%, 84% and 91%. Scale-free is what a balance between two quadratic drags has
to be, so the remaining lag is the honest consequence of windage against hull
drag rather than evidence of a broken term.

**What it would take, and what not to try.** A resistance *curve* — friction
with a form factor, plus residuary resistance as a function of Froude number —
and then `CRUISER` retuned until the polar comes back to the README table. The
ITTC-57 line on its own was measured and does not earn it. On a surge-only
model (no keel or rudder, which is why its baseline reads 77%): drift 77.2% →
79.2%, the coast down to one knot 134 s → **140 s, slightly worse**, and drag at
3 m/s down 22%, which costs a full retune for nothing. A linear damping term of
8 N/(m/s) moves both (83.5%, 120 s) for 5% more drag at 3 m/s, but it is a fudge
at these Reynolds numbers.

**What it costs today.** The anchoring manoeuvre is slower than it should be.
It is not visible while sailing.

---

## The wake does not move with the water

**The waves now do.** The field is a function of world position, so with a tide
running the pattern stayed pinned to the ground while the water it is made of
moved through it. The water's displacement is integrated and folded into each
component's phase, which is exact rather than an approximation: shifting the
sample point by `O` is the same thing as shifting the phase by `-k(D.O)`.

That turned out cheaper than this entry expected. It anticipated "a matching
uniform in the shader, which duplicates the wave formula"; in the event the
GLSL did not change at all, because it already takes a phase per component and
the view already copies it from the field. Both sides drift because they read
the same number, which is a better kind of agreement than two transcriptions
kept in step.

Asserted by the property that no other change could satisfy: a point carried
along with the stream sees exactly the sea it would see in still water, to nine
decimals, while a point fixed to the ground does not.

**The wake still does not.** It is a trail of ground positions rather than
something laid in the water and drifting with it, and it is a view concern
rather than a field one -- a separate change, and a smaller one now that the
water's displacement is already integrated where the renderer can reach it.

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
