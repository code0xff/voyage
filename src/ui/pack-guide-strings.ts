import type { Phrase } from '@/i18n';

/**
 * The guide to writing a quest pack, in both languages.
 *
 * Same rules as `guide-strings.ts`: one string per sentence, `**bold**` and
 * `[[key]]` markers a translation may move, so that Korean can put the verb
 * last without the sentence being assembled backwards out of JSX.
 *
 * **The vocabulary is not translated, and that is the point.** `atLeast`,
 * `westerlies`, `sf-bay` are what goes in the file; a Korean reader who
 * learned a translated name for one of them would write a pack the game
 * refuses. The prose around them is translated, the names are quoted, and
 * every list here is the one `readPack` checks against -- so a name that
 * moves in `sim/quest.ts` and not here would be a guide that teaches a
 * refusal. `docs/quests.md` carries the same lists and the reasoning behind
 * them; this is the half a player can read without leaving the game.
 */

export const PACK_GUIDE_TITLE: Phrase = { en: 'Quest packs', ko: '퀘스트 팩' };

export const PACK_GUIDE_INTRO: Phrase[] = [
  {
    en: 'A quest pack is a **JSON file** of things worth doing. Anyone can write one, and installing one is how you add to this game.',
    ko: '퀘스트 팩은 해볼 만한 일들을 적어둔 **JSON 파일**입니다. 누구나 쓸 수 있고, 팩을 설치하는 것이 이 게임에 내용을 더하는 방법입니다.',
  },
  {
    en: 'A pack can only ever **notice**. Nothing in one is run: the whole vocabulary is a closed list of names, so the worst a file can do to you is be refused.',
    ko: '팩이 할 수 있는 일은 **알아채는 것**뿐입니다. 안의 무엇도 실행되지 않습니다. 어휘 전체가 닫힌 이름 목록이라, 남의 파일이 당신에게 할 수 있는 최악은 거부되는 것입니다.',
  },
  {
    en: 'The quickest way in is the example file below — it is the pack this game ships with, exactly as it is. Change a number, install it back, and it takes the old one’s place.',
    ko: '가장 빠른 출발점은 아래의 예시 파일입니다. 이 게임에 포함된 팩 그대로입니다. 숫자 하나를 고쳐 다시 설치하면 원래 팩을 대체합니다.',
  },
];

export interface PackGuideSection {
  title: Phrase;
  paragraphs: Phrase[];
  /** A term and what it means; the term is never translated. */
  terms?: { term: string; meaning: Phrase }[];
}

export const PACK_GUIDE_SHAPE: PackGuideSection = {
  title: { en: 'The file', ko: '파일' },
  paragraphs: [
    {
      en: 'A pack names itself and carries a list of quests. Every quest needs an `id`, a `name` with at least an `en` in it, and an `ask`.',
      ko: '팩은 자신을 밝히고 퀘스트 목록을 담습니다. 각 퀘스트에는 `id`와, 최소한 `en`이 들어 있는 `name`과, `ask`가 필요합니다.',
    },
    {
      en: 'The `note` is optional and is what the quest screen shows for something not yet done, so it is where you say **how** — the name says what.',
      ko: '`note`는 선택이며, 아직 못한 퀘스트에 대해 퀘스트 화면이 보여주는 문장입니다. 이름이 무엇을 말한다면 여기에는 **어떻게**를 씁니다.',
    },
  ],
};

export const PACK_GUIDE_WHEN: PackGuideSection = {
  title: { en: 'When it is measured', ko: '언제를 재는가' },
  paragraphs: [
    {
      en: 'Every condition sits in a scope, which says when it is read.',
      ko: '모든 조건은 언제 읽히는지를 말하는 범위 안에 들어갑니다.',
    },
    {
      en: 'A quest completes the moment its whole `ask` holds. There is no accepting one and no failing one — everything in one ask has to be true **at the same moment**, which is what lets a quest say "a hundred miles into this passage, and standing in past the Horn".',
      ko: '`ask` 전체가 성립하는 순간 퀘스트가 완료됩니다. 수락도 실패도 없습니다. 한 `ask` 안의 모든 것은 **같은 순간에** 참이어야 하며, 그래서 "이번 항해로 100해리를 왔고, 지금 혼곶을 지나는 중"이라고 말할 수 있습니다.',
    },
  ],
  terms: [
    { term: 'now', meaning: { en: 'true at this instant', ko: '지금 이 순간 참' } },
    {
      term: 'passage',
      meaning: {
        en: 'piled up since this passage began; back to nothing when the next one begins, or when this one is given up',
        ko: '이번 항해가 시작된 뒤로 쌓인 값. 다음 항해가 시작되거나 이번 항해를 포기하면 0으로',
      },
    },
    {
      term: 'total',
      meaning: { en: 'piled up over every passage ever sailed', ko: '지금까지의 모든 항해에 걸쳐 쌓인 값' },
    },
  ],
};

