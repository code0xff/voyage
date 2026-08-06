import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { RAD, wrapPi } from '@/sim/math';
import { formatTime, guidance } from '@/sim/race';
import { useEngineFrame, useReadout } from './engine-context';

/**
 * Race instruments.
 *
 * The hardest thing on open water is knowing where to go: the mark is hundreds
 * of metres away and hidden behind waves. Bearing, distance and time-to-go are
 * always here, and so is the layline -- the limit past which you can fetch the
 * mark without tacking again, which is the central judgement of an upwind leg.
 */
export function RaceBar() {
  const root = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLDivElement>(null);

  const leg = useReadout<HTMLSpanElement>((s) =>
    s.race.ocs ? 'OCS — return below the line' : (guidance(s.race, s.course, s.state.pos)?.legLabel ?? '—'),
  );

  const info = useReadout<HTMLSpanElement>((s) => {
    const g = guidance(s.race, s.course, s.state.pos);
    if (!g || !s.diag) return '';
    if (s.race.phase === 'finished') {
      return s.best !== null ? `personal best ${formatTime(s.best)}` : '';
    }
    const brg = (((g.bearing * RAD) % 360) + 360) % 360;
    const closing = Math.max(s.diag.speed * Math.cos(wrapPi(g.bearing - s.state.heading)), 0.01);
    const eta = g.distance / closing;
    return `${g.distance.toFixed(0)} m · ${brg.toFixed(0)}° · ${eta < 900 ? `~${formatTime(eta)}` : '—'}`;
  });

  const advice = useRef<HTMLSpanElement>(null);

  useEngineFrame((s) => {
    if (root.current) root.current.style.display = s.racing ? '' : 'none';
    if (!s.racing || !s.diag) return;

    // Clock
    const el = clock.current;
    if (el) {
      let text: string;
      let tone: string;
      if (s.race.phase === 'prestart') {
        const t = -s.race.clock;
        text = t > 0 ? formatTime(t) : `+${formatTime(-t)}`;
        tone = t < 0 ? 'text-destructive' : t <= 10 ? 'text-warning' : '';
      } else {
        text = formatTime(s.race.finishTime ?? s.race.clock);
        tone = s.race.phase === 'finished' ? 'text-success' : '';
      }
      if (el.textContent !== text) el.textContent = text;
      const cls = cn(
        'font-mono text-[26px] leading-none tabular-nums tracking-tight',
        tone || 'text-foreground',
      );
      if (el.className !== cls) el.className = cls;
    }

    // Layline / start timing advice
    const a = advice.current;
    if (!a) return;
    const g = guidance(s.race, s.course, s.state.pos);
    const currentLeg = s.course.legs[s.race.legIndex];
    let text = '';
    let tone = 'text-muted-foreground';

    // The layline is the polar's best upwind angle, and that angle moves with
    // wind speed -- 45 degrees in twelve knots, 55 in thirty-five. The polar is
    // only re-solved on demand, and re-solving costs 230 ms on the main thread,
    // which is not a price worth paying every time a front comes through. So
    // when the wind has left the polar behind, say nothing rather than give a
    // number that is quietly ten degrees out. `P` re-solves it.
    const polarStale =
      !!s.polar && Math.abs(s.wind.baseTws - s.polar.tws) > 0.15 * s.polar.tws;

    if (g && currentLeg?.mark?.id === 'W' && s.polar?.bestUpwind && !polarStale) {
      // If the bearing to the mark is further off the wind than the best upwind
      // angle, the layline is already behind us.
      const twaToMark = wrapPi(s.course.twd - g.bearing);
      const over = Math.abs(twaToMark) - s.polar.bestUpwind.twa;
      if (over > 3 / RAD) {
        text = `past layline +${(over * RAD).toFixed(0)}° — tack and you fetch`;
        tone = 'text-warning';
      } else {
        text = `${(-over * RAD).toFixed(0)}° to the layline`;
      }
    } else if (g && currentLeg?.kind === 'start' && s.race.phase === 'prestart') {
      const t = -s.race.clock;
      const closing = Math.max(s.diag.speed * Math.cos(wrapPi(g.bearing - s.state.heading)), 0.01);
      const slack = t - g.distance / closing;
      if (Math.abs(slack) < 900) {
        if (slack > 2) text = `${slack.toFixed(0)}s early — burn time`;
        else if (slack < -2) text = `${(-slack).toFixed(0)}s late — get moving`;
        else {
          text = 'on time';
          tone = 'text-success';
        }
      }
    }
    if (a.textContent !== text) a.textContent = text;
    if (a.className !== tone) a.className = tone;
  });

  const banner = useRef<HTMLDivElement>(null);
  useEngineFrame((s) => {
    const el = banner.current;
    if (!el) return;
    const text = s.racing ? s.race.message : '';
    if (el.textContent !== text) el.textContent = text;
    el.style.opacity = s.race.messageTimer > 0 && s.racing ? '1' : '0';
  });

  return (
    <>
      <div ref={root} className="pointer-events-none flex justify-center">
        <Card className="pointer-events-auto min-w-[240px] gap-0 px-4 py-2.5 text-center backdrop-blur-md bg-card/85">
          <div ref={clock} className="font-mono text-[26px] leading-none tabular-nums">
            0:00.0
          </div>
          <div className="mt-1 text-[11px] text-info">
            <span ref={leg} />
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            <span ref={info} />
          </div>
          <div className="mt-0.5 min-h-[13px] text-[10px]">
            <span ref={advice} className="text-muted-foreground" />
          </div>
        </Card>
      </div>

      <div
        ref={banner}
        className="pointer-events-none fixed left-1/2 top-[44%] -translate-x-1/2 rounded-lg border border-border bg-card/90 px-5 py-2.5 text-sm opacity-0 backdrop-blur-md transition-opacity duration-300"
      />
    </>
  );
}
