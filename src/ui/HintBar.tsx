import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { MAX_WAY, anchorProblem } from '@/sim/anchorage';
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

    // At anchor first: it is a state she is in, not advice about one, and while
    // she is lying to it nothing else on this list is worth saying.
    if (s.anchored) parts.push('At anchor — A to weigh');
    else if (s.clearance < 0) parts.push('Aground — sail off before you lose the race');
    else if (w.exposure < 0.6) parts.push('In the lee of the land — get back into clear air');
    else if (s.weather.state.kind === 'squall') parts.push('Squall — reef before it hits');
    else if (s.weather.state.fog > 0.5) parts.push('Thick fog — steer on the bearing readout');
    else if (s.race.phase === 'prestart' && s.racing) parts.push('Time the line: cross on zero, not before');
    // Only once she is nearly stopped, because that is when it becomes a
    // decision. Offered at six knots it would be noise on every passage.
    else if (s.anchorage?.canAnchor)
      parts.push(
        `Good holding in ${s.anchorage.depth.toFixed(0)} m${
          s.anchorage.shelter > 0.4 ? ', sheltered' : ''
        } — A to let go`,
      );
    // Deep water is included now. It was left out to stop the message following
    // the boat round an ocean that is 40 m deep everywhere -- but the condition
    // above already requires her to be nearly stopped, and a boat drifting to a
    // halt in the middle of a bay is a boat trying to anchor. Excluding it meant
    // the depth rule could never be learned by anyone who tried.
    else if (s.anchorage && s.diag.sog < MAX_WAY * 2)
      parts.push(`Nowhere to anchor: ${anchorProblem(s.anchorage)}`);
    else if (s.state.stowed) parts.push('Sails handed — 0 to set sail again, 1-4 to reef');
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
