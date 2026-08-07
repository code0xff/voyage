import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Crosshair } from 'lucide-react';
import { RANGES, createMinimap } from '@/view/minimap';
import { CRUISER } from '@/sim/config';
import { formatDistance } from '@/sim/units';
import type { Vec2 } from '@/sim/math';
import { useEngine, useEngineFrame, useReadout } from './engine-context';

/**
 * The chart, px. One size, matching the polar exactly -- 208 in a 232 px card.
 *
 * There used to be a second, 320 px, on a toggle. It was not worth it. A bigger
 * picture of the same chart is not more chart: the range control is what
 * answers "let me actually look at this", and it was already on the wheel, on
 * `N`, and on a drag to pan. The toggle only made the card fight the layout --
 * enlarged and placed bottom-right it ran 125 px off the bottom of a 760 px
 * window, which is the shortest this game is played on.
 *
 * Matching the polar rather than picking a number: the two share a column, and
 * two reference panels of different widths down the right-hand side read as a
 * mistake rather than as a choice.
 */
const SIZE = 208;

/**
 * Wheel travel per range step, px. One mouse notch is 100 or so, so a notch is
 * a step; a trackpad takes a deliberate flick rather than a brush.
 */
const WHEEL_STEP = 50;
/**
 * A press that moves less than this is a click, px.
 *
 * The chart has to tell "point at somewhere to go" from "drag the chart about",
 * and a mouse always moves a pixel or two between down and up. Below this it is
 * a click; at or above it, the destination is never set -- letting go after a
 * drag must not also order the boat to the last place the pointer happened to
 * be over.
 */
const DRAG_SLOP = 4;

/**
 * The chart. Drawn straight to a canvas every frame, like the polar and the
 * telemetry graph: it changes completely between frames, and pushing that
 * through React would be a reconciler pass per frame for a picture React
 * cannot help with.
 *
 * The range is the one piece of state here that changes rarely, so it is
 * ordinary React state. The pan is a ref: it changes on every pointer move
 * while a drag is running, and the canvas is redrawn every frame anyway, so
 * putting it through the reconciler would buy nothing.
 */
export function MinimapCard() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useEngine();
  const [range, setRange] = useState(1);
  const minimap = useRef(createMinimap());

  /**
   * Where the chart is held, or null while it follows the boat.
   *
   * `panned` mirrors it into React only so the recentre button can appear and
   * disappear -- the drawing itself reads the ref.
   */
  const pan = useRef<Vec2 | null>(null);
  const [panned, setPanned] = useState(false);

  const recentre = useCallback(() => {
    pan.current = null;
    setPanned(false);
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    // setTransform rather than scale, so this does not depend on the transform
    // it inherits: assigning `width` above resets it today, and a rewrite that
    // stopped doing so would make scale() compound instead of fail.
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  /** Where the press started, in screen px, and where the chart was then. */
  const drag = useRef<{ px: number; py: number; from: Vec2; moved: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right-click is "clear the destination" and must not begin a drag.
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      from: pan.current ?? minimap.current.centre(),
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      // Metres per pixel at this range, and the chart is twice the range across.
      const perPixel = (RANGES[range] * 2) / SIZE;
      // Dragging right moves the *chart* right, which means looking at water to
      // the west -- so the centre goes the other way. Screen y grows downward
      // and north is up, so that axis flips again.
      pan.current = { x: d.from.x - dx * perPixel, y: d.from.y + dy * perPixel };
      setPanned(true);
    },
    [range],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved) return;
      // It never became a drag, so it was a click: say where she is bound.
      const r = e.currentTarget.getBoundingClientRect();
      engine.setDestination(
        minimap.current.worldAt(e.clientX - r.left, e.clientY - r.top, SIZE, range),
      );
    },
    [engine, range],
  );

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
      region: s.region,
      draft: CRUISER.draft,
      range,
      session: s.session,
      destination: s.destination,
      currents: s.currents,
      pan: pan.current,
    });
  });

  return (
    <Card className="pointer-events-auto w-[232px] gap-0 p-3 backdrop-blur-md bg-card/85">
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Chart
        </span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal tabular-nums">
            {/* The gap is a class, not a space: prettier wraps this line and JSX
                eats whitespace that ends up next to a newline. */}
            {RANGES[range]} m · run
            <span ref={runLabel} className="ml-1" />
          </Badge>
          {/* Only while it is off the boat: a button that does nothing is worse
              than no button, and this one is also the only sign that the chart
              is being held rather than following. */}
          {panned && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 [&_svg]:size-3"
              aria-label="Centre on the boat"
              title="Centre on the boat"
              onClick={recentre}
            >
              <Crosshair />
            </Button>
          )}
        </div>
      </div>
      {/*
        Click sets where she is bound; drag moves the chart; the wheel or N
        changes the range. The click used to cycle the range, and that was the
        right binding for a chart you glance at during a race. Pointing at
        somewhere to go is the more valuable thing to do to a chart now -- but
        handing the click over left no mouse-reachable zoom at all, which the
        wheel gives back. Right-click clears the destination -- one you cannot
        put down is an obligation, which is the one thing this is not for.
      */}
      <canvas
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={recentre}
        onContextMenu={(e) => {
          e.preventDefault();
          engine.setDestination(null);
        }}
        onWheel={onWheel}
        title="Click to set where you are bound · drag to look around · double-click to recentre · right-click to clear · wheel or N for range"
        className="block cursor-crosshair touch-none"
        style={{ width: SIZE, height: SIZE }}
      />
    </Card>
  );
}
