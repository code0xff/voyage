import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { DEG, RAD, wrapPi } from '@/sim/math';
import { mustTack } from '@/sim/passage';
import { formatDistance, formatDuration } from '@/sim/units';
import { useReadout } from './engine-context';
import { COMPACT_COLUMN } from './viewport';

/**
 * Where she is bound.
 *
 * Under the chart, because that is where a destination is set, where it is
 * drawn, and where it is cleared. The line is the chart's caption rather than
 * an announcement of its own.
 *
 * It used to sit in the middle of the top bar, in the slot the race clock left
 * empty, and this comment used to say that under the chart was impossible: two
 * more rows pushed the bottom of the screen off a 760 px window. That was true
 * while the chart was anchored to the bottom of the screen, where anything
 * added below it had nowhere to go. The chart now hangs from the top of the
 * right-hand column, so rows below it grow into space the layout already knows
 * is free -- measured, the column ends at 530 px of 760.
 *
 * The numbers change every frame, so they are written straight into the DOM.
 */
export function PassageBar() {
  const root = useRef<HTMLDivElement>(null);

  const line = useReadout<HTMLDivElement>((s) => {
    const p = s.passage;
    if (root.current) root.current.style.display = p ? '' : 'none';
    if (!p) return '';
    const brg = (((p.bearing * RAD) % 360) + 360) % 360;
    // No arrival at all rather than a very large one: a boat that is not closing
    // gets a dash, where four days would read as a number worth acting on.
    return (
      `${brg.toFixed(0)}°  ·  ${formatDistance(p.distance)}  ·  ` +
      `${p.eta === null ? '—' : formatDuration(p.eta)}`
    );
  });

  /**
   * The judgements underneath, which is where a passage is actually decided:
   * what to steer so the tide sets her onto the line, whether she can lay it at
   * all, and whether the light lasts. Each stays quiet with nothing to say.
   */
  const advice = useReadout<HTMLDivElement>((s) => {
    const p = s.passage;
    if (!p) return '';
    const bits: string[] = [];
    if (p.courseToSteer === null) {
      bits.push('the tide is setting her off the track');
    } else {
      const off = Math.abs(wrapPi(p.courseToSteer - p.bearing)) * RAD;
      // Only once the tide is actually bending the track. Below a degree it is
      // noise, and a course to steer that equals the bearing teaches the player
      // that the line is not worth reading.
      if (off >= 1) {
        const cts = (((p.courseToSteer * RAD) % 360) + 360) % 360;
        bits.push(`steer ${cts.toFixed(0)}° to hold the track`);
      }
    }
    if (mustTack(p, 40 * DEG)) bits.push('dead upwind — work to windward');
    if (p.eta !== null && p.eta > s.darkIn) bits.push('arrives after dark');
    return bits.join('  ·  ');
  });

  return (
    <div ref={root} className="pointer-events-none flex justify-end" style={{ display: 'none' }}>
      {/* The minimum is the column's width, so this and the chart above it are
          the same card edge on a phone rather than two that nearly line up. */}
      <Card
        style={{ minWidth: COMPACT_COLUMN }}
        className="pointer-events-auto max-w-[min(88vw,300px)] gap-0 px-3 py-1.5 text-center backdrop-blur-md bg-card/85"
      >
        <div ref={line} className="font-mono text-[15px] leading-none tabular-nums text-info" />
        <div ref={advice} className="mt-1 text-[10px] text-muted-foreground empty:hidden" />
      </Card>
    </div>
  );
}