export const PACK_GUIDE_NOW: PackGuideSection = {
  title: { en: 'What `now` can ask', ko: '`now`가 물을 수 있는 것' },
  paragraphs: [
    {
      en: 'Numbers go under `facts`, each with a bound: `atLeast`, `atMost`, or both. A bound with neither is refused — it would hold on the first sample.',
      ko: '숫자는 `facts` 아래에 들어가며, 각각 `atLeast`나 `atMost`, 또는 둘 다의 범위를 가집니다. 둘 다 없는 범위는 거부됩니다. 첫 관측에서 바로 성립해버리기 때문입니다.',
    },
  ],
  terms: [
    { term: 'wind', meaning: { en: 'knots, the true wind she is in', ko: '노트. 지금 배가 받는 실제 바람' } },
    { term: 'heel', meaning: { en: 'degrees she is laid over, never negative', ko: '기울어진 각도. 음수가 되지 않습니다' } },
    { term: 'sea', meaning: { en: 'metres, significant wave height', ko: '미터. 유의파고' } },
    { term: 'speed', meaning: { en: 'knots over the ground', ko: '노트. 대지속도' } },
    { term: 'depth', meaning: { en: 'metres under the keel', ko: '미터. 용골 아래 수심' } },
    { term: 'hour', meaning: { en: '0–24, the world clock', ko: '0~24. 세계 시각' } },
    { term: 'latitude', meaning: { en: 'degrees, negative south', ko: '도. 남반구는 음수' } },
    { term: 'longitude', meaning: { en: 'degrees, negative west', ko: '도. 서경은 음수' } },
    {
      term: 'south',
      meaning: { en: 'degrees she is south of the line; negative north of it', ko: '적도에서 남쪽으로 몇 도. 북반구면 음수' },
    },
    { term: 'north', meaning: { en: 'the same, the other way', ko: '같은 값의 반대 방향' } },
  ],
};

export const PACK_GUIDE_NAMES: PackGuideSection = {
  title: { en: 'Places, belts and weather', ko: '장소·바람대·날씨' },
  paragraphs: [
    {
      en: '`near` asks whether she is within so many nautical miles of a place: `"near": { "lat": -55.98, "lon": -67.27, "within": 50 }`. It is a yes or a no, so it shows no progress bar.',
      ko: '`near`는 어떤 지점에서 몇 해리 안에 있는지를 묻습니다: `"near": { "lat": -55.98, "lon": -67.27, "within": 50 }`. 예 아니오로 답하는 조건이라 진행 막대가 없습니다.',
    },
    {
      en: 'The other three name something instead of measuring it, so the name has to be one this build has. A misspelled `"weather": "foggy"` is not a hard quest, it is an impossible one — which is why it is refused at install rather than accepted.',
      ko: '나머지 셋은 재는 대신 이름을 부릅니다. 그러니 이 버전이 가진 이름이어야 합니다. 잘못 쓴 `"weather": "foggy"`는 어려운 퀘스트가 아니라 불가능한 퀘스트입니다. 그래서 설치할 때 받아주지 않고 거부합니다.',
    },
    {
      en: 'There is one world — the Earth — so there is no world to ask about, and every belt, latitude and `near` is answered wherever she is.',
      ko: '세계는 지구 하나뿐이라 어느 바다인지 물을 것이 없고, 바람대와 위도와 `near`는 배가 어디에 있든 답이 나옵니다.',
    },
  ],
  terms: [
    {
      term: 'belt',
      meaning: {
        en: '`doldrums` `trades` `horse` `westerlies` `polar`',
        ko: '`doldrums` `trades` `horse` `westerlies` `polar`',
      },
    },
    {
      term: 'weather',
      meaning: {
        en: '`clear` `fair` `overcast` `rain` `squall` `shower` `fog`',
        ko: '`clear` `fair` `overcast` `rain` `squall` `shower` `fog`',
      },
    },
  ],
};

