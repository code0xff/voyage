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
| Rendering | Three.js, plus one custom GLSL shader for the water |
| Build / dev server | Vite |
| Tests | Vitest |
| Lint | ESLint (flat config) + typescript-eslint |
| Runtime | Browser; the physics core also runs headless under `tsx` |
| Persistence | `localStorage` only. No backend, no network calls |

**TypeScript stays on 5.x.** TypeScript 7 is out, but `typescript-eslint`
requires `<6.1.0`, and lint must work. Do not bump it until the lint tooling
supports it.

## 3. The one architectural rule

**`src/sim/` must never import from `src/view/`, from `three`, or from any
browser API.**

The physics core is pure, deterministic and headless. This is not an aesthetic
preference, it is what makes the project debuggable:

- `npm run polar` solves 37 steady-state sailing angles in under a second, with
  no browser involved
- the test suite drives the boat and the race rules directly
- every serious bug found in this project so far was caught this way and would
  have been invisible while flying the boat around

Anything that reads from the DOM, `window`, `localStorage`, or Three.js belongs
in `src/view/`, `src/main.ts` or `src/settings.ts`.

Corollary: where the renderer and the physics must agree (the wind field, the
wave surface), they call **the same function** or use **the same formula**. A
puff drawn in a different place from the puff the boat feels is a lie the player
will eventually notice.

## 4. Development methodology

Every non-trivial change follows the same three phases.

### Plan

State what will change and why before writing code. For anything touching the
physics, say which polar or test result you expect to move, and in which
direction. If you cannot predict the direction, you do not understand the change
well enough to make it yet.

### Implement

Small, coherent commits. Match the surrounding style: the codebase explains
*why* a value or an approach was chosen, not what the line does.

Comments carry the reasoning that is not recoverable from the code — why the
righting moment is referenced to the water surface normal, why swept angle is
the wrong way to judge a mark rounding. Keep writing them that way.

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
- **things the renderer and the physics could disagree about.**

State plainly what you verified and what you did not. Do not report a clean pass
you did not actually run.

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

- `main` is the stable branch. Do not commit to it directly.
- Work on `dev` or a feature branch off it.
- Write commit messages that say what changed and why the change is right.
- Never commit `node_modules/`, `dist/`, or anything derived.

## 7. Testing guidance

Tests live next to the code as `*.test.ts` and cover the **physics core and the
rules**, not the renderer.

The tests that matter here assert *behavioural properties*, not exact numbers:

- the boat cannot sail into the no-go zone
- best upwind VMG lands between 40 and 50 degrees true wind angle
- top speed happens on a reach, not dead downwind
- the wind field is a deterministic function of position and time
- reefing the main moves the centre of effort forward

Exact-value assertions on a tuned physical model are brittle and will fight
every legitimate tuning change. Assert the property that must hold.

**When you fix a bug, add the regression test.** Several tests in this repo are
labelled with the bug they lock down; follow that pattern.

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
opponents, no current, no main/jib slot interaction, no collision.
