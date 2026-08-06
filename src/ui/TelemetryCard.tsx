import { useEffect, useRef } from 'react';
import { drawTelemetry } from '@/view/telemetry';
import { useEngine, useEngineFrame } from './engine-context';
import { token } from './tokens';

/** Rolling BSP / VMG / heel / wind trace. Canvas, redrawn from the frame callback. */
export function TelemetryCard() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useEngine();

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = 244 * dpr;
    c.height = 62 * dpr;
    c.getContext('2d')?.scale(dpr, dpr);
  }, [engine]);

  useEngineFrame((s) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    drawTelemetry(ctx, s.telemetry, 244, 62, token('--border'));
  });

  return (
    <div className="mt-2 rounded-md border border-border bg-background/60">
      <canvas ref={ref} className="block h-[62px] w-full" />
    </div>
  );
}
