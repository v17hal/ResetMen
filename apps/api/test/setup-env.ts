/**
 * Loads `apps/api/.env` for tests. Prisma's CLI reads it automatically; the client at
 * runtime does not, so tests would otherwise connect to nothing.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (existsSync(envPath) && process.env.DATABASE_URL === undefined) {
  process.loadEnvFile(envPath);
}

/**
 * Payments stay switched on for the test suite.
 *
 * The store runs with `PAYMENTS_ENABLED=false` — money is taken at the counter — but the
 * Razorpay path is kept intact rather than deleted, because "can we add online payment?"
 * is the most common thing a shop asks six months in. Tests are what stop that code
 * rotting while it is switched off.
 *
 * The payments-off booking flow has its own coverage, which overrides this per-suite.
 */
process.env.PAYMENTS_ENABLED ??= 'true';

/** Sign-in verifies tokens against this project id. Never contacted; only compared. */
process.env.FIREBASE_PROJECT_ID ??= 'reset-test-project';
