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
