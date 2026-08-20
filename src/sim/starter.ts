import { QUEST_FORMAT, type QuestPack } from './quest';

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
 * **Installed like any other pack**, into the store, on the first run, and
 * read by exactly the same code -- but it is the one pack that cannot be
 * removed. It is the worked example, and the quest screen is the only place
 * anyone finds out what a pack is; a player who deletes it has thrown away
 * the documentation along with the quests, and the game gives no hint that
 * the way back is Settings -> Quests -> Example file -> Install.
 *
 * Not removable is not the same as not replaceable, and the difference is the
 * whole point. Edit your downloaded copy, install it back, and it takes this
 * one's place by its id -- which is what editing the example is for. The slot
 * is permanent; what is in it is yours. Change the id instead and you get a
 * second pack, removable like every other.
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
      // A passage is not "she moved": it begins when she is pointed at
      // somewhere and completes when the anchor goes down there. The note
      // said weigh, sail, anchor -- which is a thing you can do all evening
      // without ever completing this.
      note: {
        en: 'Point her at somewhere on the chart, sail there, and let go the anchor.',
        ko: '해도에서 목적지를 정하고, 거기까지 항해해서, 그곳에 닻을 내리면 한 항해입니다.',
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
      // `atMost` includes its end, so fifteen metres exactly completes this.
      // Saying "less than" was a note that disagreed with its own quest.
      note: {
        en: 'Under way in fifteen metres of water or less. Watch the depth.',
        ko: '수심 15 m 이하에서 항해 중. 수심계를 보세요.',
      },
      ask: { now: { facts: { depth: { atMost: 15 }, speed: { atLeast: 2 } } } },
    },
  ],
};
