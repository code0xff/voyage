/**
 * The browser half of the polar solver: a worker, and the rule for which answer
 * to believe.
 *
 * Separate from `polar-worker.ts` so that the engine imports a plain function
 * rather than a `new Worker(...)`, and separate from `src/sim` because a worker
 * is a browser API and the physics core may not touch one.
 */
import type { BoatConfig, Environment } from './sim/config';
import type { Polar } from './sim/polar';
import type { PolarReply, PolarRequest } from './polar-worker';

export interface PolarSolver {
  /** Ask for a polar. A later request supersedes any still in flight. */
  solve(cfg: BoatConfig, env: Environment): void;
  dispose(): void;
}

/**
 * A solver, or null where the platform has no workers.
 *
 * Null rather than a synchronous fallback, and the reason is that the fallback
 * would be the bug this file exists to remove: a solve on the calling thread,
 * 1.2 seconds long, in whatever environment was too old to have a worker. The
 * caller leaves `polar` null instead, which every readout already handles
 * because a polar is null until the first one has been solved anyway.
 *
 * It is also what makes this inert under test, where `Worker` is not defined --
 * matching the old behaviour there exactly, since the test's `window` shim
 * stubs `setTimeout` to a no-op and the polar was never solved either.
 */
export function createPolarSolver(onSolved: (polar: Polar) => void): PolarSolver | null {
  if (typeof Worker === 'undefined') return null;

  const worker = new Worker(new URL('./polar-worker.ts', import.meta.url), { type: 'module' });
  let latest = 0;

  worker.onmessage = (event: MessageEvent<PolarReply>) => {
    // Only the newest. Requests can overlap -- a solve is slow and the wind can
    // turn twice inside one -- and replies are not promised in order, so an
    // older answer arriving late would install a polar for a wind that has
    // already gone.
    if (event.data.id === latest) onSolved(event.data.polar);
  };

  return {
    solve(cfg, env) {
      const request: PolarRequest = { id: ++latest, cfg, env };
      worker.postMessage(request);
    },
    dispose() {
      // Terminated rather than left to be collected: a solve in flight would
      // otherwise run to completion against a session that has gone, and it is
      // more than a second of somebody's CPU.
      worker.terminate();
    },
  };
}
