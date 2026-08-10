import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { DEG, RAD, wrapPi } from '@/sim/math';
import { mustTack } from '@/sim/passage';
import { formatDistance, formatDuration } from '@/sim/units';
import { useReadout } from './engine-context';
import { useT } from './i18n';
import { PASSAGE, steerToHold } from './strings';
import { COMPACT_COLUMN, PANEL_COLUMN, useViewport } from './viewport';

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
  const { compact } = useViewport();
  // Safe to capture for a per-frame readout: `useEngineFrame` replaces the
  // callback on every render, so a language change takes effect on the next one
  // rather than leaving this line in the language it was mounted in.
  const t = useT();

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
      bits.push(t(PASSAGE.setOff));
    } else {
      const off = Math.abs(wrapPi(p.courseToSteer - p.bearing)) * RAD;
      // Only once the tide is actually bending the track. Below a degree it is
      // noise, and a course to steer that equals the bearing teaches the player
      // that the line is not worth reading.
      if (off >= 1) {
        const cts = (((p.courseToSteer * RAD) % 360) + 360) % 360;
        bits.push(t(steerToHold(cts.toFixed(0))));
      }
    }
    if (mustTack(p, 40 * DEG)) bits.push(t(PASSAGE.deadUpwind));
    if (p.eta !== null && p.eta > s.darkIn) bits.push(t(PASSAGE.afterDark));
    return bits.join('  ·  ');
  });

  return (
    <div ref={root} className="pointer-events-none flex justify-end" style={{ display: 'none' }}>
      {/*
        The column's width, fixed, not a minimum.

        Left to its content this card was as wide as whatever it happened to be
        saying -- `1°` against `352°`, an arrival time against a dash, the
        advice line present or absent -- so it breathed in and out beside a
        chart that does not, several times a minute. That is the same fault the
        instrument strip had: a layout that is a function of the data. It is
        the column's width now at both sizes, and the text wraps inside it.
      */}
      <Card
        style={{ width: compact ? COMPACT_COLUMN : PANEL_COLUMN }}
        className="pointer-events-auto gap-0 px-3 py-1.5 text-center backdrop-blur-md bg-card/85"
      >
        <div ref={line} className="font-mono text-[15px] leading-none tabular-nums text-info" />
        <div ref={advice} className="mt-1 text-[10px] text-muted-foreground empty:hidden" />
      </Card>
    </div>
  );
}
