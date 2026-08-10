import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL.
 *
 * The no-double-booking guarantee lives in a GiST exclusion constraint, so a mocked
 * database would prove exactly nothing. `docker compose up -d postgres` first.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // One shared database — parallel files would truncate each other's fixtures mid-assertion.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
