import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { drawPolar } from '@/view/polarplot';
import { RAD } from '@/sim/math';
import { msToKnots } from '@/sim/units';
import { useEngine, useEngineFrame, useReadout } from './engine-context';

const SIZE = 208;

/**
 * The polar diagram. It is the single most useful thing on screen once you can
 * sail at all: it shows what the boat is capable of at this wind angle, so the
 * gap between the marker and the curve is exactly how much you are leaving out
 * there.
 */
export function PolarCard() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useEngine();

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    c.getContext('2d')?.scale(dpr, dpr);
  }, [engine]);

  useEngineFrame((s) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    drawPolar(ctx, SIZE, SIZE, s.polar, s.diag, s.polarBusy);
  });

  const caption = useReadout<HTMLSpanElement>((s) =>
    s.polar
      ? `${msToKnots(s.polar.tws).toFixed(0)} kn · best ${
          s.polar.bestUpwind ? (s.polar.bestUpwind.twa * RAD).toFixed(0) : '--'
        }°`
      : 'not solved',
  );

  return (
    <Card className="pointer-events-auto w-[232px] gap-0 p-3 backdrop-blur-md bg-card/85">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Polar
        </span>
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal">
          <span ref={caption} />
        </Badge>
      </div>
      <canvas ref={ref} className="block" style={{ width: SIZE, height: SIZE }} />
    </Card>
  );
}
