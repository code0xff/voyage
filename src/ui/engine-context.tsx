import { createContext, useContext, useEffect, useRef } from 'react';
import type { Engine, Snapshot } from '@/engine';

/**
 * The bridge between the imperative engine and React.
 *
 * Deliberately *not* React state. The instruments update at 60 Hz, and pushing
 * a dozen numbers through the reconciler that often would burn frame budget for
 * nothing. Components subscribe to the per-frame callback and write straight
 * into a DOM node they own; React only ever renders the structure around them.
 */

const EngineContext = createContext<Engine | null>(null);

export const EngineProvider = EngineContext.Provider;

export function useEngine(): Engine {
  const e = useContext(EngineContext);
  if (!e) throw new Error('useEngine must be used inside <EngineProvider>');
  return e;
}

/** Run a callback once per rendered frame with the live snapshot. */
export function useEngineFrame(fn: (s: Snapshot) => void): void {
  const engine = useEngine();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => engine.onFrame((s) => ref.current(s)), [engine]);
}

/**
 * Bind a text node to a value derived from the snapshot.
 * Writes only on change, so the browser is not asked to re-layout every frame.
 */
export function useReadout<T extends HTMLElement = HTMLSpanElement>(
  fn: (s: Snapshot) => string,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el) return;
    const next = fn(s);
    if (el.textContent !== next) el.textContent = next;
  });
  return ref;
}
