import type { Phrase } from '@/i18n';
import type { AnchorProblem } from '@/sim/anchorage';
import type { WeatherKind } from '@/sim/weather';
import type { DayPhase } from '@/sim/sky';

/**
 * Interface copy, in both languages.
 *
 * Grouped by where it appears rather than by kind, because that is how it gets
 * checked: open the panel, read down the group. The guide has its own file --
 * it is prose and much longer, and mixing the two would bury the short strings
 * that have to be right.
 *
 * Instrument abbreviations are not in here. See the note in `i18n.tsx`.
 */

export const HINT: Record<string, Phrase> = {
  anchored: { en: 'At anchor — A to weigh', ko: '정박 중 — A로 닻 올리기' },
  aground: {
    en: 'Aground — sail her off before the tide leaves you',
    ko: '좌초 — 조류가 빠지기 전에 빠져나오세요',
  },
  lee: {
    en: 'In the lee of the land — get back into clear air',
    ko: '육지 바람그늘 — 바람이 트인 곳으로 나가세요',
  },
  squall: { en: 'Squall — reef before it hits', ko: '스콜 — 닥치기 전에 돛을 줄이세요' },
  fog: {
    en: 'Thick fog — steer on the bearing readout',
    ko: '짙은 안개 — 방위 값을 보고 조타하세요',
  },
  stowed: {
    en: 'Sails handed — 0 to set sail again, 1-4 to reef',
    ko: '돛 거둠 — 0으로 다시 펴기, 1-4로 리프',
  },
  pinching: { en: 'Too close to the wind — bear away', ko: '바람에 너무 붙음 — 바람에서 벗어나세요' },
  menu: { en: 'Esc for menu and settings', ko: 'Esc로 메뉴와 설정' },
};

/** `Good holding in 8 m, sheltered — A to let go`, assembled per language. */
export const holding = (depth: string, sheltered: boolean): Phrase => ({
  en: `Good holding in ${depth} m${sheltered ? ', sheltered' : ''} — A to let go`,
  ko: `${depth} m, 닻 잘 물림${sheltered ? ' · 바람도 막힘' : ''} — A로 닻 내리기`,
});

export const ANCHOR_PROBLEM: Record<AnchorProblem, Phrase> = {
  aground: { en: 'aground', ko: '이미 얹혀 있음' },
  shoal: {
    en: 'too shallow — she would touch as she swings',
    ko: '너무 얕음 — 배가 돌면서 바닥에 닿습니다',
  },
  deep: { en: 'too deep to lie to', ko: '너무 깊어 닻이 안 먹힘' },
  way: {
    en: 'still carrying way — take the way off her first',
    ko: '아직 전진 중 — 먼저 배를 세우세요',
  },
};

export const nowhereToAnchor = (why: Phrase): Phrase => ({
  en: `Nowhere to anchor: ${why.en}`,
  ko: `닻 내릴 곳이 아님: ${why.ko}`,
});

/**
 * `4 islands`, assembled per language because Korean puts the counter after the
 * noun. A function for the same reason `holding` is one.
 */
export const islandCount = (n: number): Phrase => ({
  // The slider goes down to one, so the singular is reachable. Korean counters
  // take no singular form, which is half of why this is a function.
  en: n === 1 ? '1 island' : `${n} islands`,
  ko: `섬 ${n}개`,
});

