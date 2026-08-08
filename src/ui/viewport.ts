import { useEffect, useState } from 'react';

/**
 * Two questions the interface has to ask about the device, and they are not
 * the same question.
 *
 * **How much room is there** decides the layout, and it is *asked* rather than
 * measured. Both dimensions matter, because a phone held sideways is 844 px
 * wide and 390 tall: wide enough by any width test and far too short for a
 * panel that is 505 tall. At 390x844 the polar and the chart hung 32 px off the
 * right, and at 844x390 the instruments hung 127 px off the bottom.
 *
 * A media query and not `innerHeight`, because this decision must never be
 * wrong even for a frame. Turning a phone fires `orientationchange` before the
 * window has its new size, so a measurement taken then is the size from before
 * the turn -- and reading 844 in a 390 px window does not merely set a bad
 * height, it says there is room and draws the desktop HUD, which then runs off
 * the bottom with the tiller on it. The browser evaluates a media query against
 * the viewport it actually has.
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

/**
 * And how wide it is when there is room, px.
 *
 * The polar, the chart and the passage line are one column and had this number
 * written three times over, which is a disagreement waiting for whichever is
 * edited first. Each card is this wide and each canvas is this less its own
 * padding, so they cannot drift apart.
 */
export const PANEL_COLUMN = 232;

/** A card's padding, both sides, at either width. */
export const PANEL_PAD = 24;

export interface Viewport {
  compact: boolean;
  touch: boolean;
  /** Pixels actually visible, for the page to be exactly that tall. */
  height: number;
}

/** True while the roomy layout does not fit, asked of the browser. */
const COMPACT_QUERY = `(max-width: ${NARROW - 1}px), (max-height: ${SHORT - 1}px)`;

function read(): Viewport {
  if (typeof window === 'undefined') return { compact: false, touch: false, height: 0 };
  return {
    compact: window.matchMedia?.(COMPACT_QUERY).matches ?? false,
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

export function useViewport(): Viewport {
  const [v, setV] = useState(read);
  useEffect(() => {
    /*
     * Read again after the event, not only during it.
     *
     * `orientationchange` fires before the window has its new size, so the
     * value read in the handler is the one from before the turn. Reading again
     * on the next frame and twice more shortly after costs nothing and settles
     * on whatever the browser ended up with, however many intermediate sizes
     * it went through on the way. The CSS `max-height` in App.tsx covers the
     * moment in between.
     */
    const timers: number[] = [];
    const on = () => {
      setV(read());
      timers.forEach(clearTimeout);
      timers.length = 0;
      requestAnimationFrame(() => setV(read()));
      timers.push(window.setTimeout(() => setV(read()), 180));
      timers.push(window.setTimeout(() => setV(read()), 500));
    };
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    // The address bar sliding away does not always fire a window resize on
    // iOS, and it is exactly the event this is here for.
    window.visualViewport?.addEventListener('resize', on);
    // And the query itself, which fires when the answer changes rather than
    // when something that might have changed it happened.
    const mq = window.matchMedia?.(COMPACT_QUERY);
    mq?.addEventListener('change', on);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      window.visualViewport?.removeEventListener('resize', on);
      mq?.removeEventListener('change', on);
    };
  }, []);
  return v;
}
