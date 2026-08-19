import { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { MAX_WAY, anchorProblem } from '@/sim/anchorage';
import { useEngineFrame } from './engine-context';
import { useT } from './i18n';
import { ANCHOR_PROBLEM, HINT, flareWait, holding, nowhereToAnchor, questDone } from './strings';
import { useLang } from './i18n';

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
  const lang = useLang();

  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || !s.diag) return;
    const w = s.wind.sample(s.state.pos);
    const parts: string[] = [];

    // At anchor first: it is a state she is in, not advice about one, and while
    // she is lying to it nothing else on this list is worth saying.
    if (s.clearance < 0) parts.push(t(HINT.aground));
    // A quest just completed. Above everything but the ground under her,
    // because it is the only notice of it there is: the record is written at
    // once, but nothing else on screen says so, and the moment it names -- the
    // wind, the sea, the hour -- is happening now and not when the menu is
    // next opened. Below being aground, which is not a moment to celebrate in.
    else if (s.questDone)
      parts.push(t(questDone(s.questDone.name[lang] ?? s.questDone.name.en ?? '')));
    else if (s.anchored) parts.push(t(HINT.anchored));
    // A direct answer to a press outranks ambient advice for the three
    // seconds it is on: the player just asked the boat something.
    else if (s.flareWait != null) parts.push(t(flareWait(s.flareWait)));
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
