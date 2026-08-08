import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { MAX_WAY, anchorProblem } from '@/sim/anchorage';
import { useEngineFrame } from './engine-context';
import { useT } from './i18n';
import { ANCHOR_PROBLEM, HINT, holding, nowhereToAnchor } from './strings';

/**
 * A single line of context at the bottom of the screen.
 *
 * The full key list lives in the menu; this is the running commentary that a
 * crew member would give you -- what the wind is doing and what to do about it.
 */
export function HintBar() {
  const ref = useRef<HTMLDivElement>(null);
  // Read here and used inside the frame callback. `useEngineFrame` keeps the
  // latest closure in a ref, so switching language re-renders and the next
  // frame writes the new wording -- no need to force the line to change first.
  const t = useT();

  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const w = s.wind.sample(s.state.pos);
    const parts: string[] = [];

    // At anchor first: it is a state she is in, not advice about one, and while
    // she is lying to it nothing else on this list is worth saying.
    if (s.anchored) parts.push(t(HINT.anchored));
    else if (s.clearance < 0) parts.push(t(HINT.aground));
    else if (w.exposure < 0.6) parts.push(t(HINT.lee));
    else if (s.weather.state.kind === 'squall') parts.push(t(HINT.squall));
    else if (s.weather.state.fog > 0.5) parts.push(t(HINT.fog));
    // Only once she is nearly stopped, because that is when it becomes a
    // decision. Offered at six knots it would be noise on every passage.
    else if (s.anchorage?.canAnchor)
      parts.push(t(holding(s.anchorage.depth.toFixed(0), s.anchorage.shelter > 0.4)));
    // Deep water is included now. It was left out to stop the message following
    // the boat round an ocean that is 40 m deep everywhere -- but the condition
    // above already requires her to be nearly stopped, and a boat drifting to a
    // halt in the middle of a bay is a boat trying to anchor. Excluding it meant
    // the depth rule could never be learned by anyone who tried.
    else if (s.anchorage && s.diag.sog < MAX_WAY * 2) {
      const why = anchorProblem(s.anchorage);
      if (why) parts.push(t(nowhereToAnchor(ANCHOR_PROBLEM[why])));
    } else if (s.state.stowed) parts.push(t(HINT.stowed));
    else if (Math.abs(s.diag.twa) * (180 / Math.PI) < 35) parts.push(t(HINT.pinching));
    else parts.push(t(HINT.menu));

    const text = parts[0] ?? t(HINT.menu);
    if (el.textContent !== text) el.textContent = text;
  });

  return (
    <Card className="pointer-events-auto gap-0 px-3 py-1.5 backdrop-blur-md bg-card/80">
      <div ref={ref} className="text-[11px] text-muted-foreground" />
    </Card>
  );
}