export const MENU: Record<string, Phrase> = {
  tagline: {
    en: 'A sailing simulator that computes apparent wind, sail lift, keel side force and wave-making resistance. Wind differs from place to place, weather turns, and land steals your breeze.',
    ko: '겉보기 바람, 돛의 양력, 용골의 횡력, 조파저항을 실제로 계산하는 항해 시뮬레이터입니다. 바람은 장소마다 다르고, 날씨는 스스로 변하며, 육지는 당신의 바람을 빼앗습니다.',
  },
  resume: { en: 'Resume', ko: '돌아가기' },
  putToSea: { en: 'Put to sea', ko: '출항' },
  putToSeaHint: { en: 'a new world, and time to sail it', ko: '새로운 바다, 그리고 항해할 시간' },
  adjust: { en: 'Adjust', ko: '설정' },
  /**
   * The names of the screens behind the menu, used as their headings.
   *
   * `settings` is a noun where the door that opens it is a verb, which is the
   * ordinary shape: you press Adjust and arrive at Settings. In Korean both are
   * 설정 and the two match exactly.
   *
   * `help` is the umbrella on purpose. That screen holds the sailing guide and
   * the key list, and it is reached from both "Read the guide" and "all the
   * keys" -- naming it Guide would be a lie to everyone who arrived the second
   * way.
   */
  settings: { en: 'Settings', ko: '설정' },
  help: { en: 'Help', ko: '도움말' },
  done: { en: 'Done', ko: '완료' },
  /** The back arrow carries no text, so this is the only name a screen reader gets. */
  back: { en: 'Back', ko: '뒤로' },
  close: { en: 'Close', ko: '닫기' },
  engineLoading: { en: 'Loading the sailing engine…', ko: '항해 엔진을 불러오는 중…' },
  engineLoadFailed: {
    en: 'The sailing engine could not be loaded.',
    ko: '항해 엔진을 불러오지 못했습니다.',
  },
  // Says "reload", because that is what it does. A browser keeps a failed
  // module fetch, so importing again cannot recover -- only a fresh page can.
  retryEngine: { en: 'Reload the page', ko: '페이지 다시 불러오기' },
  changingWeather: { en: 'changing weather', ko: '변하는 날씨' },
  openSea: { en: 'open sea', ko: '먼바다' },
  guideLead: { en: 'Never sailed before?', ko: '항해가 처음이신가요?' },
  guideBody: {
    en: 'A boat cannot sail straight at the wind, and that changes everything else. Read the guide →',
    ko: '배는 바람을 향해 곧장 갈 수 없고, 그 사실이 나머지 전부를 바꿉니다. 가이드 보기 →',
  },
  language: { en: 'Language', ko: '언어' },
  allKeys: { en: 'all the keys →', ko: '전체 조작 보기 →' },
  /**
   * The way to the logbook before there is anything in it. The card above it
   * replaces this once a passage has been made, so this line has to do the
   * other half of the job: say what the logbook is for to someone who has
   * never seen one.
   */
  logbookLead: {
    en: 'Every passage you finish is written down.',
    ko: '마친 항해는 모두 기록으로 남습니다.',
  },
  logbook: { en: 'the logbook →', ko: '항해일지 보기 →' },
  /** The four keys worth knowing before you have read anything. */
  quickKeys: {
    en: '[[← →]] helm · [[H]] autopilot · [[T]] auto-trim · [[Esc]] this menu',
    ko: '[[← →]] 조타 · [[H]] 오토파일럿 · [[T]] 자동 트림 · [[Esc]] 이 메뉴',
  },
};

export const TABS: Record<string, Phrase> = {
  world: { en: 'World', ko: '월드' },
  conditions: { en: 'Conditions', ko: '조건' },
  log: { en: 'Log', ko: '항해일지' },
  sailing: { en: 'Sailing', ko: '항해' },
  controls: { en: 'Controls', ko: '조작' },
};

/**
 * Asset attribution. The label and the statement of what was changed are prose;
 * the creator, the licence and the model names are references and live in
 * `Credits.tsx` untranslated.
 */
export const CREDITS: Record<string, Phrase> = {
  title: { en: '3D models', ko: '3D 모델' },
  note: {
    en: 'Scaled, positioned and animated at runtime; geometry and textures are otherwise unmodified. Everything else here, the sound included, is written for this project.',
    ko: '실행 중에 크기와 위치를 맞추고 애니메이션을 적용하며, 형상과 텍스처는 그 밖에 수정하지 않았습니다. 소리를 포함한 나머지 전부는 이 프로젝트를 위해 직접 만든 것입니다.',
  },
  code: { en: 'The libraries it is built on:', ko: '사용한 오픈소스 라이브러리:' },
  /** Links to the per-model notice, which is where the changes are stated in full. */
  changes: { en: 'changes', ko: '변경 내역' },
  /** All three are under the same licence, so it is said once below the list. */
  allUnder: { en: 'All', ko: '모두' },
};

