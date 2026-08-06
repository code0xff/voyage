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
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // strictPort so a busy port fails loudly instead of silently moving, which
  // would leave a stale tab pointed at nothing.
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
