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

## The sea moves with the water; the tide does not turn

**Done, and removed from this list as a defect.** The wave field is carried by
the water's integrated displacement, folded into each component's phase, and
the wake is laid in the water with it -- kept in the water's frame and
translated by the same offset the sea uses, so the two cannot come apart.

The identity is exact: shifting the sample point by `O` is the same thing as
shifting the phase by `-k(D.O)`. The approximation is that the field is given
one vector, the deep-water set, so where depth throttles the stream the sea
drifts a little faster than the water it is in.

It cost no shader change at all. The GLSL already takes a phase per component
and the view already copies it from the field, so both sides drift because they
read the same number.

**The stream turns now.** `driftKnots` is its rate at full run rather than a
constant: it dies to slack about three hours in, runs back the other way, and
returns, on a 12.42-hour semi-diurnal cycle the player can lengthen, shorten or
switch off. A cosine rather than a square wave, because what a tide does to a
passage is the *slack* -- half an hour either side of the turn is a quarter of
the stream, an hour either side a half -- and a stream you can only fight is
not tidal tactics.

It is a function of the world hour and holds no state, which is deliberate:
three separate bugs in this project have been a clock that survived a restart,
and a tide that cannot hold a clock cannot join them. Every consumer follows
from the one vector, so the boat's drift, the chart's arrows, the sea built
from the wind over moving water, and the displacement carrying the waves and
the wake all turn together without being told.

**What is still missing is the height.** No springs and neaps, no depth that
changes with the tide, and no gate that opens and shuts. That one is not a
phase term: a falling tide has to decide what happens to a boat anchored over
a bank, and what the chart's soundings are measured from. It is a rules
decision before it is code.

---

## There is no layline advice at all

**This entry described a readout that no longer exists.** The layline was part
of the racing machinery and went with it in "feat: remove racing, which passage
making has replaced". Nothing turns itself off with a tide except the polar
card's live marker, and that one is right to: the curve is a still-water polar,
so with a tide under her the gap between the marker and the curve stops meaning
"how much you are leaving out there".

What is true, and is why nobody has rebuilt it: on a passage the useful number
is already there. `courseToSteer` is the classic tidal calculation -- what to
steer so the stream sets her *onto* the line rather than off it -- and it is
computed with the tide rather than in spite of it.

A tidal layline would still be a feature, and a real one: it needs the polar
solved for ground-referenced VMG in a given stream, which is a different solve
from the still-water one. It has no consumer today.

Corrected on the way past: the "dead upwind" advice used a fixed 40 degrees for
her closest approach to the wind. The polar says the boundary -- the first angle
whose VMG is positive -- runs from 20 degrees in a drifter through 25 in the
middle of the range to 60 in a gale, so a constant called marks unlayable
through most of the range and layable at the top of it. It asks the polar now,
and says nothing at all while the polar has not solved: a wrong number here is
advice to tack away from somewhere she could have laid.

Not `bestUpwind` either, which was the first attempt. That is where she works to
windward *best*, 45 degrees at twelve knots, while she is still gaining at 25 --
two different curves, and only one of them is what no-go means.

---

## The passage ghost, which is not wanted

Racing had a ghost -- your own best run, replayed alongside you -- and it went
with the rest of the race machinery. This entry used to argue that it belonged
on a passage instead, and set out what it would need: a track recorded beside
the passage record, somewhere to keep it, and a rule for which run to chase.

**Asked, and the answer was no.** It is not being built, and this is a decision
rather than a thing waiting for someone. It is recorded here so that the
argument is not made a third time.

The reason it is easy to keep making: the logbook already stores what would key
it, so it *looks* cheap. It is not. It touches the track recording, the storage
schema and its export version, the loop, the renderer and the panel -- and at
the end of it the game has something to chase, which is the one thing
`AGENTS.md` says this game does not have.

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