export const CONTROLS_NOTE: Phrase = {
  en: 'New to this? The Sailing tab explains what the boat is doing and what every reading means.',
  ko: '처음이신가요? 항해 탭에서 배가 무엇을 하고 있는지, 각 계기값이 무엇인지 설명합니다.',
};

/** Key bindings: the caps are universal, the descriptions are not. */
export const KEYS: [string, Phrase][] = [
  ['← →  /  A D', { en: 'helm (holds its angle)', ko: '조타 (각도를 유지합니다)' }],
  ['Space', { en: 'centre the helm', ko: '타를 중앙으로' }],
  ['↑ ↓  /  W S', { en: 'trim in / ease', ko: '돛 당기기 / 내보내기' }],
  ['Z X', { en: 'vang: close the leech / twist off', ko: '뱅: 리치를 닫기 / 트위스트 주기' }],
  ['T', { en: 'auto-trim', ko: '자동 트림' }],
  ['H', { en: 'autopilot: off / compass / wind', ko: '오토파일럿: 끔 / 나침반 / 바람' }],
  ['1 2 3 4', { en: 'reef 0–3', ko: '리프 0–3단' }],
  ['F / G', { en: 'furl / unfurl jib', ko: '집세일 말기 / 펴기' }],
  ['Y', { en: 'auto-reef', ko: '자동 리프' }],
  ['Q E', { en: 'mean wind direction', ko: '평균 풍향' }],
  ['C', { en: 'camera: astern / on deck / overhead', ko: '카메라: 뒤 / 갑판 / 위' }],
  ['0', { en: 'hand all sail / set again', ko: '돛 전부 거두기 / 다시 펴기' }],
  ['A', { en: 'let go / weigh anchor', ko: '닻 내리기 / 올리기' }],
  ['N / wheel on chart', { en: 'chart range', ko: '차트 축척' }],
  ['drag chart', { en: 'look around it', ko: '차트 둘러보기' }],
  ['click chart', { en: 'set where you are bound', ko: '목적지 정하기' }],
  ['drag', { en: 'orbit around the boat', ko: '배 주위로 시점 돌리기' }],
  // Not "zoom": it moves the eye nearer or further, and B is the thing that
  // actually magnifies. Calling both zoom is why one gets mistaken for the other.
  [
    'wheel elsewhere',
    { en: 'eye closer / further out — or the power, through the glasses', ko: '시점 거리 조절 — 쌍안경 중에는 배율' },
  ],
  ['double-click', { en: 'recentre astern', ko: '선미 뒤로 시점 복귀' }],
  ['P', { en: 're-solve polar', ko: '폴라 다시 계산' }],
  ['R', { en: 'restart', ko: '다시 시작' }],
  ['M', { en: 'sound', ko: '소리' }],
  ['K', { en: 'photograph the sea', ko: '바다 사진 찍기' }],
  ['L', { en: 'navigation lights', ko: '항해등' }],
  ['B', { en: 'binoculars — wheel sets the power', ko: '쌍안경 — 휠로 배율 조절' }],
  ['Esc', { en: 'this menu', ko: '이 메뉴' }],
];

export const WEATHER: Record<WeatherKind, Phrase> = {
  clear: { en: 'Clear', ko: '맑음' },
  fair: { en: 'Fair', ko: '갬' },
  overcast: { en: 'Overcast', ko: '흐림' },
  rain: { en: 'Rain', ko: '비' },
  squall: { en: 'Squall', ko: '스콜' },
  shower: { en: 'Shower', ko: '소나기' },
  fog: { en: 'Fog', ko: '안개' },
};

