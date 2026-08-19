import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Crosshair, Maximize2, X } from 'lucide-react';
import { RANGES, chartPinch, createMinimap } from '@/view/minimap';
import { CRUISER } from '@/sim/config';
import { formatDistance } from '@/sim/units';
import type { Vec2 } from '@/sim/math';
import { useEngine, useEngineFrame, useReadout } from './engine-context';
import { COMPACT_COLUMN, PANEL_COLUMN, PANEL_PAD } from './viewport';
import { useT } from './i18n';
import { CHART, PANEL, callTally } from './strings';

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
const SIZE = PANEL_COLUMN - PANEL_PAD;

/**
 * Margin left round the full-screen chart, px.
 *
 * The chart is square because everything that draws it is -- the circular clip,
 * the wind lattice, the tide arrows all work off one `size`. So the full view
 * is the largest square the window will take, which on any normal window is
 * bounded by its height.
 */
const FULL_MARGIN = 72;

const fullSize = () =>
  Math.max(320, Math.min(window.innerWidth, window.innerHeight) - FULL_MARGIN * 2);

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
 *
 * `full` moves the same component into a full-screen overlay rather than
 * mounting a second one. That is what keeps the range and the pan across the
 * transition: zoom out on the big chart, close it, and the card is where you
 * left it, because it is the same chart. Two components would have been two
 * charts that happened to look alike, and two `createMinimap()` instances --
 * two raster caches, two traced outlines, and a track that only one of them
 * had been recording.
 */
