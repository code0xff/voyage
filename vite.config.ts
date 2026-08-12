import path from 'node:path';
import { defineConfig } from 'vite';
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
});