/**
 * What each region asks of you.
 *
 * The names and the survey citations stay in English -- they are what is
 * written on the chart and what makes the depth claim checkable. Only this,
 * which is description, is translated.
 */
export const REGION_BRIEF: Record<string, Phrase> = {
  'sf-bay': {
    en: 'The Gate, Alcatraz, Raccoon Strait and the Berkeley flats. A surveyed coast and surveyed depths — the shoal you can see is the one you will touch.',
    ko: '금문, 알카트라즈, 라쿤 해협, 버클리 사주. 해안선도 수심도 실측이라, 화면에서 보이는 여울이 실제로 부딪히는 여울입니다.',
  },
  newport: {
    en: 'The East Passage from Prudence to the sea, Conanicut and Aquidneck either side, and the open sound beyond Brenton. A sea breeze first, and a stream that turns under it.',
    ko: '프루던스에서 바다까지 이어지는 이스트 패시지, 양옆의 코나니컷과 아퀴드넥, 브렌턴 너머의 열린 만. 시브리즈가 먼저이고, 그 아래로 조류가 방향을 바꿉니다.',
  },
  'merchant-row': {
    en: 'Stonington, the islands south of it, and the north of Isle au Haut. Twice as much of the sailable water is close aboard a shore as anywhere else here.',
    ko: '스토닝턴과 그 남쪽 섬들, 그리고 아일오호 북부. 항해 가능한 물의 두 배가 해안에 바짝 붙어 있습니다.',
  },
  'puget-sound': {
    en: 'Elliott Bay, Bainbridge and the main basin. Deep enough that the bottom never enters into it — the decision is the breeze under the bluffs.',
    ko: '엘리엇 만, 베인브리지, 그리고 본 수역. 바닥이 아예 문제가 되지 않을 만큼 깊고, 결정하는 것은 절벽 아래의 바람입니다.',
  },
  chesapeake: {
    en: 'Annapolis, the Severn and the Bay Bridge. The shallowest and the lightest — more of it is too shoal to sail than anywhere else here.',
    ko: '아나폴리스, 세번 강, 베이 브리지. 가장 얕고 바람도 가장 약하며, 항해 불가능할 만큼 얕은 물이 어디보다 많습니다.',
  },
  'buzzards-bay': {
    en: 'Woods Hole, Vineyard Sound and the Elizabeth Islands. Hard breeze and hard stream over open water — the most sailable square here.',
    ko: '우즈홀, 빈야드 해협, 엘리자베스 제도. 트인 물 위의 센 바람과 센 조류 — 항해 가능한 면적이 가장 넓습니다.',
  },
};

export const DAY_PHASE: Record<DayPhase, Phrase> = {
  night: { en: 'Night', ko: '밤' },
  dawn: { en: 'Dawn', ko: '새벽' },
  dusk: { en: 'Dusk', ko: '땅거미' },
  sunrise: { en: 'Sunrise', ko: '일출' },
  sunset: { en: 'Sunset', ko: '일몰' },
  morning: { en: 'Morning', ko: '오전' },
  afternoon: { en: 'Afternoon', ko: '오후' },
  midday: { en: 'Midday', ko: '한낮' },
};

/**
 * The instrument panel.
 *
 * The gauge labels are not in here and are not translated: BSP, VMG, TWA and
 * the rest are what a boat's instruments read anywhere in the world, and Heel,
 * Sheet, Depth and Sea sit in the same grid as them and would look wrong half
 * in one language. The glossary in the guide explains all of them. What is here
 * is everything on the panel that is a sentence rather than a dial.
 */
