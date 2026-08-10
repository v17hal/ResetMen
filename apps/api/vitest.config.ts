import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Unit tests — no database, no network. */
export default defineConfig({
  plugins: [
    // NestJS relies on decorator metadata, which esbuild does not emit. SWC does.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
  },
});
