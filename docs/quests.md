# Quests

A quest pack is a JSON file of things worth doing. Anyone can write one, and
installing one is how a player adds content to this game. That is the part of
the project a community can actually make: nobody is going to contribute a
hull model, and everybody has an opinion about what is worth sailing to.

This document is the design and the format. It is written before the UI on
purpose — once other people's files exist, the format is the one thing that
cannot be changed cheaply.

## What a quest is, and is not

**Not a mission.** There is no accepting one, no failing one and no clock. A
quest describes something that would have been worth doing, and it completes
when the game observes that it was done. Playing is the only way to make
progress, and there is never a wrong thing to be carrying.

That is also what makes a stranger's pack safe: it can only ever *notice*.

**Data, never code.** A quest carrying an expression — a formula, a predicate,
a script — would mean that installing someone's file runs their program in
your browser. So the vocabulary is closed: named facts, two bounds, a few
combinators, and nothing else. Nothing in a pack is ever evaluated as code.

A pack naming something this build does not know is **refused when it is
installed**, with the name of the thing it wanted. Unknown fields are refused
rather than ignored: ignoring them is how a pack written for a later build
half-works — some quests completing and some quietly unreachable — and
half-working is worse than refused for a thing whose whole job is to be
trusted.

## Watched while sailing, not read out of the logbook

The first design read the logbook and asked what the passages added up to.
That is cheap and wrong, and the reason is worth writing down: **a logbook
entry is a summary.** It knows where a passage began and ended and how far it
went, and it cannot know that she passed within twenty miles of Cape Horn on
the way, or that the tack that saved her was made in thirty knots. Every
interesting quest is about something that happened *during* a passage.

So quests are watched. Every `WATCH_EVERY` seconds of sailing the engine
takes a small sample of the world — where she is, what the wind is doing,
what she has done since the last sample — and hands it to a pure function
along with the tallies so far. Nothing about the boat is stored to make this
work; the watcher keeps its own counts.

**The cost, stated plainly.** Because a moment is only true while it is
happening, a completed quest has to be *recorded*: once she has sailed on,
nothing proves she was ever there. So quest progress is stored, unlike the
achievements sketch that preceded this, which was a pure function of the
logbook and therefore lost nothing when a passage was deleted. Here, deleting
a passage does not un-complete a quest — because the quest was never watching
the passage. That is a real trade and it is the price of being able to ask
about anything that is not a summary.

## Scopes

Every condition names when it is measured.

| scope | means | reset |
|---|---|---|
| `now` | true at this instant | — |
| `passage` | accumulated since the current passage began | when a passage begins |
| `total` | accumulated over every passage ever sailed | never |

A quest completes the moment its whole `ask` holds. `now` conditions and
`passage` conditions in one ask must therefore hold *at the same sample* —
which is what lets a quest say "a hundred miles into this passage, and
standing in past the Horn".

## Facts

### `now`

| fact | unit |
|---|---|
| `wind` | knots, the true wind she is in |
| `heel` | degrees, unsigned |
| `sea` | metres, significant wave height |
| `speed` | knots over the ground |
| `depth` | metres under the keel |
| `hour` | 0–24, the world clock |
| `latitude`, `longitude` | degrees |
| `south`, `north` | degrees; how far she is that way |

and these, which are not numbers:

| ask | means |
|---|---|
| `near: { lat, lon, within }` | within `within` nautical miles of that place |
| `belt` | the wind belt she is in now |
| `weather` | the weather now |
| `region` | the world she is sailing: a region id, or `""` for the island field |

### `passage` and `total`

| fact | unit |
|---|---|
| `miles` | nautical miles sailed |
| `hours` | hours sailed |
| `whales`, `sharks` | encounters seen |
| `photographs` | taken |
| `belts` | how many distinct wind belts have been sailed through |
| `passages` | completed passages (`total` only) |

`belts` is the one the summary could never give: the watcher notes each belt
as she enters it, so a passage from seventy north to seventy south counts all
five.

## Combining

Everything inside one scope is **and**. To say **or**, use `any`:

```json
{ "ask": { "any": [
  { "now": { "weather": "fog" } },
  { "now": { "weather": "squall" } }
] } }
```

`any` may hold whole asks, so either branch can carry its own scopes.

## A pack

```json
{
  "format": 2,
  "id": "southern-ocean",
  "name": "The Southern Ocean",
  "author": "someone",
  "quests": [
    {
      "id": "horn",
      "name": { "en": "Round the Horn", "ko": "혼곶을 돌다" },
      "note": { "en": "Pass within fifty miles of Cape Horn." },
      "ask": { "now": { "near": { "lat": -55.98, "lon": -67.27, "within": 50 } } }
    },
    {
      "id": "long-southern-leg",
      "name": { "en": "A hundred miles below forty south" },
      "ask": {
        "now": { "facts": { "south": { "atLeast": 40 } } },
        "passage": { "facts": { "miles": { "atLeast": 100 } } }
      }
    }
  ]
}
```

`name` needs an `en`; every other language is optional and falls back to it.

## What is deliberately not in it

- **No rewards.** Completing a quest gives nothing but the fact of it. A game
  that pays you to sail badly is a game that teaches sailing badly, and there
  is nothing to pay with that would not do that.
- **No ordering.** A quest cannot ask for one thing *then* another. Two
  quests say it more clearly than a sequence would.
- **No world pinning.** A quest does not set the wind or the seed. Comparing
  times between players would need it; nobody asked for that, and pinning
  would mean a pack could quietly take the settings away from the player.
- **No live position sharing, no server.** Packs are files.