export const PANEL: Record<string, Phrase> = {
  instruments: { en: 'Instruments', ko: '계기판' },
  helm: { en: 'Helm', ko: '조타' },
  pilot: { en: 'Pilot', ko: '오토파일럿' },
  amidships: { en: 'amidships', ko: '중앙' },
  twistBest: { en: 'Twist · best', ko: '트위스트 · 최적' },
  fullMain: { en: 'Full main', ko: '메인 전개' },
  reef: { en: 'Reef', ko: '리프' },
  autoTrim: { en: 'AUTO TRIM', ko: '자동 트림' },
  autoReef: { en: 'AUTO REEF', ko: '자동 리프' },
  muted: { en: 'MUTED', ko: '음소거' },
  overpowered: {
    en: 'OVERPOWERED — twist off, ease or reef',
    ko: '과도한 압력 — 트위스트를 주거나, 내보내거나, 리프하세요',
  },
  lastPassage: { en: 'Last passage', ko: '최근 항해' },
  fold: { en: 'Fold away', ko: '접기' },
  unfold: { en: 'Show the instruments', ko: '계기판 펼치기' },
  foldChart: { en: 'Fold the chart away', ko: '차트 접기' },
  unfoldChart: { en: 'Show the chart', ko: '차트 펼치기' },
  polar: { en: 'Polar', ko: '폴라' },
  chart: { en: 'Chart', ko: '차트' },
  run: { en: 'run', ko: '항주' },
  notSolved: { en: 'not solved', ko: '미계산' },
  tideNoMarker: { en: 'tide — no marker', ko: '조류 — 표식 없음' },
  best: { en: 'best', ko: '최적' },
};

/** The conditions tab, and the two panels that are not the guide. */
export const SETTINGS_UI: Record<string, Phrase> = {
  meanWind: { en: 'Mean wind', ko: '평균 바람' },
  gusts: { en: 'Gusts / shifts', ko: '돌풍 / 풍향 변화' },
  /** The zero end of the gust slider, beside `slack`, `frozen` and `flat`. */
  steady: { en: 'steady', ko: '일정함' },
  seaState: { en: 'Sea state', ko: '파도' },
  /** The zero end of the sea slider, as `slack` and `frozen` are for theirs. */
  flat: { en: 'flat', ko: '잔잔함' },
  tidalDrift: { en: 'Tidal drift', ko: '조류' },
  slack: { en: 'slack', ko: '정조' },
  tideCycle: { en: 'Tidal cycle', ko: '조석 주기' },
  wildlife: { en: 'Whales and sharks', ko: '고래와 상어' },
  noWildlife: { en: 'none', ko: '없음' },
  steadyStream: { en: 'steady', ko: '일정' },
  /** The direction a current flows *towards*, which is the opposite of how wind is named. */
  set: { en: 'Set (towards)', ko: '유향 (향하는 쪽)' },
  startTime: { en: 'Start time', ko: '시작 시각' },
  timeSpeed: { en: 'Time speed', ko: '시간 배속' },
  frozen: { en: 'frozen', ko: '정지' },
  weather: { en: 'Weather', ko: '날씨' },
  evolving: { en: 'Evolving (random)', ko: '스스로 변함 (무작위)' },
  weatherNote: {
    en: 'Evolving weather is what makes two passages over the same water different. Pin it to sail one set of conditions.',
    ko: '스스로 변하는 날씨가 같은 물 위의 두 항해를 다르게 만듭니다. 한 가지 조건으로 항해하려면 고정하세요.',
  },
  headless: {
    en: 'physics core runs headless · npm run polar',
    ko: '물리 코어는 헤드리스로 동작 · npm run polar',
  },
};

