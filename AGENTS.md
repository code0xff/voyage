# AGENTS.md

Ground rules for any coding agent working on this repository. Read this before
touching anything.

`CLAUDE.md` is a symlink to this file; there is only one source of truth.

---

## 1. What this project is

`voyage` is a browser sailing simulator. It is a **physics project with a game
attached**, not the other way round. The value is in the numbers being right:
apparent wind, sail lift and induced drag, keel side force, wave-making
resistance, added resistance in waves, and a proper 6-DOF hull response.

If a change makes the game more fun but the physics wrong, it is a bad change.

## 2. Stack

| | |
|---|---|
| Language | TypeScript (strict), ES modules |
| 3D | Three.js, plus custom GLSL shaders for the water and sky |
| UI | React 19 + TailwindCSS 3 + shadcn/ui primitives, lucide icons |
| Build / dev server | Vite |
| Tests | Vitest |
| Lint | ESLint (flat config) + typescript-eslint |
| Runtime | Browser; the physics core also runs headless under `tsx` |
| Persistence | local-first in the browser. No backend *yet* — see below |

**TypeScript stays on 5.x.** TypeScript 7 is out, but `typescript-eslint`
requires `<6.1.0`, and lint must work. Do not bump it until the lint tooling
supports it.

**Persistence is local-first, and that is a decision rather than a limit.**
The original rule here said "localStorage only, no backend, no network calls".
It arrived in the first commit with no reasoning recorded anywhere, and it was
never a trade-off anyone weighed — it was the shape a one-session scaffold takes
when the only things to store are a settings object, one ghost and one best
time. Treated as a rule afterwards, it very nearly decided the logbook too.

What was decided, deliberately: **the browser holds the source of truth, and a
server may be added later to sync it.** The reasons are the ones that survive
scrutiny — the game works with no network at all and should keep doing so, a
calm sailing game should not open with a login screen, and there is no
deployment to speak of yet (`vite.config.ts` allows a Cloudflare quick tunnel
because that is currently how it gets shown to anyone else).

What that obliges. Records are **plain serialisable rows with a stable id and a
timestamp**, so that adding a sync layer later is a new storage adapter and not
a migration. Storage goes behind an interface for the same reason. And anything
that accumulates — the logbook above all — uses IndexedDB rather than
localStorage, which is a few megabytes and already straining: `src/sim/replay.ts`
packs the ghost into a flat `Float32Array` and rounds every value to two decimals
specifically to make one recording fit.

The one thing local-first cannot do is follow you to another device. If that is
ever wanted it needs accounts, and accounts are the real cost — not the database.

**Tailwind stays on v3.** The theme and `tailwind.config.js` come from a shared
design system that is written against v3.

The design system lives in `src/components/ui/`, `src/lib/` and `src/index.css`
and is generated, not hand-written. It is excluded from lint for that reason.
Extend it with `cva` variants rather than editing the primitives, use the
semantic tokens (`bg-card`, `text-muted-foreground`, `success`/`warning`/`info`)
and never hard-code a colour. Default text is `text-xs`, controls are `h-8`.

## 3. The one architectural rule

**`src/sim/` must never import from `src/view/`, from `three`, from React, or
from any browser API.**

The physics core is pure, deterministic and headless. This is not an aesthetic
preference, it is what makes the project debuggable:

- `npm run polar` solves 37 steady-state sailing angles in under a second, with
  no browser involved
- the test suite drives the boat and the race rules directly
- every serious bug found in this project so far was caught this way and would
  have been invisible while flying the boat around

Anything that reads from the DOM, `window`, `localStorage`, Three.js or React
belongs in `src/view/`, `src/ui/`, `src/engine.ts` or `src/settings.ts`.

Corollary: where the renderer and the physics must agree — the wind field, the
wave surface, the land shadow, the depth used for grounding — they call **the
same function** or use **the same formula**. The water shader recomputes
`Terrain.waveShelter()` in GLSL for exactly this reason. A puff drawn in a
different place from the puff the boat feels is a lie the player will eventually
notice.

