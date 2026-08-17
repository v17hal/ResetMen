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
 * Assigned, not `??=`. The .env loaded above already carries `false`, so a defaulting
 * operator has nothing to default and every payment test silently exercised the
 * payments-off path instead — which is exactly how it failed the first time.
 *
 * The payments-off flow is covered by payments-disabled.spec.ts, which sets this to
 * 'false' before the module is built.
 */
process.env.PAYMENTS_ENABLED = 'true';

/** Sign-in verifies tokens against this project id. Never contacted; only compared. */
process.env.FIREBASE_PROJECT_ID ??= 'reset-test-project';

/**
 * Rate limiting off for the suite.
 *
 * These tests drive dozens of holds through one endpoint in seconds, which trips a limit
 * sized for one human with a phone. Assigned rather than defaulted, for the same reason as
 * PAYMENTS_ENABLED above — .env may already carry a value.
 */
process.env.RATE_LIMIT_ENABLED = 'false';