/**
 * The alerts, which only appear in the states that produce them.
 *
 * They were the hardest English to find: the check that swept the rendered page
 * for text with no Hangul in it cannot see a warning that needs the boat to be
 * aground before it exists. Found by reading the code that pushes them instead.
 *
 * They were not the last, which this claimed until a batch of them turned up in
 * the menu: the islands slider and its label, the island count on the front
 * page, "open sea", "flat" at the bottom of the sea slider, the procedural
 * entry in the Where list, the set-of-the-current slider, and the note under a
 * venue. Listed rather than counted -- the first version of this said "six",
 * which was wrong twice over, and a tally is the part that goes stale.
 *
 * Some are conditional, which is part of why a sweep of one rendered screen
 * missed them: "open sea" wants the slider at zero or a stored id that no
 * longer resolves, "flat" and "steady" want their sliders at zero, the set
 * slider wants a drift above zero, the Where entry wants the select open, and
 * the venue note wants a venue -- which nothing can currently select, because
 * `VENUES` is empty.
 *
 * But not all, and that is the part worth remembering. The islands label sat
 * unconditionally on the World tab, and the island count sat on the very first
 * screen in the default state, so every Korean player was shown "4 islands"
 * before touching anything. Neither needed a sweep to find. They needed someone
 * to open the menu in Korean and read it.
 */
export const ALERT: Record<string, Phrase> = {
  aground: { en: 'AGROUND', ko: '좌초' },
  windShadow: { en: 'WIND SHADOW — sailing into a lee', ko: '바람그늘 — 그늘로 들어가는 중' },
  luffing: { en: 'LUFFING — sheet in or bear away', ko: '돛 펄럭임 — 시트를 당기거나 바람에서 벗어나세요' },
  noGo: { en: 'NO-GO ZONE', ko: '무항주 구간' },
  hullSpeed: { en: 'HULL SPEED', ko: '선체 속도 한계' },
};

/** Alerts that carry a number, so the wording has to wrap around it. */
export const shoal = (under: string): Phrase => ({
  en: `SHOAL — ${under} m under keel`,
  ko: `여울 — 용골 아래 ${under} m`,
});
export const puff = (pct: number): Phrase => ({
  en: `PUFF +${pct}%`,
  ko: `돌풍 +${pct}%`,
});
export const lull = (pct: number): Phrase => ({
  en: `LULL ${pct}%`,
  ko: `약풍 ${pct}%`,
});
export const shift = (right: boolean, deg: string): Phrase => ({
  en: `${right ? 'RIGHT' : 'LEFT'} SHIFT ${deg}°`,
  ko: `${right ? '우' : '좌'}로 풍향 변화 ${deg}°`,
});

/** The touch controls. Short, because they sit under a finger on a phone. */
export const TOUCH: Record<string, Phrase> = {
  helm: { en: 'Helm', ko: '조타' },
  centre: { en: 'Centre the helm', ko: '타 중앙으로' },
  autopilot: { en: 'Autopilot', ko: '오토파일럿' },
  camera: { en: 'Camera', ko: '카메라' },
  anchor: { en: 'Anchor', ko: '닻' },
  menu: { en: 'Menu', ko: '메뉴' },
};

