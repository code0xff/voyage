import type { QuestPack } from './quest';
import { QUEST_FORMAT } from './quest';

/**
 * The pack the game comes with, and the file it hands out as the example.
 *
 * A quest screen that opens empty teaches nobody what quests are, and "write
 * a JSON file first" is a wall in front of the one part of this game that
 * other people are meant to extend. So one small pack ships: six things a
 * beginner will do anyway, which is the point -- they complete while you are
 * learning to sail rather than asking you to go and do something.
 *
 * **Written here rather than fetched from `public/`,** for three reasons that
 * all matter. It exists with no network at all, which is the rule the rest of
 * the game keeps. It is typechecked against `QuestPack`, so the pack that is
 * held up as the example cannot quietly stop being a legal one. And the file
 * a player downloads is this object serialised, so the example and the thing
 * the game actually runs are the same bytes rather than two copies that
 * drift.
 *
 * **Installed like any other pack**, into the store, on the first run --
 * rather than being a permanent built-in the list treats differently.
 * A player who does not want it can remove it and it stays removed; one who
 * edits their downloaded copy and installs it back replaces this by its id,
 * which is what editing the example is for. The alternative -- a pack the
 * game always adds -- would have been a second kind of pack with its own
 * rules, in a feature whose whole premise is that every pack is a file.
 */
export const STARTER_PACK: QuestPack = {
  format: QUEST_FORMAT,
  id: 'first-miles',
  name: 'First miles',
  author: 'voyage',
  quests: [
    {
      id: 'first',
      name: { en: 'Her first passage', ko: '첫 항해' },
      note: {
        en: 'Weigh anchor, sail somewhere, and anchor again. That is a passage.',
        ko: '닻을 올리고, 어딘가로 항해하고, 다시 닻을 내리면 한 항해입니다.',
      },
      ask: { total: { facts: { passages: { atLeast: 1 } } } },
    },
    {
      id: 'fifty',
      name: { en: 'Fifty miles between anchors', ko: '한 항해에 50해리' },
      note: {
        en: 'Fifty nautical miles in one passage, without stopping.',
        ko: '한 번의 항해로 50해리. 도중에 멈추면 다시 셉니다.',
      },
      ask: { passage: { facts: { miles: { atLeast: 50 } } } },
    },
    {
      id: 'thousand',
      name: { en: 'A thousand miles in the book', ko: '누적 1,000해리' },
      note: {
        en: 'A thousand nautical miles altogether, over as many passages as it takes.',
        ko: '몇 번에 나누어도 좋습니다. 모두 합쳐 1,000해리.',
      },
      ask: { total: { facts: { miles: { atLeast: 1000 } } } },
    },
    {
      id: 'night',
      name: { en: 'Sailing after dark', ko: '해가 진 뒤의 항해' },
      note: {
        en: 'Under way between ten at night and three in the morning.',
        ko: '밤 10시에서 새벽 3시 사이에 항해 중.',
      },
      // Two ways of being in the small hours, which is what `any` is for: the
      // clock wraps and a single bound cannot cross midnight.
      ask: {
        any: [
          { now: { facts: { hour: { atLeast: 22 } } } },
          { now: { facts: { hour: { atMost: 3 } } } },
        ],
        now: { facts: { speed: { atLeast: 2 } } },
      },
    },
    {
      id: 'fog',
      name: { en: 'Sailing in fog', ko: '안개 속 항해' },
      note: {
        en: 'Under way with the visibility down. Wait for it, or set it in the conditions.',
        ko: '시정이 떨어진 채로 항해 중. 기다리거나, 조건 설정에서 안개를 고르세요.',
      },
      ask: { now: { weather: 'fog', facts: { speed: { atLeast: 2 } } } },
    },
    {
      id: 'close',
      name: { en: 'Close inshore', ko: '해안 가까이' },
      note: {
        en: 'Under way in less than fifteen metres of water. Watch the depth.',
        ko: '수심 15 m 미만에서 항해 중. 수심계를 보세요.',
      },
      ask: { now: { facts: { depth: { atMost: 15 }, speed: { atLeast: 2 } } } },
    },
  ],
};
