import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RANGES, createMinimap } from '@/view/minimap';
import { CRUISER } from '@/sim/config';
import { useEngine, useEngineFrame, useReadout } from './engine-context';

const SIZE = 176;

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

  // The rest of the controls are keys, so this one is too. The engine owns the
  // keyboard, so it reports the press rather than the card listening itself.
  useEffect(() => engine.onEvent((e) => e.type === 'chartRange' && cycle()), [engine, cycle]);

  // Distance run answers "how far have I actually got" as a number, which the
  // picture only answers by eye. It changes every frame, so it goes straight
  // to the DOM rather than through React.
  const runLabel = useReadout<HTMLSpanElement>((s) =>
    s.run < 1000 ? `${s.run.toFixed(0)} m` : `${(s.run / 1000).toFixed(2)} km`,
  );

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
        Click sets where she is bound; N changes the range. The click used to
        cycle the range, and that was the right binding for a chart you glance
        at during a race. Pointing at somewhere to go is the more valuable thing
        to do to a chart now, and N already existed as the documented way to
        change scale. Right-click clears it -- a destination you cannot put down
        is an obligation, which is the one thing this is not for.
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
        title="Click to set where you are bound · right-click to clear · N for range"
        className="block cursor-crosshair"
        style={{ width: SIZE, height: SIZE }}
      />
    </Card>
  );
}