export function MinimapCard({
  full,
  onFull,
  compact = false,
}: {
  full: boolean;
  onFull: (v: boolean) => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const t = useT();
  const engine = useEngine();
  /**
   * The range the chart opens at: 2.5 km, the fourth of five.
   *
   * It opened at 700 m, which is inside the coast at every one of the eleven
   * departures -- so the first thing a new voyage showed was an empty disc,
   * and the chart agreed with a horizon that was empty for a different reason
   * (see `CLEAR_DAY`). Wide enough to hold the land she can see, and it is one
   * press of [[N]] back down to pilotage.
   */
  const [range, setRange] = useState(3);
  const minimap = useRef(createMinimap());

  // Only ever read while `full`; kept in state so a resized window re-lays the
  // chart out rather than leaving it at the size the screen used to be.
  const [big, setBig] = useState(fullSize);
  useEffect(() => {
    if (!full) return;
    const onResize = () => setBig(fullSize());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [full]);

  // Smaller on a phone, where the roomy card and the polar together covered
  // 62% of the display. The full view is a tap away and loses nothing. The
  // compact size is the column's width less this card's padding, so the chart
  // and the passage line under it come out flush -- see COMPACT_COLUMN.
  const size = full ? big : compact ? COMPACT_COLUMN - 20 : SIZE;

  /**
   * Where the chart is held, or null while it follows the boat.
   *
   * `panned` mirrors it into React only so the recentre button can appear and
   * disappear -- the drawing itself reads the ref.
   */
  const pan = useRef<Vec2 | null>(null);
  /** The re-pinning the pan has been carried across. */
  const pinned = useRef(0);
  const [panned, setPanned] = useState(false);
  /**
   * Folded, on a small screen.
   *
   * The chart is the one panel worth keeping on a phone and it still covers a
   * corner of it. Folding leaves the header -- the range, and the button to
   * bring it back -- which is a strip rather than a card, and the full-screen
   * view is still one tap from there.
   */
  const [folded, setFolded] = useState(false);
  const shut = compact && folded && !full;

  const recentre = useCallback(() => {
    pan.current = null;
    setPanned(false);
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = size * dpr;
    c.height = size * dpr;
    // setTransform rather than scale, so this does not depend on the transform
    // it inherits: assigning `width` above resets it today, and a rewrite that
    // stopped doing so would make scale() compound instead of fail.
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [engine, size]);

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

  /**
   * The press that owns the pan or click: which pointer it is, where it
   * started in screen px, and where the chart was then. The id matters --
   * without it, any pointer's moves would steer whatever drag is in flight,
   * which is exactly what a stray third finger did.
   */
  const drag = useRef<{ id: number; px: number; py: number; from: Vec2; moved: boolean } | null>(
    null,
  );

  /**
   * The fingers on the chart, and the pinch they make when there are two.
   *
   * `span` is the gap between them at the last move (0 while not pinching),
   * `acc` the ratio the gesture has built towards its next step -- the rule
   * itself is `chartPinch` in minimap.ts, where it can be tested. A mouse
   * alone never makes a pair; a touch landing beside a held mouse button
   * does, and is treated like any other pair -- one rule for every pointer
   * beats a type check nobody's hand can feel.
   */
  const pinch = useRef({ pts: new Map<number, { x: number; y: number }>(), span: 0, acc: 1 });

  /*
   * The fullscreen transition replaces the canvas node -- the component's root
   * element changes from Card to a backdrop div, and React rebuilds the
   * subtree under it -- while these refs, living on the component, survive. A
   * pointer captured by the old node can never deliver another event to the
   * new one, so a finger that was down across the transition would stay in
   * the gesture forever: a phantom that pairs with every later press and
   * turns each of them into a pinch. The moment of replacement is known, so
   * the gesture dies with the node.
   */
  useEffect(() => {
    pinch.current.pts.clear();
    pinch.current.span = 0;
    drag.current = null;
  }, [full]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right-click is "clear the destination" and must not begin a drag.
    if (e.button !== 0) return;
    const g = pinch.current;
    // A third finger would jolt the span; ignored entirely, as in orbit.ts.
    if (g.pts.size >= 2) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (g.pts.size === 2) {
      // A second finger turns the pan into a pinch, and the press it grew out
      // of must not survive as a click -- two fingers are asking for a scale,
      // not ordering the boat anywhere.
      drag.current = null;
      const [a, b] = [...g.pts.values()];
      g.span = Math.hypot(a.x - b.x, a.y - b.y);
      g.acc = 1;
      return;
    }
    drag.current = {
      id: e.pointerId,
      px: e.clientX,
      py: e.clientY,
      from: pan.current ?? minimap.current.centre(),
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const g = pinch.current;
      const p = g.pts.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (g.pts.size === 2) {
        if (!p) return;
        const [a, b] = [...g.pts.values()];
        const d2 = Math.hypot(a.x - b.x, a.y - b.y);
        // Zero on either side is the degenerate pinch -- fingers on one point.
        if (g.span > 0 && d2 > 0) {
          const r = chartPinch(g.acc, d2 / g.span);
          g.acc = r.acc;
          if (r.step !== 0) {
            setRange((cur) => Math.min(Math.max(cur + r.step, 0), RANGES.length - 1));
          }
        }
        g.span = d2;
        return;
      }
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      // Metres per pixel at this range, and the chart is twice the range across.
      const perPixel = (RANGES[range] * 2) / size;
      // Dragging right moves the *chart* right, which means looking at water to
      // the west -- so the centre goes the other way. Screen y grows downward
      // and north is up, so that axis flips again.
      // Not clamped here. Where the chart may be held is a question about the
      // island window, which follows the boat, so it has to be answered every
      // frame rather than only while a finger is down -- see `createMinimap`.
      pan.current = { x: d.from.x - dx * perPixel, y: d.from.y + dy * perPixel };
      setPanned(true);
    },
    [range, size],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const g = pinch.current;
      // A pointer this never tracked -- a third finger, or one whose gesture
      // a cancel already tore down -- lifts without consequence: it must not
      // end, or worse complete as a click, a drag it was never part of.
      if (!g.pts.delete(e.pointerId)) return;
      if (g.pts.size === 1) {
        // The pinch is over but a finger stays down: it resumes as a pan,
        // anchored where it now is. `moved` starts true so lifting it later
        // is not read as a click -- it has been part of a gesture already.
        g.span = 0;
        const [[id, p]] = [...g.pts.entries()];
        drag.current = {
          id,
          px: p.x,
          py: p.y,
          from: pan.current ?? minimap.current.centre(),
          moved: true,
        };
        return;
      }
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved) return;
      // It never became a drag, so it was a click: say where she is bound.
      const r = e.currentTarget.getBoundingClientRect();
      engine.setDestination(
        minimap.current.worldAt(e.clientX - r.left, e.clientY - r.top, size, range),
      );
    },
    [engine, range, size],
  );

  // The rest of the controls are keys, so this one is too. The engine owns the
  // keyboard, so it reports the press rather than the card listening itself.
  useEffect(() => engine.onEvent((e) => e.type === 'chartRange' && cycle()), [engine, cycle]);

  // Distance run answers "how far have I actually got" as a number, which the
  // picture only answers by eye. It changes every frame, so it goes straight
  // to the DOM rather than through React.
  const runLabel = useReadout<HTMLSpanElement>((s) => formatDistance(s.run));
  // The whole cruise HUD: the chart is where the hand lives, so its header is
  // where the tally belongs. Empty text when there is nothing to say -- a
  // "calls 0" would nag every session the mode is off.
  const callsLabel = useReadout<HTMLSpanElement>((s) =>
    s.callsMade > 0 ? ` · ${t(callTally(s.callsMade))}` : '',
  );

  useEngineFrame((s) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    minimap.current.draw(ctx, size, {
      state: s.state,
      wind: s.wind,
      region: s.region,
      draft: CRUISER.draft,
      range,
      session: s.session,
      pin: s.pin,
      destination: s.destination,
      calls: s.calls,
      currents: s.currents,
      pan: pan.current,
    });
    // A hand-panned chart holds a world position of its own, so it moves with
    // the plane like the track does -- otherwise a re-pin flings the view two
    // hundred kilometres off the boat and the player has to press recentre to
    // find her again.
    if (s.pin.count !== pinned.current) {
      pinned.current = s.pin.count;
      if (pan.current) pan.current = { x: pan.current.x + s.pin.x, y: pan.current.y + s.pin.y };
    }
  });

  const chrome = (
    <Card
      className={
        full
          ? 'pointer-events-auto gap-0 p-3 backdrop-blur-md bg-card/95 shadow-lg'
          : compact
            ? 'pointer-events-auto gap-0 p-2.5 backdrop-blur-md bg-card/85'
            : 'pointer-events-auto gap-0 p-3 backdrop-blur-md bg-card/85'
      }
      style={{ width: full ? size + PANEL_PAD : compact ? COMPACT_COLUMN : PANEL_COLUMN }}
    >
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {t(PANEL.chart)}
        </span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal tabular-nums">
            {/* The gap is a class, not a space: prettier wraps this line and JSX
                eats whitespace that ends up next to a newline. */}
            {/* The distance run goes on a phone: the badge is 116 px wide
                there and wrapped the range onto three lines. The range is what
                the chart cannot be read without. */}
            {RANGES[range]} m
            {!compact && (
              <>
                {' · '}
                {t(PANEL.run)}
                <span ref={runLabel} className="ml-1" />
              </>
            )}
            <span ref={callsLabel} />
          </Badge>
          {/* Only in the full view, where there is room for it and where the
              hint is worth having: this is the one panel that takes the whole
              screen, so how to get out of it should be on it. */}
          {full && (
            <span className="text-[9px] text-muted-foreground">{t(CHART.escToClose)}</span>
          )}
          {/* Only while it is off the boat: a button that does nothing is worse
              than no button, and this one is also the only sign that the chart
              is being held rather than following. */}
          {panned && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 [&_svg]:size-3"
              aria-label={t(CHART.centre)}
              title={t(CHART.centre)}
              onClick={recentre}
            >
              <Crosshair />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 [&_svg]:size-3"
            aria-label={t(full ? CHART.closeFull : CHART.openFull)}
            title={t(full ? CHART.closeFull : CHART.openFull)}
            onClick={() => onFull(!full)}
          >
            {full ? <X /> : <Maximize2 />}
          </Button>
          {compact && !full && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 [&_svg]:size-3"
              aria-label={t(shut ? PANEL.unfoldChart : PANEL.foldChart)}
              title={t(shut ? PANEL.unfoldChart : PANEL.foldChart)}
              onClick={() => setFolded((v) => !v)}
            >
              {shut ? <ChevronDown /> : <ChevronUp />}
            </Button>
          )}
        </div>
      </div>
      {/*
        Click sets where she is bound; drag moves the chart; the wheel, a
        pinch or N changes the range. The click used to cycle the range, and that was the
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
        onPointerCancel={(e) => {
          // A cancel is the browser taking the gesture, not a finger choosing
          // to lift, so nothing is resumed off the back of it: the pan or
          // pinch in flight dies here. The other finger of a pair stays
          // tracked, so its own eventual lift is consumed as the tracked
          // no-op above rather than mistaken for someone else's click.
          if (!pinch.current.pts.delete(e.pointerId)) return;
          drag.current = null;
          pinch.current.span = 0;
        }}
        onDoubleClick={recentre}
        onContextMenu={(e) => {
          e.preventDefault();
          engine.setDestination(null);
        }}
        onWheel={onWheel}
        title={t(CHART.hint)}
        className="block cursor-crosshair touch-none"
        /*
         * `display` inline rather than a `hidden` attribute or class. The
         * canvas carries `block`, and a class beats the UA stylesheet's
         * `[hidden]` -- the chart folded in the markup and stayed on screen.
         * It also stays mounted while folded: the effect that sizes it and
         * sets the device-ratio transform is keyed on the engine and the size,
         * so a canvas that unmounted and came back would never be given
         * either, and would come back blank.
         */
        style={{ width: size, height: size, display: shut ? 'none' : 'block' }}
      />
    </Card>
  );

  if (!full) return chrome;

  /*
   * The full view is a backdrop with the same card centred on it.
   *
   * `fixed` and not a sibling of the HUD, because the HUD lives inside a
   * `pointer-events-none` layer with padding, and the chart wants the whole
   * window. The backdrop takes the click so that dropping the pointer anywhere
   * off the chart closes it, which is what every other full-screen thing does.
   *
   * The world keeps running behind it. A chart is for watching where you are
   * getting to, and one that froze the boat while you read it would be a
   * different and much less useful object.
   */
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onFull(false);
      }}
    >
      {chrome}
    </div>
  );
}
