import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Port 1852: one nautical mile in metres.
 *
 * The whole simulator computes in SI and displays in knots, and 1852 is exactly
 * the constant that bridges the two. It is also unlikely to collide with the
 * 3000/5173/8080 crowd, so two projects can run side by side.
 */
const PORT = 1852;

export default defineConfig({
  /*
   * Where the app will be served from, with a trailing slash.
   *
   * A build variable rather than a constant because the answer differs by host
   * and the wrong one is silent: served from the root, everything works and
   * nothing says the paths are absolute; served from a subpath, every runtime
   * fetch misses. Netlify, Cloudflare Pages and a plain bucket are all root, so
   * that is the default; a GitHub project page is `/<repo>/`.
   *
   *     VOYAGE_BASE=/voyage/ npm run build
   */
  base: process.env.VOYAGE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // strictPort so a busy port fails loudly instead of silently moving, which
  // would leave a stale tab pointed at nothing.
  //
  // allowedHosts covers Cloudflare quick tunnels, which is how this gets shown
  // to someone on another machine. Vite rejects any Host header it does not
  // recognise -- a real defence against DNS rebinding, and the reason a tunnel
  // returns a blank 403 rather than the game. The entry is a leading-dot
  // suffix match rather than `true`, so only that one throwaway domain is
  // trusted and every other host is still refused.
  server: { port: PORT, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
  preview: { port: PORT, strictPort: true, allowedHosts: ['.trycloudflare.com'] },
  /*
   * Thirty seconds a test, not five.
   *
   * Vitest's default is written for unit tests that call a function and look
   * at what came back. Half of this suite sails a boat: `coast.test.ts` builds
   * twenty-kilometre height fields over a handful of seeds, `polar.test.ts`
   * solves thirty-seven angles at four wind speeds, and the engine tests drive
   * the 120 Hz loop through minutes of world time. Those take one to two
   * seconds on the machine they are written on, which looks like a comfortable
   * margin and is not: a shared CI runner is routinely three or four times
   * slower, and on one that was, six of them went over the five-second line in
   * a single run -- none of them broken, all of them still sailing when the
   * clock ran out.
   *
   * The two tests that already carried an explicit 30 s are the same story
   * caught one at a time, a fortnight earlier. This makes it the suite's
   * default rather than a patch applied per test as each one tips over.
   *
   * A hung test is still caught: the CI job has a fifteen-minute timeout, and
   * a test that genuinely never finishes fails the run either way. What is
   * bought here is the difference between "too slow today" and "broken", which
   * is the distinction a red build is supposed to make.
   */
  test: { testTimeout: 30_000 },
});
