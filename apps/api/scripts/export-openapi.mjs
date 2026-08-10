/**
 * Writes the OpenAPI document to docs/openapi.json without starting a server.
 *
 * Runs against `dist/`, never against the TypeScript sources through tsx. Nest resolves
 * constructor parameters from `design:paramtypes` metadata, and esbuild-based runners do not
 * emit it — the app would build a document from a module graph whose providers all have
 * "no dependencies". See the DI notes in README.md.
 *
 * Preview mode is what makes this safe to run with nothing else up: Nest builds the module
 * graph and the route table but never instantiates providers, so Prisma never tries to
 * reach a database that isn't there.
 *
 * A caveat worth knowing: this API validates with Zod pipes rather than class DTOs, so the
 * document is rich in paths and thin in schemas. It is the right source for a Dart *client*
 * skeleton and for API documentation; it is not the right source for Dart *models*. Those
 * come from `pnpm --filter @reset/api-client generate`, which reads the Zod schemas directly.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outFile = resolve(repoRoot, 'docs/openapi.json');

process.env.NODE_ENV ??= 'development';
// loadEnv() runs at import time in some paths and refuses to start without these. Nothing
// here connects to anything, so placeholders are correct rather than merely convenient.
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/reset';
process.env.JWT_ACCESS_SECRET ??= 'openapi-export-placeholder-secret-32chars';
process.env.JWT_REFRESH_SECRET ??= 'openapi-export-placeholder-secret-32chars';
process.env.CHECKIN_HMAC_SECRET ??= 'openapi-export-placeholder-secret-32chars';

const { NestFactory } = await import('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
const { AppModule } = await import('../dist/app.module.js');

const app = await NestFactory.create(AppModule, {
  preview: true,
  logger: ['error'],
});
app.setGlobalPrefix('api/v1');

const config = new DocumentBuilder()
  .setTitle('RESET API')
  .setDescription(
    'Slot & station booking platform. Errors are RFC 9457 problem+json; clients switch on ' +
      '`code`, never on `title` or `detail`.',
  )
  .setVersion('1.0')
  .addBearerAuth()
  .addGlobalParameters({
    name: 'X-Store-Id',
    in: 'header',
    required: false,
    description: 'Optional for a single-outlet install — the only active store is used.',
    schema: { type: 'string', format: 'uuid' },
  })
  .build();

const document = SwaggerModule.createDocument(app, config);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await app.close();

const pathCount = Object.keys(document.paths ?? {}).length;
const opCount = Object.values(document.paths ?? {}).reduce(
  (sum, item) => sum + Object.keys(item).length,
  0,
);
console.log(`OpenAPI written to docs/openapi.json — ${pathCount} paths, ${opCount} operations.`);
