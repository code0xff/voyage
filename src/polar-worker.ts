/**
 * The polar solver, on a thread of its own.
 *
 * Solving 37 steady-state sailing angles takes about 1.2 seconds, measured. On
 * the main thread that is 1.2 seconds of frozen frames, and it happened on
 * every settings change -- tolerable behind an open menu and not tolerable at
 * all once anything asks for a fresh polar while she is sailing.
 *
 * Nothing here needed adapting, which is the whole point of the rule in
 * AGENTS.md section 3: `src/sim` touches no browser API, so it already ran
 * anywhere. `solvePolar` is imported and called exactly as `npm run polar`
 * calls it. The request and the reply are plain numbers and strings, so
 * structured clone carries them without a serialiser.
 */
import { solvePolar, type Polar } from './sim/polar';
import type { BoatConfig, Environment } from './sim/config';

export interface PolarRequest {
  /** Rises with every request, so a stale answer can be recognised and dropped. */
  id: number;
  cfg: BoatConfig;
  env: Environment;
}

export interface PolarReply {
  id: number;
  polar: Polar;
}

/*
 * `self` is typed by hand because this project compiles against the DOM lib and
 * not `WebWorker`. Adding that lib globally would put two conflicting
 * definitions of `postMessage`, `close` and friends into every other file in
 * the project; one cast in the one file that actually is a worker is by far the
 * smaller cost.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<PolarRequest>) => void) | null;
  postMessage: (reply: PolarReply) => void;
};

ctx.onmessage = (event) => {
  const { id, cfg, env } = event.data;
  ctx.postMessage({ id, polar: solvePolar(cfg, env) });
};
