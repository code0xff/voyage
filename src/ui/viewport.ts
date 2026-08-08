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
 *
 * **How tall the page may be** is the one that has to be measured rather than
 * asked for in CSS. `100vh` on a phone is the height with the browser's own
 * chrome hidden -- the *largest* the viewport can become -- so a page sized to
 * it runs under the address bar, and everything at the bottom is off the screen
 * until you scroll, which this app does not do. Padding cannot fix that: the
 * space is added inside a box that is already taller than the window.
 *
 * `visualViewport.height` is what is actually visible now, address bar and all,
 * and it is also what shrinks when a keyboard opens. `innerHeight` is the
 * fallback and is right everywhere else.
 */

/** Below either of these the roomy layout does not fit. Both are measured. */
const NARROW = 760;
const SHORT = 560;

/**
 * How wide the right-hand column is on a compact screen, px.
 *
 * One number because two cards have to agree on it. The column is as wide as
 * its widest child, so the passage line -- which needs about this much to say
 * "1° · 9.10 km · 47m" on one line -- sets it, and a chart narrower than that
 * simply leaves the rest of the column empty. Matching it costs no screen at
 * all and stops the two reading as a mistake, which is the same reason the
 * chart and the polar were matched on a desktop.
 *
 * Chosen at 190 rather than wider: at 220 the column squeezed the phone's
 * instrument strip from two rows to four, 60 px tall to 216.
 */
export const COMPACT_COLUMN = 190;

export interface Viewport {
  compact: boolean;
  touch: boolean;
  /** Pixels actually visible, for the page to be exactly that tall. */
  height: number;
}

function read(): Viewport {
  if (typeof window === 'undefined') return { compact: false, touch: false, height: 0 };
  const height = window.visualViewport?.height ?? window.innerHeight;
  return {
    compact: window.innerWidth < NARROW || height < SHORT,
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    height,
  };
}

export function useViewport(): Viewport {
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    // The address bar sliding away does not always fire a window resize on
    // iOS, and it is exactly the event this is here for.
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);
  return v;
}
