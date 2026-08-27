import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ProblemJsonFilter } from './common/problem-json.filter.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  // `rawBody` exists for the Razorpay webhook. Its signature is an HMAC over the exact
  // bytes sent; re-serialising the parsed JSON changes key order and whitespace, and every
  // signature would fail — silently leaving payments stuck in CREATED.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  /**
   * Take the client address from the proxy, not from the socket.
   *
   * Every request arrives from Caddy on the internal network, so without this `request.ip`
   * is Caddy's container address — the same value for the whole internet. The rate limiter
   * keys on it, which turned "20 holds per hour each" into "20 holds per hour for the
   * entire store", and let one script lock every customer out of booking.
   *
   * `1` and not `true`: trust exactly one hop. Trusting the whole chain would let a caller
   * forge an X-Forwarded-For and get a fresh bucket per request, which is the same bug
   * again from the other direction.
   */
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemJsonFilter());
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RESET API')
      .setDescription('Slot & station booking platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
      jsonDocumentUrl: 'openapi.json',
    });
  }

  await app.listen(env.API_PORT);

  const logger = new Logger('bootstrap');
  logger.log(`RESET API listening on http://localhost:${env.API_PORT}/api/v1`);
  if (env.NODE_ENV !== 'production') {
    logger.log(`Swagger UI at http://localhost:${env.API_PORT}/docs`);
  }
}

void bootstrap();