### The UI is React, the loop is not

`src/engine.ts` owns the 120 Hz physics loop and the render loop, and publishes
one mutable `Snapshot`. React renders structure and rarely-changing state only
(menus, results, settings).

**Anything that updates every frame must bypass React.** Use `useReadout` /
`useEngineFrame` from `src/ui/engine-context.tsx` to write into a DOM node you
own. Pushing a dozen instrument readings through the reconciler at 60 Hz burns
frame budget for nothing, and it is the single easiest way to make this project
feel bad.

## 4. Development methodology

Every non-trivial change follows the same phases, in order: **plan → implement →
self-review → external review**. Genuinely trivial changes — a rename, a
comment, a one-line fix — may skip the plan and go straight to implementing.
Nothing else may.

### Plan

State what will change and why before writing code. For anything touching the
physics, say which polar or test result you expect to move, and in which
direction. If you cannot predict the direction, you do not understand the change
well enough to make it yet.

When a feature touches both the world and the screen (weather, time of day,
land), build and test the simulation side first. Building the UI around a
half-finished model means building it twice.

### Implement

Small, coherent commits. Match the surrounding style: the codebase explains
*why* a value or an approach was chosen, not what the line does.

Comments carry the reasoning that is not recoverable from the code — why the
righting moment is referenced to the water surface normal, why swept angle is
the wrong way to judge a mark rounding. Keep writing them that way.

**Read `src/sim/math.ts` before writing a helper.** Clamping, `lerp`,
`smoothstep`, `approach` — the first-order lag every fade and every eased
transition in this project wants — and the vector and angle helpers are all
there, and have been since the first commit. Three local copies were written
anyway, in `weather.ts`, `whale.ts` and `orbit.ts`, and two more were caught and
removed one at a time before anyone noticed it was a pattern. `src/view/` may
import from `src/sim/` freely; only the other direction is forbidden.

This costs more than tidiness. `weather.ts` had reimplemented `approach` without
its `Math.max(tau, 1e-6)` guard, so the copy was the original minus a
protection someone had already thought to add — which is the general shape of
the damage: a copy inherits the formula and not the corrections.

### Fix what you find on the way

If you notice documentation that has gone out of date, a refactor worth making
or a bug, fix it in the same session rather than filing it. This project's value
is that its claims are true — the README carries measured numbers and the
comments carry reasoning — so a stale claim is a defect in the thing itself.

**In its own commit, though.** Permission to fix is not permission to bundle:
the rule below about refactors never riding along in a feature commit still
holds, and a bug fix still owes a regression test.

### Self-review to a clean pass

After implementing, review your own diff as if someone else wrote it, and keep
fixing until a full pass finds nothing. Look for:

- **sign errors** — this project is full of them by nature. Every angle,
  moment and force has a sign convention (see `src/sim/math.ts`: positive means
  starboard). Check each new one against the convention explicitly.
- **dimensional consistency** — hydrodynamic moments scale with `v²`. A single
  term left at `v¹` once made the boat unsteerable at low speed.
- **edge cases at zero** — a position exactly on a line, zero speed, zero sail
  area, an empty ghost recording. One of these silently killed all race judging.
- **things the renderer and the physics could disagree about** — especially any
  formula duplicated into GLSL.
- **per-frame work that accidentally went through React.**

State plainly what you verified and what you did not. Do not report a clean pass
you did not actually run.

### Then have someone else review it

A clean self-review is not the last step. Hand the branch range to an external
reviewer — the Codex subagent is what this project uses — and work through what
it reports.

It has earned the step. Every run so far has found something real that a clean
self-review had already passed over: a formula that agreed in TypeScript and
disagreed in GLSL, a setting that silently did not rebuild the world, a README
claim that had gone stale under a feature built on top of it.