export const LOG: Record<string, Phrase> = {
  empty: {
    en: 'Nothing logged yet. Click the chart to say where you are bound, sail there, and let her arrive.',
    ko: '아직 기록이 없습니다. 차트를 눌러 목적지를 정하고, 그곳까지 항해해 도착하세요.',
  },
  export: { en: 'Export', ko: '내보내기' },
  import: { en: 'Import', ko: '가져오기' },
  kept: {
    en: 'Kept in this browser only. Export it to keep it — clearing site data will take it.',
    ko: '이 브라우저에만 저장됩니다. 사이트 데이터를 지우면 사라지니, 보관하려면 내보내세요.',
  },
  /** The units on a passage row. `kn` itself stays, as every other reading does. */
  avg: { en: 'kn avg', ko: 'kn 평균' },
  max: { en: 'max', ko: '최고' },
  wind: { en: 'kn wind', ko: 'kn 바람' },
  /** Track over straight line: 1.4 is a beat, 1 is a fetch. */
  straightLine: { en: '× the straight line', ko: '× 직선거리' },
  remove: { en: 'Remove', ko: '삭제' },
  /** Shown while the store has not answered, which is distinct from an empty log. */
  reading: { en: 'Reading the logbook…', ko: '항해일지를 읽는 중…' },
  /**
   * What went wrong, in the panel rather than in a console.
   *
   * A logbook that cannot be read has to say so where someone came to read it.
   * These were the last English in the logbook and the easiest to leave: none
   * of them renders unless something has already failed.
   */
  readFailed: { en: 'The logbook could not be read.', ko: '항해일지를 읽을 수 없습니다.' },
  /**
   * Said once a session, quietly, and never as an interruption.
   *
   * Worded about this session rather than about the browser, because a refusal
   * to open is latched after one attempt and may have had a passing cause --
   * see `LogStoreUnavailable`. Telling someone their browser cannot keep a
   * logbook would be a claim this does not have the evidence for.
   */
  unavailable: {
    en: 'Passages are not being saved this session: the local logbook would not open.',
    ko: '이번 세션의 항해는 저장되지 않습니다: 로컬 항해일지를 열지 못했습니다.',
  },
  notALogbook: {
    en: 'That is not a voyage logbook, or it is a version this cannot read.',
    ko: '항해일지 파일이 아니거나, 이 버전에서 읽을 수 없는 형식입니다.',
  },
  partlySaved: { en: 'Some of that file could not be saved.', ko: '파일의 일부를 저장하지 못했습니다.' },
  fileUnreadable: { en: 'That file could not be read.', ko: '파일을 읽을 수 없습니다.' },
  removeFailed: {
    en: 'That passage could not be removed.',
    ko: '항해 기록을 삭제하지 못했습니다.',
  },
  writeFailed: {
    en: 'The passage reached its destination, but could not be saved in this browser.',
    ko: '항해가 목적지에 도착했지만 이 브라우저에 저장하지 못했습니다.',
  },
};

/** The chart card: its controls, and the line that says what the mouse does. */
export const CHART: Record<string, Phrase> = {
  escToClose: { en: 'Esc to close', ko: 'Esc로 닫기' },
  centre: { en: 'Centre on the boat', ko: '배 위치로 되돌리기' },
  openFull: { en: 'Open the full chart', ko: '전체 차트 열기' },
  closeFull: { en: 'Close the full chart', ko: '전체 차트 닫기' },
  hint: {
    en: 'Click to set where you are bound · drag to look around · double-click to recentre · right-click to clear · wheel or N for range',
    ko: '클릭해 목적지 정하기 · 드래그로 둘러보기 · 더블클릭으로 중앙 복귀 · 우클릭으로 해제 · 휠 또는 N으로 축척',
  },
};

/**
 * The passage line's advice, which is the one piece of prose that is written
 * per frame. It is assembled in a readout rather than rendered by React, so the
 * translator is captured in the component and used inside the callback --
 * `useEngineFrame` refreshes the callback every render, so switching language
 * switches this too.
 */
export const PASSAGE: Record<string, Phrase> = {
  setOff: {
    en: 'the tide is setting her off the track',
    ko: '조류가 배를 항로에서 밀어내고 있습니다',
  },
  deadUpwind: { en: 'dead upwind — work to windward', ko: '정면 맞바람 — 태킹으로 올라가세요' },
  afterDark: { en: 'arrives after dark', ko: '해 진 뒤 도착' },
};

/** `steer 043° to hold the track`, where Korean wants the verb last. */
export const steerToHold = (deg: string): Phrase => ({
  en: `steer ${deg}° to hold the track`,
  ko: `항로를 지키려면 ${deg}°로 조타`,
});

