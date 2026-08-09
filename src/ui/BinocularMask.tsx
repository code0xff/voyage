import { useRef } from 'react';
import { useEngineFrame } from './engine-context';

/**
 * The surround that says you are looking through something.
 *
 * Without it a magnified view is indistinguishable from a game that has
 * quietly changed its field of view, and the player has no way to tell why the
 * horizon suddenly reacts to every wave. The mask is the whole of the
 * explanation: a dark edge, and a field you are looking down.
 *
 * One soft-edged circle rather than the two overlapping ones of the cliche.
 * Real binoculars merge into a single field for anyone whose eyes are set to
 * them, and the figure-of-eight is a thing films use to be legible in a
 * thumbnail, not a thing you see.
 *
 * Written straight to the DOM off the frame callback rather than held in React
 * state. It changes rarely, but the only place to learn that it changed is the
 * snapshot, and subscribing a component to that would re-render this tree at
 * 60 Hz to set one opacity -- exactly what the engine-context exists to avoid.
 */
export function BinocularMask() {
  const ref = useRef<HTMLDivElement>(null);
  const up = useRef(false);

  useEngineFrame((s) => {
    const el = ref.current;
    if (!el || s.binoculars === up.current) return;
    up.current = s.binoculars;
    el.style.opacity = s.binoculars ? '1' : '0';
  });

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-200"
      style={{
        // Transparent well inside the field, opaque outside it. The stop at 46%
        // is short of the screen's narrow half so the edge is visible on a
        // phone in portrait as well as on a desktop window.
        background:
          'radial-gradient(circle at 50% 50%, transparent 0%, transparent 34%, rgba(0,0,0,0.55) 46%, rgba(0,0,0,0.94) 62%, #000 78%)',
      }}
    />
  );
}
