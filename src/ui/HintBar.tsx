import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { useEngineFrame } from './engine-context';

/**
 * A single line of context at the bottom of the screen.
 *
 * The full key list lives in the menu; this is the running commentary that a
 * crew member would give you -- what the wind is doing and what to do about it.
 */
export function HintBar() {
  const ref = useRef<HTMLDivElement>(null);

  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const w = s.wind.sample(s.state.pos);
    const parts: string[] = [];

    if (s.clearance < 0) parts.push('Aground — sail off before you lose the race');
    else if (w.exposure < 0.6) parts.push('In the lee of the land — get back into clear air');
    else if (w.gust > 1.15) parts.push('Puff coming — be ready to ease or head up');
    else if (s.race.phase === 'prestart' && s.racing) parts.push('Time the line: cross on zero, not before');
    else if (Math.abs(s.diag.twa) * (180 / Math.PI) < 35) parts.push('Too close to the wind — bear away');
    else parts.push('Esc for menu and settings');

    const text = parts[0];
    if (el.textContent !== text) el.textContent = text;
  });

  return (
    <Card className="pointer-events-auto gap-0 px-3 py-1.5 backdrop-blur-md bg-card/80">
      <div ref={ref} className="text-[11px] text-muted-foreground" />
    </Card>
  );
}
