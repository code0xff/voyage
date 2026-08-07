import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { DEG, RAD, wrapPi } from '@/sim/math';
import { mustTack } from '@/sim/passage';
import { formatDistance, formatDuration } from '@/sim/units';
import { useReadout } from './engine-context';

/**
 * Where she is bound.
 *
 * Sits in the same slot as the race clock, which is empty whenever there is no
 * race — and having somewhere to be is what free sailing looks like once it is
 * a passage rather than a wander. It lives here rather than under the chart
 * because the chart card had no room: two more rows pushed the bottom of the
 * screen off a 760 px window.
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
    <div ref={root} className="pointer-events-none flex justify-center" style={{ display: 'none' }}>
      <Card className="pointer-events-auto min-w-[240px] gap-0 px-4 py-2 text-center backdrop-blur-md bg-card/85">
        <div ref={line} className="font-mono text-[15px] leading-none tabular-nums text-info" />
        <div ref={advice} className="mt-1 text-[10px] text-muted-foreground empty:hidden" />
      </Card>
    </div>
  );
}
