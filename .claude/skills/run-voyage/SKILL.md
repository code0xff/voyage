---
name: run-voyage
description: Launch the voyage sailing simulator and drive it to a screenshot. Use when asked to run or start the app, to see a change working in the real app rather than in tests, or to check anything visual — sky, water, clouds, stars, lighting, weather, the HUD, or the instrument panel.
---

# Running voyage

Vitest and `npm run polar` cover the physics. What they cannot cover is
anything you have to *look* at, and this project has a lot of it: two
custom shaders, a sky dome, a HUD that bypasses React. Constants in GLSL
cannot be reasoned to the right value — they have to be seen.

## Start the dev server

```bash
npm run dev            # http://localhost:1852
timeout 40 bash -c 'until curl -sf http://localhost:1852 >/dev/null; do sleep 1; done'
```

**Check whether it is already up before starting one.** The port is fixed
at 1852 with `strictPort: true` (see `vite.config.ts` — it is one nautical
mile in metres), so a second server does not quietly pick another port, it
dies with `Port 1852 is already in use`. If something is already serving
there it is very likely the developer's own session with HMR live; use it
and do not kill it.

```bash
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:1852/   # 200 = use it
```

To stop one you started: `lsof -ti:1852 -sTCP:LISTEN | xargs -r kill`.

## Drive it

`chromium-cli` is not available here and the app is a WebGL canvas with no
DOM to assert against, so screenshots are the whole point. `shoot.mjs` in
this directory takes a JSON array of cases:

```bash
node .claude/skills/run-voyage/shoot.mjs '[
  {"label":"night","settings":{"startHour":23,"weatherMode":"clear"},"pitch":-300},
  {"label":"overcast","settings":{"startHour":13,"weatherMode":"overcast"},"pitch":-300}
]' /tmp/shots
```

Each case writes `<label>.png` (the window) and `<label>-sky.png` (a crop
of the sky, where anything small is actually legible). **Open them.** A
blank or black canvas is a failed launch, not a dark scene.

Playwright is not a project dependency and must not become one. Install it
somewhere outside the repo and run from there:

```bash
SCRATCH=…                     # your scratchpad, anywhere outside the repo
REPO=$(git rev-parse --show-toplevel)
(cd "$SCRATCH" && npm i playwright)
PLAYWRIGHT_HOME="$SCRATCH" node "$REPO/.claude/skills/run-voyage/shoot.mjs" '…' "$SCRATCH/shots"
```

`PLAYWRIGHT_HOME`, not `NODE_PATH`. The script lives in the repo and the
package does not, and ESM resolves from the importing file upwards — so it
never finds it. `NODE_PATH` looks like the fix and is not: it is a
CommonJS mechanism that ESM ignores, and it fails looking like a broken
install rather than like the wrong lookup. Absolute paths for the same
family of reason.

`shoot.mjs` finds a cached Chromium itself; it does not need
`npx playwright install` if one is already in `~/Library/Caches/ms-playwright`.

## Setting up conditions

Everything worth testing is a persisted setting, so the script seeds
`localStorage` under `voyage.settings.v2` before load rather than clicking
through the dialog. Anything in `Settings` (`src/settings.ts`) can go in
`settings`; the useful ones:

| key | for |
|---|---|
| `startHour` | 23 night, 18.6 sunset, 13 midday, 6.5 sunrise |
| `weatherMode` | `clear` `fair` `overcast` `rain` `squall` `fog` — pins it |
| `driftKnots`, `setDeg` | tide; SOG/COG and the layline guard only differ with one running |
| `windKnots`, `seaScale` | wind and sea |
| `islandCount` | 0 for open water, higher to get land in frame |
| `timeScale` | the script pins it to 0 so the shot is of the conditions asked for |

## Gotchas, all of them met in practice

- **The opening menu ignores Escape.** It wants a choice. Click **New
  voyage** — the one button that is always there. **Sail on** is offered
  only when a voyage was really begun, which a fresh browser context has
  not. `shoot.mjs` also pins `lang: 'en'`, because the button is found by
  its text and the text follows the language.
- **The camera starts looking at the horizon.** The sky is barely in
  frame. Drag it up with `pitch` — about `-300` puts the sky across the
  top half.
- **Headless has no GPU.** The launch args force SwiftShader; without
  them both shaders come back blank.
- **`/favicon.ico` 404s in dev.** It always has. `shoot.mjs` filters it
  so it does not read as a failure.
- **`timeScale: 0` still lets the boat sail.** It freezes the world clock
  — sun, weather, tide state — not the physics. The boat is under way in
  every shot, which is usually what you want.

## Checking a drift or a direction

A still frame cannot show which way anything is moving. Shoot the same
case twice an hour apart (`startHour: 13` and `14`) and compare — that is
how the cloud deck's downwind direction was confirmed, and it is the only
way to catch a sign error in something that only moves.
