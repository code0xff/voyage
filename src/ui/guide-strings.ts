import type { Phrase } from '@/i18n';

/**
 * The sailing guide, in both languages.
 *
 * One string per sentence, with `**bold**` and `[[key]]` markers that a
 * translation is free to move: Korean puts the verb last, so a guide that had
 * been assembled out of JSX fragments in English word order would have forced
 * every Korean sentence to be built backwards or rewritten into a different
 * sentence. See `Rich` in `i18n.tsx`.
 *
 * Every figure in here is this boat's, measured with `npm run polar`, and the
 * two languages have to keep quoting the same ones -- a translation that
 * rounded 27 degrees of heel to "about 30" would make the Korean guide say
 * something the simulator does not do.
 */

export interface GuideSection {
  title: Phrase;
  paragraphs: Phrase[];
}

export const GUIDE_WARNING: Phrase = {
  en: '**A boat cannot sail at the wind.** Head straight at it and she stops. There is no wall — she comes to a stand gradually — but everything else below follows from it.',
  ko: '**배는 바람을 향해 나아갈 수 없습니다.** 정면으로 향하면 멈춥니다. 딱 잘린 경계는 없고 서서히 서지만, 아래의 나머지 전부가 이 사실에서 나옵니다.',
};

export const GUIDE: GuideSection[] = [
  {
    title: { en: 'Going upwind', ko: '맞바람 거슬러 가기' },
    paragraphs: [
      {
        en: 'You cannot go straight there, so you zig-zag: sail as close to the wind as she will go, then turn through it and do the same on the other side. Each turn is a **tack**.',
        ko: '곧장 갈 수 없으니 지그재그로 갑니다. 바람에 최대한 붙여 달리다가 뱃머리를 바람 너머로 돌려 반대쪽으로 같은 일을 반복합니다. 이 회전 하나를 **택(tack)**이라고 합니다.',
      },
      {
        en: 'How close is worth knowing, because the edge is not sharp. Measured in a 12 knot breeze, pointing at the wind she makes **0.6 knots** — stopped. At 20° off, 1.1. At 30°, 3.0, and she is properly sailing. At 45° she does 5.0 and is making the most ground to windward she can. So the cost of pointing too high creeps up on you rather than announcing itself.',
        ko: '얼마나 붙일 수 있는지는 알아둘 만합니다. 경계가 날카롭지 않기 때문입니다. 12노트 바람에서 재보면 바람을 정면으로 향했을 때 **0.6노트** — 멈춘 상태입니다. 20° 벌리면 1.1, 30°에서 3.0으로 제대로 달리기 시작하고, 45°에서 5.0으로 바람 쪽으로 가장 많이 전진합니다. 너무 붙여 달리는 대가는 티 나게 오지 않고 슬금슬금 커집니다.',
      },
      {
        en: 'The best angle is not a constant, and this boat has been measured at it. In a working breeze she wants **45° off the wind**, which means 90° between the two tacks. In very light air she needs **50°** to keep moving at all, and by 35 knots she is down to **55°** because she cannot carry sail closer. Pinching higher than that feels faster and is not.',
        ko: '최적 각도는 고정값이 아니고, 이 배는 실측되어 있습니다. 적당한 바람에서는 **바람에서 45°**를 원하고, 두 택 사이가 90°가 됩니다. 아주 약한 바람에서는 움직이기 위해 **50°**가 필요하고, 35노트가 되면 그보다 붙여서는 돛을 버틸 수 없어 **55°**까지 벌어집니다. 그보다 더 붙이면 빨라지는 느낌만 들 뿐 실제로는 아닙니다.',
      },
      {
        en: 'Steer by **VMG**, not boat speed. VMG is speed made good towards the wind; bearing away makes BSP rise and VMG fall. The polar panel draws the whole curve with a marker for where you are, so the gap between the two is exactly what you are leaving out there.',
        ko: '선속이 아니라 **VMG**를 보고 조타하세요. VMG는 바람 쪽으로 실제로 전진하는 속도입니다. 바람에서 벗어날수록 BSP는 오르고 VMG는 떨어집니다. 폴라 패널이 곡선 전체와 현재 위치 표식을 함께 그리므로, 둘 사이의 간격이 지금 놓치고 있는 양입니다.',
      },
    ],
  },
  {
    title: { en: 'Reaching and running', ko: '옆바람과 뒷바람' },
    paragraphs: [
      {
        en: 'Across the wind is where she is quickest through the water — **TWA 90–100°**, and 6.9 knots of it in a 20 knot breeze against 5.4 on the wind.',
        ko: '물살을 가르는 속도가 가장 빠른 곳은 바람을 옆으로 받을 때입니다 — **TWA 90–100°**. 20노트 바람에서 6.9노트가 나오고, 같은 조건에서 맞바람으로는 5.4노트입니다.',
      },
      {
        en: 'Downwind, point straight at where you are going. This is the one place this boat is not a racing yacht: she carries no spinnaker, so there is nothing to gain by gybing downwind and dead astern really is the fastest way to leeward here.',
        ko: '뒷바람에서는 목적지를 향해 곧장 가면 됩니다. 이 배가 경주용 요트와 다른 유일한 지점입니다. 스피네이커가 없어서 지그재그로 내려갈 이득이 없고, 여기서는 정후미가 실제로 바람 아래쪽으로 가는 가장 빠른 길입니다.',
      },
    ],
  },
  {
    title: { en: 'Trimming the sail', ko: '돛 조절' },
    paragraphs: [
      {
        en: 'The sheet sets how far the sail is let out; the vang sets how much the top twists away from the foot. Both change the **angle of attack**, and the AoA readout is what to watch: too little and the sail flaps, too much and it stalls and she heels without going anywhere.',
        ko: '시트는 돛을 얼마나 내보낼지를, 뱅은 돛 윗부분이 아랫부분보다 얼마나 젖혀질지를 정합니다. 둘 다 **받음각**을 바꾸며, 봐야 할 것은 AoA 값입니다. 너무 작으면 돛이 펄럭이고, 너무 크면 실속해서 배는 기울기만 하고 나아가지 않습니다.',
      },
      {
        en: 'The rule of thumb is to ease until it just flaps, then take it back in. Or press [[T]] and let her trim herself while you concentrate on steering — the instrument panel shows the twist she would have chosen either way.',
        ko: '요령은 살짝 펄럭일 때까지 내보냈다가 다시 조금 당기는 것입니다. 아니면 [[T]]를 눌러 배가 알아서 조절하게 두고 조타에만 집중해도 됩니다. 어느 쪽이든 계기판은 배가 선택했을 트위스트를 함께 보여줍니다.',
      },
    ],
  },
  {
    title: { en: 'When it comes on to blow', ko: '바람이 세질 때' },
    paragraphs: [
      {
        en: 'Too much sail in too much wind does not go faster; it lies the boat over and stops her. Measured on a beat, she is quickest at **5.4 knots in a 16 knot breeze**, pressed to 27° of heel. Give her 30 knots of wind and the same sail and she does **4.6** — half as much wind again, and slower for it.',
        ko: '센 바람에 돛을 다 펴면 빨라지는 게 아니라 배가 눕고 멈춥니다. 맞바람에서 실측하면 **16노트 바람에서 5.4노트**가 가장 빠르고, 이때 힐(기울기)은 27°입니다. 같은 돛으로 30노트 바람을 주면 **4.6노트** — 바람이 절반 더 세졌는데 오히려 느립니다.',
      },
      {
        en: 'Reduce sail with [[1]]–[[4]] for the main and [[F]] to roll away the jib, or set auto-reef with [[Y]] and let her decide. Heel is the gauge to watch.',
        ko: '메인세일은 [[1]]–[[4]]로 줄이고, 집세일은 [[F]]로 말아 넣습니다. 아니면 [[Y]]로 자동 리프를 켜서 배에 맡기세요. 지켜볼 계기는 힐입니다.',
      },
    ],
  },
  {
    title: { en: 'Water and tide', ko: '수심과 조류' },
    paragraphs: [
      {
        en: 'Depth is real and so is the bottom: she draws 1.8 m and will stop hard on anything shallower. In a surveyed region the chart is the same data the hull grounds on, so the shoal you can see is the one you will touch.',
        ko: '수심도 바닥도 진짜입니다. 이 배는 1.8 m를 먹으므로 그보다 얕은 곳에서는 그대로 얹힙니다. 측량된 지역에서는 차트가 선체를 좌초시키는 바로 그 데이터이므로, 화면에서 보이는 여울이 실제로 부딪히는 여울입니다.',
      },
      {
        en: 'When a tide runs, **SOG** and **COG** part company with BSP and HDG — she is being carried sideways as well as driven forward. Point at a mark and the tide will set you off it; the chart’s arrows show which way. Working the shallows to escape a foul tide is the oldest trick there is, and it costs breeze and eventually the keel.',
        ko: '조류가 흐르면 **SOG**와 **COG**가 BSP·HDG와 갈라집니다. 배가 앞으로 나아가는 동시에 옆으로 떠밀리기 때문입니다. 목표를 향해 뱃머리를 두어도 조류가 밀어내며, 차트의 화살표가 방향을 알려줍니다. 역조를 피해 얕은 물로 붙는 것은 가장 오래된 요령인데, 대가로 바람을 잃고 결국 용골까지 걸립니다.',
      },
    ],
  },
  {
    title: { en: 'Coming to anchor', ko: '닻 내리기' },
    paragraphs: [
      {
        en: 'The anchor goes down with [[A]], and only where it can hold: **3 to 12 m of water**, with the way off her — under about **0.7 knots** over the ground. Deeper and there is nothing for it to lie to; faster and it will not set. The panel says which of those is stopping you, the moment one is.',
        ko: '닻은 [[A]]로 내리며, 잡아줄 수 있는 곳에서만 내려갑니다: **수심 3~12 m**, 그리고 배를 거의 세워 대지속도 약 **0.7노트** 아래일 때입니다. 더 깊으면 닻이 바닥을 잡지 못하고, 더 빠르면 걸리지 않습니다. 지금 무엇이 막고 있는지는 계기판이 그때그때 알려줍니다.',
      },
      {
        en: 'This is also how a passage ends. Set a destination on the chart and the logbook writes the passage down when the anchor goes down **within 150 m of it** — sailing over the spot records nothing. An anchorage is a place rather than a point, so aim for somewhere with water she can actually lie in.',
        ko: '항해가 끝나는 방식이기도 합니다. 차트에 목적지를 찍고 **그 150 m 안에서 닻을 내리면** 항해가 항해일지에 기록됩니다 — 지점 위를 지나가는 것만으로는 아무것도 남지 않습니다. 정박지는 점이 아니라 장소이므로, 실제로 닻을 내릴 수 있는 물이 있는 곳을 목적지로 고르세요.',
      },
    ],
  },
];

