# Open questions

Known limitations. Each one records what was measured, so that nobody has to
find it out twice.

---

## Hull resistance is a single v² law, so she never quite stops

**Symptom.** A boat with the way off her takes a long time to come to rest, and
in a calm she drifts at less than the rate of the tide.

**Measured.**

- Under bare poles, rounded up head to wind from 2.5 m/s, she reaches 0.47 m/s
  at forty seconds and about 0.35 at forty-five, having sailed some 30 m.
- Lying in a flat calm with a 1 m/s stream, she settles at **0.84 m/s** — 84% of
  the tide. A real yacht makes very nearly all of it.

**Cause.** `resistance = 0.5·ρ·S·Cf·v²` is the whole of it. A pure v² law decays
as 1/t, so the tail is long by construction, and the equilibrium in the calm is
wherever that term balances windage rather than where a real hull would sit.

**Why it is not fixed.** `Cf = 0.0042` is described as a friction coefficient
and is in practice an *effective total resistance* coefficient, tuned until the
polar matched a real yacht. Adding the standard ITTC form factor `(1+k)` on top
double-counts and slows the boat everywhere.

A linear damping term was sized instead, to bite at low speed and vanish at
sailing speed. It cannot do both. At 3 m/s the v² term is about 484 N; a linear
term small enough to be 1% of that is 1.6 N/(m/s), which contributes 0.3 N at
0.2 m/s and changes nothing. One large enough to actually stop her at low speed
is around 20 N/(m/s), which is 12% of the drag at 3 m/s and moves the polar.

**What it would take.** A resistance *curve* rather than one coefficient —
friction with a form factor, plus residuary resistance as a function of Froude
number — and then `CRUISER` retuned until the polar comes back to the table in
the README. That is a deliberate physics project with a measurable outcome, not
something to slip into another change.

**What it costs today.** The anchoring manoeuvre is slower than it should be,
which is survivable now that the sails can be handed. The calm drift is 16% shy.
Neither is visible while actually sailing.

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
