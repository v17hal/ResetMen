import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppError } from '../common/errors.js';
import { PaymentService } from './payment.service.js';

/**
 * Razorpay webhook receiver.
 *
 * Unauthenticated by design — the HMAC signature over the raw body *is* the authentication,
 * and it is stronger than a bearer token would be here. Two things this endpoint must get
 * right:
 *
 *  1. **Raw bytes.** The signature covers the exact body Razorpay sent. Re-serialising the
 *     parsed JSON changes key order and whitespace, and every signature fails. `rawBody` is
 *     enabled in `main.ts` for this one route's benefit.
 *  2. **Always 200 once accepted.** Razorpay retries on any non-2xx. Since deliveries are
 *     deduped by event id, a retry after a processing failure would be discarded — so a
 *     failure is recorded against the event row and still acknowledged, rather than
 *     triggering retries that can never succeed.
 */
@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    const rawBody = request.rawBody;
    if (rawBody === undefined) {
      // Means `rawBody: true` was dropped from the bootstrap — every signature would fail
      // silently and every payment would hang in CREATED. Fail loudly instead.
      throw new AppError(
        'INTERNAL',
        500,
        'Raw body unavailable',
        'The webhook route cannot verify signatures without the raw request body.',
      );
    }

    return this.payments.handleWebhook(rawBody, signature, eventId);
  }
}