export const GUIDE_GLOSSARY_TITLE: Phrase = {
  en: 'Every reading on the panel',
  ko: '계기판의 모든 값',
};

/**
 * The abbreviations stay in English in both locales, on purpose: they are what
 * is printed on a real boat's instruments anywhere in the world. Only the
 * explanation is translated -- see the note at the top of `i18n.tsx`.
 */
export const GLOSSARY: { term: string; meaning: Phrase }[] = [
  {
    term: 'BSP',
    meaning: {
      en: 'Boat speed through the water. What the hull feels.',
      ko: '물에 대한 선속. 선체가 실제로 느끼는 속도입니다.',
    },
  },
  {
    term: 'SOG',
    meaning: {
      en: 'Speed over the ground. Differs from BSP only when a tide runs.',
      ko: '땅에 대한 속도. 조류가 흐를 때만 BSP와 달라집니다.',
    },
  },
  {
    term: 'VMG',
    meaning: {
      en: 'How fast you are closing on the wind — the number that matters upwind, not BSP.',
      ko: '바람 쪽으로 얼마나 빨리 접근하는가. 맞바람에서 봐야 할 값은 BSP가 아니라 이것입니다.',
    },
  },
  {
    term: 'HDG',
    meaning: { en: 'The way the bow points.', ko: '뱃머리가 향한 방향.' },
  },
  {
    term: 'COG',
    meaning: {
      en: 'The way she is actually going. A tide sets these apart.',
      ko: '배가 실제로 가고 있는 방향. 조류가 이 둘을 갈라놓습니다.',
    },
  },
  {
    term: 'TWS',
    meaning: {
      en: 'True wind speed, as a fixed object would feel it.',
      ko: '실제 풍속. 고정된 물체가 느낄 바람의 세기입니다.',
    },
  },
  {
    term: 'TWD',
    meaning: {
      en: 'True wind direction: the bearing it blows from, not the one it blows towards.',
      ko: '실제 풍향. 바람이 불어오는 방위이며, 불어가는 쪽이 아닙니다.',
    },
  },
  {
    term: 'TWA',
    meaning: {
      en: 'True wind angle: where the wind is relative to the bow. 0 is dead ahead, 180 dead astern. Negative is over the port side.',
      ko: '뱃머리 기준 실제 풍향각. 0은 정면, 180은 정후미이며, 음수는 좌현 쪽에서 불어오는 것입니다.',
    },
  },
  {
    term: 'TGT',
    meaning: {
      en: 'Target speed: what this boat can make at this angle in this wind, from her own polar. Trim until BSP closes on it.',
      ko: '목표 속도. 이 배가 이 바람, 이 각도에서 낼 수 있는 속도로, 폴라에서 나옵니다. BSP가 여기 붙도록 조절하세요.',
    },
  },
  {
    term: 'POL',
    meaning: {
      en: 'Boat speed as a share of the target. 100 is on the pace, and a gust genuinely pushes past it. Says nothing in the no-go zone or in a tide, where the number would mislead.',
      ko: '목표 대비 선속. 100이면 폴라 그대로이고, 돌풍에서는 실제로 넘어섭니다. 노고존과 조류에서는 숫자가 오해를 부르므로 아무것도 표시하지 않습니다.',
    },
  },
  {
    term: 'AWS',
    meaning: {
      en: 'Apparent wind speed — what the boat feels, wind plus her own motion. Always more than TWS on a beat, less on a run.',
      ko: '겉보기 풍속. 바람에 배 자신의 움직임이 더해져 배가 느끼는 값입니다. 맞바람에서는 항상 TWS보다 크고, 뒷바람에서는 작습니다.',
    },
  },
  {
    term: 'AWA',
    meaning: {
      en: 'Apparent wind angle, read at the masthead, which is where a real vane is.',
      ko: '겉보기 풍향각. 실제 풍향계가 달린 곳인 마스트 꼭대기에서 읽습니다.',
    },
  },
  {
    term: 'Heel',
    meaning: {
      en: 'How far she is leaning. Pressed hard on a beat she is quickest in the high twenties of degrees; past that she goes slower, not faster. In light air she never gets near it, and less heel just means less wind.',
      ko: '배가 기운 정도. 센 바람의 맞바람에서는 20도대 후반에서 가장 빠르고, 그보다 더 기울면 느려집니다. 약한 바람에서는 그 근처까지 가지도 않으며, 힐이 작다는 건 그저 바람이 약하다는 뜻입니다.',
    },
  },
  {
    term: 'Leeway',
    meaning: {
      en: 'The angle between where she points and where she goes. The keel needs it to make side force at all.',
      ko: '뱃머리가 향한 방향과 실제로 가는 방향의 차이. 용골은 이 각도가 있어야 옆으로 버티는 힘을 냅니다.',
    },
  },
  {
    term: 'Sheet',
    meaning: {
      en: 'How far the sail is let out from the centreline.',
      ko: '돛을 중심선에서 얼마나 내보냈는지.',
    },
  },
  {
    term: 'Twist',
    meaning: {
      en: 'How much more the top of the sail is eased than the foot. The second number is what the auto-trim would choose.',
      ko: '돛 윗부분이 아랫부분보다 얼마나 더 젖혀졌는지. 두 번째 숫자는 자동 트림이 선택했을 값입니다.',
    },
  },
  {
    term: 'AoA',
    meaning: {
      en: "The sail's angle of attack. Too little and it flaps, too much and it stalls.",
      ko: '돛의 받음각. 너무 작으면 펄럭이고, 너무 크면 실속합니다.',
    },
  },
  {
    term: 'Sea',
    meaning: {
      en: 'Significant wave height — the average of the biggest third, which is what an eye on deck reports.',
      ko: '유의파고. 큰 쪽 3분의 1의 평균이며, 갑판에서 눈으로 보고하는 값이 이것입니다.',
    },
  },
  {
    term: 'Depth',
    meaning: {
      en: 'Water under the keel. She draws 1.8 m.',
      ko: '용골 아래 물의 깊이. 이 배의 흘수는 1.8 m입니다.',
    },
  },
];
