import type { Settings } from '../settings';
import { formatTime, type Course, type RaceState } from '../sim/race';

/**
 * Menu, settings and results.
 *
 * Nobody opening this for the first time should have to start by wondering
 * which key does anything. The first screen has to say what the game is and how
 * to begin.
 */

export type MenuAction = 'race' | 'freesail' | 'resume';

export interface Menu {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Show the results after a race finishes. */
  showResult(race: RaceState, course: Course, best: number | null, isBest: boolean): void;
  onAction(fn: (a: MenuAction) => void): void;
  onSettingsChange(fn: () => void): void;
}

function row(parent: HTMLElement, label: string): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'setrow';
  const l = document.createElement('label');
  l.textContent = label;
  r.appendChild(l);
  parent.appendChild(r);
  return r;
}

function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  get: () => number,
  set: (v: number) => void,
  fmt: (v: number) => string,
  onChange: () => void,
): () => void {
  const r = row(parent, label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const val = document.createElement('span');
  val.className = 'setval';
  r.append(input, val);

  const sync = () => {
    input.value = String(get());
    val.textContent = fmt(get());
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    val.textContent = fmt(get());
    onChange();
  });
  sync();
  return sync;
}

export function createMenu(root: HTMLElement, settings: Settings): Menu {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  root.appendChild(overlay);

  const card = document.createElement('div');
  card.className = 'menucard';
  overlay.appendChild(card);

  const title = document.createElement('h1');
  title.textContent = 'voyage';
  card.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'menusub';
  sub.textContent =
    'A sailing simulator that actually computes apparent wind, sail lift, keel ' +
    'side force and wave-making resistance. The wind differs from place to ' +
    'place, and the waves move the boat.';
  card.appendChild(sub);

  const result = document.createElement('div');
  result.className = 'menuresult';
  card.appendChild(result);

  const buttons = document.createElement('div');
  buttons.className = 'menubtns';
  card.appendChild(buttons);

  const actions: ((a: MenuAction) => void)[] = [];
  const changes: (() => void)[] = [];
  const fire = (a: MenuAction) => actions.forEach((f) => f(a));
  const changed = () => changes.forEach((f) => f());

  const mkBtn = (label: string, action: MenuAction, primary = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = primary ? 'primary' : '';
    b.addEventListener('click', () => {
      fire(action);
      api.close();
    });
    buttons.appendChild(b);
    return b;
  };
  const raceBtn = mkBtn('Start race', 'race', true);
  mkBtn('Free sail', 'freesail');
  const resumeBtn = mkBtn('Resume', 'resume');

  const setDiv = document.createElement('div');
  setDiv.className = 'settings';
  card.appendChild(setDiv);

  const syncs: (() => void)[] = [];
  syncs.push(
    slider(setDiv, 'Mean wind', 3, 40, 1, () => settings.windKnots, (v) => (settings.windKnots = v), (v) => `${v} kn`, changed),
    slider(setDiv, 'Gusts / shifts', 0, 1, 0.05, () => settings.gustiness, (v) => (settings.gustiness = v), (v) => (v === 0 ? 'steady' : `${Math.round(v * 100)}%`), changed),
    slider(setDiv, 'Sea state', 0, 2, 0.1, () => settings.seaScale, (v) => (settings.seaScale = v), (v) => (v === 0 ? 'flat' : `${v.toFixed(1)}x`), changed),
    slider(setDiv, 'Leg length', 150, 1000, 10, () => settings.legLength, (v) => (settings.legLength = v), (v) => `${v} m`, changed),
    slider(setDiv, 'Laps', 1, 5, 1, () => settings.laps, (v) => (settings.laps = v), (v) => `${v}`, changed),
    slider(setDiv, 'Countdown', 5, 180, 5, () => settings.countdown, (v) => (settings.countdown = v), (v) => `${v}s`, changed),
  );

  const hint = document.createElement('p');
  hint.className = 'menuhint';
  hint.innerHTML =
    'Esc toggles this screen &middot; left/right arrows steer &middot; T auto-trim ' +
    '&middot; Y auto-reef &middot; M sound<br>' +
    '<b>You cannot sail straight at the windward mark.</b> Zig-zag up to it at ' +
    'about 45 degrees to the wind (tacking).';
  card.appendChild(hint);

  let open = false;
  const api: Menu = {
    get isOpen() {
      return open;
    },
    open() {
      open = true;
      overlay.classList.add('show');
      syncs.forEach((f) => f());
      resumeBtn.style.display = '';
      raceBtn.focus();
    },
    close() {
      open = false;
      overlay.classList.remove('show');
      result.innerHTML = '';
    },
    toggle() {
      if (open) api.close();
      else api.open();
    },
    showResult(race, course, best, isBest) {
      const rows: string[] = [];
      rows.push(`<div class="rtime">${formatTime(race.finishTime ?? 0)}</div>`);
      if (isBest) rows.push('<div class="rbest">New personal best - ghost updated</div>');
      else if (best !== null) {
        const d = (race.finishTime ?? 0) - best;
        rows.push(
          `<div class="rdelta">Personal best ${formatTime(best)} &middot; ${d >= 0 ? '+' : ''}${d.toFixed(1)}s</div>`,
        );
      }
      // Splits. Seeing which leg cost you the time is what tells you what to fix.
      const labels = course.legs.map((l) => l.label);
      const splitRows = race.splits
        .map((t, i) => {
          const prev = i === 0 ? 0 : race.splits[i - 1];
          return `<div class="rsplit"><span>${labels[i] ?? ''}</span><span>${formatTime(t)}</span><span class="rlap">+${(t - prev).toFixed(1)}s</span></div>`;
        })
        .join('');
      rows.push(`<div class="rsplits">${splitRows}</div>`);
      result.innerHTML = rows.join('');
      api.open();
    },
    onAction(fn) {
      actions.push(fn);
    },
    onSettingsChange(fn) {
      changes.push(fn);
    },
  };

  // On first load there is nothing to resume.
  resumeBtn.style.display = 'none';
  open = true;
  overlay.classList.add('show');

  return api;
}
