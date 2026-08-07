import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RANGES, createMinimap } from '@/view/minimap';
import { CRUISER } from '@/sim/config';
import { formatDistance } from '@/sim/units';
import { useEngine, useEngineFrame, useReadout } from './engine-context';

const SIZE = 176;
/**
 * Wheel travel per range step, px. One mouse notch is 100 or so, so a notch is
 * a step; a trackpad takes a deliberate flick rather than a brush.
 */
const WHEEL_STEP = 50;

/**
 * The chart. Drawn straight to a canvas every frame, like the polar and the
 * telemetry graph: it changes completely between frames, and pushing that
 * through React would be a reconciler pass per frame for a picture React
 * cannot help with.
 *
 * The range is the one piece of state here that changes rarely, so it is
 * ordinary React state; `N` cycles it. Clicking the chart sets where the boat
 * is bound, which is the thing worth doing to a chart in a game about getting
 * somewhere.
 */
export function MinimapCard() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useEngine();
  const [range, setRange] = useState(1);
  const minimap = useRef(createMinimap());

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    c.getContext('2d')?.scale(dpr, dpr);
  }, [engine]);

  const cycle = useCallback(() => setRange((r) => (r + 1) % RANGES.length), []);

  /**
   * Accumulated wheel travel since the last step, px.
   *
   * One flick of a trackpad is dozens of events of a few pixels each. Stepping
   * on every one of them would run the whole range in a frame and leave the
   * chart wherever the flick happened to stop.
   */
  const wheelAcc = useRef(0);
  /**
   * The wheel zooms the chart.
   *
   * Zoom used to be on the click, and the click became "where I am bound",
   * which is worth more -- but it left `N` as the only way to change scale, and
   * a chart you are already pointing at is the one place a hand is when it
   * wants a different scale.
   *
   * Clamped rather than cycled, unlike `N`. A key press has no direction, so
   * wrapping round from the closest range to the widest is the only thing it
   * can do; a wheel has one, and wrapping would mean overshooting the end of a
   * flick throws the chart to the opposite scale.
   *
   * Wheel down widens, matching the orbit camera: both read a positive deltaY
   * as pulling back. No preventDefault -- React's wheel listener is passive,
   * and the app shell does not scroll anyway.
   */
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // deltaMode 1 is lines and 2 is pages, both far smaller numbers than
    // pixels. Scaled as orbit.ts does, so one notch means the same in both.
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    // A reversal is a new gesture, not a continuation of the last one.
    if (px * wheelAcc.current < 0) wheelAcc.current = 0;
    wheelAcc.current += px;
    if (Math.abs(wheelAcc.current) < WHEEL_STEP) return;
    const dir = Math.sign(wheelAcc.current);
    wheelAcc.current = 0;
    setRange((r) => Math.min(Math.max(r + dir, 0), RANGES.length - 1));
  }, []);

  // The rest of the controls are keys, so this one is too. The engine owns the
  // keyboard, so it reports the press rather than the card listening itself.
  useEffect(() => engine.onEvent((e) => e.type === 'chartRange' && cycle()), [engine, cycle]);

  // Distance run answers "how far have I actually got" as a number, which the
  // picture only answers by eye. It changes every frame, so it goes straight
  // to the DOM rather than through React.
  const runLabel = useReadout<HTMLSpanElement>((s) => formatDistance(s.run));

  useEngineFrame((s) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    minimap.current.draw(ctx, SIZE, {
      state: s.state,
      wind: s.wind,
      terrain: s.terrain,
      draft: CRUISER.draft,
      range,
      session: s.session,
      destination: s.destination,
      currents: s.currents,
    });
  });

  return (
    <Card className="pointer-events-auto gap-0 p-3 backdrop-blur-md bg-card/85">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Chart
        </span>
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal tabular-nums">
          {/* The gap is a class, not a space: prettier wraps this line and JSX
              eats whitespace that ends up next to a newline. */}
          {RANGES[range]} m · run
          <span ref={runLabel} className="ml-1" />
        </Badge>
      </div>
      {/*
        Click sets where she is bound; the wheel or N changes the range. The
        click used to cycle the range, and that was the right binding for a
        chart you glance at during a race. Pointing at somewhere to go is the
        more valuable thing to do to a chart now -- but handing the click over
        left no mouse-reachable zoom at all, which the wheel gives back.
        Right-click clears the destination -- one you cannot put down is an
        obligation, which is the one thing this is not for.
      */}
      <canvas
        ref={ref}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          engine.setDestination(
            minimap.current.worldAt(e.clientX - r.left, e.clientY - r.top, SIZE, range),
          );
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          engine.setDestination(null);
        }}
        onWheel={onWheel}
        title="Click to set where you are bound · right-click to clear · wheel or N for range"
        className="block cursor-crosshair"
        style={{ width: SIZE, height: SIZE }}
      />
    </Card>
  );
}
