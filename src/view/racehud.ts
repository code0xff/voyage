import { RAD, wrapPi } from '../sim/math';
import { formatTime, guidance, type Course, type RaceState } from '../sim/race';
import type { BoatState, Diagnostics } from '../sim/boat';

/**
 * Race instruments.
 *
 * The hardest thing on open water is knowing where to go. The mark is hundreds
 * of metres away and hidden behind waves, so bearing, distance and layline are
 * always on screen.
 *
 * The layline is the limit beyond which you can fetch the mark without tacking
 * again. Sail past it and you have thrown distance away; fall short and you owe
 * an extra tack. It is the central judgement of an upwind leg, so it has to be
 * visualised.
 */

export interface RaceHud {
  update(
    race: RaceState,
    course: Course,
    state: BoatState,
    diag: Diagnostics,
    bestUpwindTwa: number | null,
    best: number | null,
    racing: boolean,
  ): void;
}

export function createRaceHud(root: HTMLElement): RaceHud {
  const panel = document.createElement('div');
  panel.className = 'racepanel';
  root.appendChild(panel);

  const clock = document.createElement('div');
  clock.className = 'raceclock';
  panel.appendChild(clock);

  const legEl = document.createElement('div');
  legEl.className = 'raceleg';
  panel.appendChild(legEl);

  const info = document.createElement('div');
  info.className = 'raceinfo';
  panel.appendChild(info);

  const layline = document.createElement('div');
  layline.className = 'racelay';
  panel.appendChild(layline);

  const banner = document.createElement('div');
  banner.className = 'racebanner';
  root.appendChild(banner);

  return {
    update(race, course, state, diag, bestUpwindTwa, best, racing) {
      // Hide the race instruments entirely when free sailing: meaningless
      // numbers parked in the middle of the screen are just in the way.
      panel.style.display = racing ? '' : 'none';
      if (!racing) {
        banner.textContent = '';
        banner.style.opacity = '0';
        return;
      }
      const g = guidance(race, course, state.pos);

      // Clock
      if (race.phase === 'prestart') {
        const t = -race.clock;
        clock.textContent = t > 0 ? formatTime(t) : `+${formatTime(-t)}`;
        clock.className = `raceclock ${t <= 10 && t > 0 ? 'urgent' : ''} ${t < 0 ? 'late' : ''}`;
      } else {
        clock.textContent = formatTime(race.finishTime ?? race.clock);
        clock.className = `raceclock ${race.phase === 'finished' ? 'done' : ''}`;
      }

      legEl.textContent = race.ocs
        ? 'OCS - return below the line'
        : (g?.legLabel ?? '—');
      legEl.classList.toggle('alarm', race.ocs);

      if (g && race.phase !== 'finished') {
        const brg = ((g.bearing * RAD) % 360 + 360) % 360;
        // Time to the mark at the current closing speed. This is the number
        // the whole start timing hangs on.
        const closing = Math.max(diag.speed * Math.cos(wrapPi(g.bearing - state.heading)), 0.01);
        const eta = g.distance / closing;
        info.textContent =
          `${g.distance.toFixed(0)} m \u00b7 ${brg.toFixed(0)}\u00b0 \u00b7 ` +
          (eta < 900 ? `~${formatTime(eta)}` : '\u2014');
      } else {
        info.textContent = best !== null ? `Personal best ${formatTime(best)}` : '';
      }

      // Layline check. Only meaningful while heading for the windward mark.
      const leg = course.legs[race.legIndex];
      if (g && leg?.mark?.id === 'W' && bestUpwindTwa !== null) {
        // If the bearing to the mark is further off the wind than the best
        // upwind angle, the layline is already behind us.
        const twaToMark = wrapPi(course.twd - g.bearing);
        const over = Math.abs(twaToMark) - bestUpwindTwa;
        if (over > 3 / RAD) {
          layline.textContent = `Past layline +${(over * RAD).toFixed(0)}\u00b0 - tack now and you fetch`;
          layline.className = 'racelay ok';
        } else {
          layline.textContent = `${(-over * RAD).toFixed(0)}\u00b0 to the layline`;
          layline.className = 'racelay';
        }
      } else if (g && leg?.kind === 'start' && race.phase === 'prestart') {
        const t = -race.clock;
        const closing = Math.max(diag.speed * Math.cos(wrapPi(g.bearing - state.heading)), 0.01);
        const eta = g.distance / closing;
        const slack = t - eta;
        layline.textContent =
          Math.abs(slack) < 900
            ? slack > 2
              ? `${slack.toFixed(0)}s early - burn some time`
              : slack < -2
                ? `${(-slack).toFixed(0)}s late - get moving`
                : 'On time'
            : '';
        layline.className = `racelay ${Math.abs(slack) < 2 ? 'ok' : ''}`;
      } else {
        layline.textContent = '';
        layline.className = 'racelay';
      }

      banner.textContent = race.message;
      banner.style.opacity = race.messageTimer > 0 ? '1' : '0';
    },
  };
}