/** The World tab, where a place is chosen. */
export const WORLD: Record<string, Phrase> = {
  where: { en: 'Where', ko: '어디서' },
  islands: { en: 'Islands', ko: '섬' },
  openOcean: { en: 'Open ocean (procedural)', ko: '먼바다 (절차적 생성)' },
  /** Why a venue is worth sailing even though its coastline is not the real one. */
  venueSketch: {
    en: 'The land, depths and stream are a sketch meant to reproduce the decisions the place asks of you, not its geography.',
    ko: '육지와 수심, 조류는 스케치입니다. 그 장소의 지형이 아니라, 그곳이 요구하는 판단을 재현하기 위한 것입니다.',
  },
  surveyedTag: { en: 'surveyed', ko: '실측' },
  sketchTag: { en: 'sketch', ko: '스케치' },
  surveyedLead: { en: 'Surveyed.', ko: '실측 데이터.' },
  surveyedBody: { en: 'The coastline and the depths are', ko: '해안선과 수심의 출처는' },
  surveyedCaveat: {
    en: '. Still a simulator and not a chart: 25 m between soundings, and no tide height.',
    ko: '. 그래도 해도가 아니라 시뮬레이터입니다. 수심점 간격이 25 m이고, 조위는 반영되지 않습니다.',
  },
  regionLoading: {
    en: 'Loading the surveyed coast before you sail it…',
    ko: '출항하기 전에 실측 해안을 불러오는 중입니다…',
  },
  regionLoadFailed: {
    en: 'The surveyed coast could not be loaded. Try again before sailing.',
    ko: '실측 해안을 불러오지 못했습니다. 출항하기 전에 다시 시도하세요.',
  },
  retryRegion: { en: 'Retry', ko: '다시 시도' },
  sketchWarning: {
    en: 'Approximate, and not for navigation.',
    ko: '근사값이며, 실제 항해에 쓸 수 없습니다.',
  },
  seed: { en: 'World seed', ko: '월드 시드' },
  /**
   * A region's land is surveyed and cannot vary, so nothing the seed does is
   * about the world. Calling it the world seed there promises a different
   * coast and delivers a different Tuesday.
   */
  seedRegion: { en: 'Conditions seed', ko: '조건 시드' },
  seedNew: { en: 'New each time', ko: '매번 새로' },
  seedPinned: { en: 'Pinned', ko: '고정' },
  venueNote: {
    en: 'A venue brings its own land, breeze and tide, so the island slider stands down. The stream runs hardest in deep water and gives up in the shallows — which is where the wind gives up too.',
    ko: '베뉴는 자체 육지와 바람, 조류를 가져오므로 섬 슬라이더는 물러납니다. 조류는 깊은 물에서 가장 세고 얕은 곳에서 사그라드는데, 바람도 바로 그곳에서 사그라듭니다.',
  },
  regionNote: {
    en: 'The coast and the depths here are surveyed and never change — the seed does not move them. What it does set is the sea you sail over them: where the puffs and the shifts fall, and how the weather turns. Pin it to sail the same day twice.',
    ko: '이곳의 해안과 수심은 실측이라 절대 바뀌지 않습니다 — 시드가 그걸 옮기지는 못합니다. 시드가 정하는 것은 그 위를 지나는 바다입니다: 돌풍과 풍향 변화가 어디에 떨어지는지, 날씨가 어떻게 변해가는지. 같은 하루를 다시 항해하려면 고정하세요.',
  },
  oceanNote: {
    en: 'The ocean has no edge: islands keep coming over the horizon for as long as you sail. Their lee is flat water but almost no wind, and the shoals around them will stop you dead. Pin the seed to sail the same water twice.',
    ko: '바다에는 끝이 없습니다. 항해하는 한 섬이 계속 수평선 너머에서 나타납니다. 섬 그늘은 물결이 잔잔하지만 바람이 거의 없고, 주변 여울은 배를 그대로 세웁니다. 같은 바다를 다시 항해하려면 시드를 고정하세요.',
  },
  weatherNote2: {
    en: 'Evolving weather is what makes two passages over the same water different. A squall halfway forces a reef and changes which side of the bay pays.',
    ko: '스스로 변하는 날씨가 같은 물 위의 두 항해를 다르게 만듭니다. 도중의 스콜은 리프를 강요하고, 만의 어느 쪽이 유리한지를 바꿔 놓습니다.',
  },
};