Two rules for reading the results. **Verify each finding yourself before acting
on it** — reviews have overstated things as well as caught them, and a finding
you cannot reproduce is not a finding. And **run the tests and the polar
locally**: a sandboxed reviewer often cannot, and will say so, and that half of
the verification is then still yours.

## 5. Verification before pushing

**Run `npm run verify` and get a clean result before every push. No exceptions.**

```bash
npm run verify     # typecheck + lint + test
```

Individually:

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run test       # vitest run
npm run build      # typecheck + production build
```

For physics changes, also run and read:

```bash
npm run polar -- 6 12 25 35
```

and check the result still matches the table in `README.md`. If it moved, either
the change was wrong or the table needs updating — decide which, deliberately,
and say so.

Do not push failing or unverified work. Do not disable a lint rule or delete a
test to make the suite pass; fix the cause.

## 6. Branching and commits

**`dev` is the default branch, and until the project actually launches it is the
only one.** There is deliberately no `main`: a stable branch that nothing is ever
released from is ceremony, and keeping two branches in step costs attention a
pre-launch project should be spending elsewhere.

- Work on `dev`, or on a short-lived branch merged straight back into it.
- Cut a release branch when there is something to release, not before.
- Never commit `node_modules/`, `dist/`, or anything derived.
- History on `dev` may be rewritten while this is pre-launch and single-author.
  The moment anyone else is pulling it, that stops.

### One commit per implemented feature

**A commit is one working feature, not a session's worth of work.**

Each commit must stand on its own: it builds, `npm run verify` is clean, and the
thing it claims to add actually works at that commit. If a reviewer would have to
read four unrelated subsystems to understand one commit, it should have been four
commits.

Split by capability, not by file. "Islands", "time of day" and "weather" are
three features even though they were built in one sitting and touch some of the
same files; bundling them means neither can be reverted, bisected or reviewed
alone. Do not do what the second commit in this repository's history did.

Refactors and formatting go in their own commits, never mixed into a feature
commit — a diff that both moves code and changes behaviour hides the behaviour
change.

### Commit message format

    type: short summary in the imperative

Optionally with a scope, when it usefully narrows things down:

    type(scope): short summary in the imperative

| type | use for |
|---|---|
| `feat` | a new capability for the player or the developer |
| `fix` | corrects behaviour that was wrong |
| `perf` | same behaviour, measurably faster |
| `refactor` | same behaviour, different structure |
| `test` | tests only |
| `docs` | documentation or comments only |
| `build` | dependencies, build config, tooling |
| `chore` | anything that fits none of the above |

Scopes are the areas of the repo: `sim`, `view`, `ui`, `race`, `engine`, `deps`.

Rules for the subject line:

- imperative mood, as if completing "this commit will …" — `add`, not `added`
- lowercase after the colon, no trailing full stop
- 72 characters or fewer
- say what changed, not which files changed

The body is where the reasoning goes: **why this change is right**, what was
considered and rejected, and any consequence that is not obvious from the diff.
Physics changes must say which polar or test result moved and in which direction.
If self-review caught something, say what.

Examples:

    feat(sim): add island wind shadow and grounding
    fix(race): stop storing a zero line-side, which killed all crossing detection
    perf(ui): write instrument readouts to the DOM instead of through React
    refactor(view): split the scene into water, sky and island modules
    build(deps): pin TypeScript to 5.x so typescript-eslint keeps working

## 7. Testing guidance

Tests live next to the code as `*.test.ts` and cover the **physics core and the
rules**. The renderer is verified by looking at it -- that is what the
`run-voyage` skill is for, and no assertion is going to tell you the water
reads as water.

**With one exception, which is signs.** `src/view/eye.test.ts` and
`src/view/creature.test.ts` exist because the camera's response to a drag and
the attitude of a body on a wave are not matters of appearance: they are a
handful of signs, and signs are what this project gets wrong most often. Both
were wrong, both survived screenshots and review, and both were eventually
reported by someone using it rather than caught. If a renderer change is a sign
or a convention, it can be asserted and should be. If it is a look, it cannot.

Two things those two files learned the hard way, and neither is optional:

- **Assert against the world, not against other code.** `creature.test.ts` first
  asserted that an animal was posed exactly as the boat is posed. It passed, and
  both were wrong -- the boat's own use of the wave slope had a sign error, so
  the test had blessed a bug rather than caught one. It now puts a body on a
  plane of known slope and checks its up against the analytic surface normal,
  which no convention can argue with.
- **Test the code, not a restatement of the rule.** A test that re-derives the
  answer beside the implementation only proves the two agree. Drive the real
  function.

The tests that matter here assert *behavioural properties*, not exact numbers:

- the boat cannot sail into the no-go zone
- best upwind VMG lands between 40 and 50 degrees true wind angle
- top speed happens on a reach, not dead downwind
- the wind field is a deterministic function of position and time
- reefing the main moves the centre of effort forward

Exact-value assertions on a tuned physical model are brittle and will fight
every legitimate tuning change. Assert the property that must hold.

**A duration the test has to outlast must be imported, not written out.** This
has gone wrong twice — the shark's dive and the gull flock's stay were both
retuned, and both tests carried on passing while quietly measuring nothing,
because a loop that runs for a hardcoded 8 seconds stops covering an encounter
the moment the encounter becomes 18. Export the constant and derive the bound
from it, the way `wildlife.test.ts` now does with `FLOCK_DURATION_MIN/MAX`. The
test then survives the retuning and still catches the fade being deleted.

**The opposite holds for a number that is itself the property.** `sharks.test.ts`
asserts a shark is never in less than 8 m of water and `whales.test.ts` that a
whale stays 120 m off a shore. Importing `MIN_DEPTH` there would turn a safety
assertion into `depth >= theDepthLimit`, which is true whatever the limit is set
to, including zero. Write those out. The distinction is whether the constant is
a *precondition the test needs in order to look at anything* or the *claim being
made*.

**When you fix a bug, add the regression test.** Several tests in this repo are
labelled with the bug they lock down; follow that pattern.

**And check that it fails without the fix.** This is not a formality. Three
tests written in one recent session passed with their fix removed -- one drove
the boat at a whale it could not physically reach, one used a seed that never
produced the encounter it was asserting about, and one is described above. A
test you have not seen fail is a test you have not written.

## 8. Tuning the boat

All boat performance lives in `CRUISER` in `src/sim/config.ts`; the coefficient
curves live in `src/sim/tables.ts`. Player-facing conditions (wind, sea, course)
live in `src/settings.ts` and are deliberately kept apart — mixing them would
mean the boat's performance changed whenever a setting moved, and the polar
would stop meaning anything.

The loop is:

1. change one number
2. `npm run polar` and see which way the diagram moved
3. compare against a real yacht polar
4. only then start the dev server and check how it feels

## 9. Things deliberately not done

Do not "fix" these without being asked; they are known, intentional
simplifications documented in the README: no spinnaker, no surfing, no AI
opponents, no main/jib slot interaction, no boat-to-boat collision, and no
tide.

There *is* a current -- `sim/current.ts`, and a set and drift the boat feels --
which this list denied for a while after it was built. What is missing is the
tide: the stream varies with depth but not with time.

The whales and the sharks belong here too. They are sightings and not bodies:
no force, no collision, and a whale gives way to a boat sailing a course but
cannot outrun one that is chasing it. See the README for why that is the right
place to stop.

Two more that look like bugs but are not:

- **The sun is not astronomical.** Elevation is a sine between fixed sunrise and
  sunset hours. A real ephemeris would change nothing a helmsman notices.
- **Islands only shadow wind and waves; they do not bend the wind around
  headlands.** Parking in a lee is the dominant effect by a wide margin, and
  refraction would cost far more than it is worth.
