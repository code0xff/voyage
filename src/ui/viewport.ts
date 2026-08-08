import { useEffect, useState } from 'react';

/**
 * Two questions the interface has to ask about the device, and they are not
 * the same question.
 *
 * **How much room is there** decides the layout. Measured, and from both
 * dimensions, because a phone held sideways is 844 px wide and 390 tall: wide
 * enough by any width test and far too short for a panel that is 505 tall.
 * Measured at 390x844 the polar and the chart hung 32 px off the right, and at
 * 844x390 the instruments hung 127 px off the bottom.
 *
 * **Whether there is a finger** decides whether to draw controls at all, and
 * that is `pointer: coarse` rather than a width or a user agent. A small window
 * on a laptop should get the compact layout and keep its keyboard; a tablet in
 * a big window should get the roomy layout and still get a tiller.
 */

/** Below either of these the roomy layout does not fit. Both are measured. */
const NARROW = 760;
const SHORT = 560;

function read(): { compact: boolean; touch: boolean } {
  if (typeof window === 'undefined') return { compact: false, touch: false };
  return {
    compact: window.innerWidth < NARROW || window.innerHeight < SHORT,
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  };
}

export function useViewport(): { compact: boolean; touch: boolean } {
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return v;
}