export const PACK_GUIDE_TALLIES: PackGuideSection = {
  title: { en: 'What piles up', ko: '쌓이는 것' },
  paragraphs: [
    {
      en: 'These go under `passage` or `total`, in the same `facts` shape. A quest counted this way is the only kind that can show a progress bar.',
      ko: '이 값들은 `passage`나 `total` 아래에, 같은 `facts` 모양으로 들어갑니다. 이렇게 세는 퀘스트만 진행 막대를 보여줄 수 있습니다.',
    },
  ],
  terms: [
    { term: 'miles', meaning: { en: 'nautical miles sailed', ko: '항해한 해리' } },
    { term: 'hours', meaning: { en: 'hours under way', ko: '항해한 시간' } },
    { term: 'whales', meaning: { en: 'whales seen', ko: '만난 고래' } },
    { term: 'sharks', meaning: { en: 'sharks seen', ko: '만난 상어' } },
    { term: 'photographs', meaning: { en: 'photographs taken', ko: '찍은 사진' } },
    {
      term: 'belts',
      meaning: {
        en: 'how many **distinct** wind belts she has been through — the one a logbook could never answer',
        ko: '지나온 **서로 다른** 바람대의 수. 항해일지로는 결코 답할 수 없던 값입니다',
      },
    },
    {
      term: 'passages',
      meaning: { en: 'completed passages; `total` only', ko: '완료한 항해의 수. `total`에서만' },
    },
  ],
};

export const PACK_GUIDE_OR: PackGuideSection = {
  title: { en: 'And, or', ko: '그리고, 또는' },
  paragraphs: [
    {
      en: 'Everything named in one `ask` must hold together — that is **and**, and there is no way to write it. For **or**, use `any`, which holds a list of whole asks.',
      ko: '한 `ask` 안에 적은 것은 모두 함께 성립해야 합니다. 그것이 **그리고**이고, 따로 쓸 방법은 없습니다. **또는**은 `any`로 씁니다. 온전한 `ask`들의 목록을 담습니다.',
    },
    {
      en: 'This is how the shipped pack asks for a night watch: the clock wraps at midnight, so one bound cannot cross it.',
      ko: '포함된 팩이 야간 항해를 묻는 방법이 이것입니다. 시계는 자정에서 되감기므로 범위 하나로는 자정을 넘을 수 없습니다.',
    },
  ],
};

export const PACK_GUIDE_REFUSED: PackGuideSection = {
  title: { en: 'What gets refused', ko: '거부되는 것' },
  paragraphs: [
    {
      en: 'A pack is checked when it is installed, and refused with the **name of the thing** that was wrong: a fact, a field, a belt or weather this build has no name for, a bound with no limit in it, an ask with nothing in it, two quests sharing an id, a quest with no English name, or a `format` from a later version.',
      ko: '팩은 설치할 때 검사되고, **무엇이 잘못됐는지 그 이름과 함께** 거부됩니다. 없는 값, 없는 항목, 이 버전에 없는 바람대나 날씨 이름, 한계가 없는 범위, 아무것도 묻지 않는 조건, 같은 id를 쓰는 두 퀘스트, 영문 이름이 없는 퀘스트, 더 나중 버전의 `format`.',
    },
    {
      en: 'Refusing is deliberate, and the alternative is worse: a pack that installed and quietly could not complete would be a pack nobody can debug. If it went in, it works.',
      ko: '거부는 의도된 것이고, 반대쪽이 더 나쁩니다. 설치는 되는데 조용히 완료될 수 없는 팩은 아무도 원인을 찾을 수 없습니다. 들어갔다면 동작합니다.',
    },
  ],
};

export const PACK_GUIDE_NOT: PackGuideSection = {
  title: { en: 'What a pack cannot do', ko: '팩이 할 수 없는 것' },
  paragraphs: [
    {
      en: '**No rewards.** Completing a quest gives nothing but the fact of it. There is nothing to pay with that would not teach you to sail badly for it.',
      ko: '**보상이 없습니다.** 완료해도 완료했다는 사실 외에 주어지는 것이 없습니다. 줄 만한 것 중 배를 잘못 몰게 만들지 않는 것이 없습니다.',
    },
    {
      en: '**No ordering.** A quest cannot ask for one thing and then another. Two quests say it more clearly than a sequence would.',
      ko: '**순서가 없습니다.** 하나를 하고 그다음을 하라고 쓸 수 없습니다. 그런 것은 퀘스트 두 개가 더 분명합니다.',
    },
    {
      en: '**No taking the wheel.** A pack cannot set the wind, the seed or the world. It never changes how the boat behaves, and that is the same sentence as the safety one above: it only notices.',
      ko: '**조종간을 가져가지 않습니다.** 팩은 바람도, 시드도, 바다도 정할 수 없습니다. 배의 거동을 절대 바꾸지 않으며, 이는 위의 안전 문장과 같은 말입니다. 알아챌 뿐입니다.',
    },
  ],
};
