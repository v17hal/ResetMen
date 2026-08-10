import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createOrderRequest, verifyPaymentRequest } from '@reset/types';
import type { z } from 'zod';

import { CurrentUser, CustomerGuard } from '../auth/auth.guards.js';
import { Idempotent, IdempotencyInterceptor } from '../common/idempotency.interceptor.js';
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { loadEnv } from '../config/env.js';
import { PaymentService } from './payment.service.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(CustomerGuard)
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly scope: StoreScopeService,
  ) {}

  @Post('order')
  @UseGuards(RateLimitGuard)
  @RateLimited({ limit: 30, windowSeconds: 3600 })
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  async createOrder(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createOrderRequest)) body: z.infer<typeof createOrderRequest>,
    @StoreIdHeader() header?: string,
  ) {
    return this.payments.createOrder({
      storeId: await this.scope.resolve(header),
      userId,
      bookingId: body.bookingId,
      productOrderId: body.productOrderId,
    });
  }

  /**
   * Called by the browser when the checkout widget returns.
   *
   * The webhook is what actually confirms the booking; this exists so the success screen
   * does not have to wait for it. Both paths converge on the same idempotent capture.
   */
  @Post('verify')
  async verify(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(verifyPaymentRequest)) body: z.infer<typeof verifyPaymentRequest>,
  ) {
    return this.payments.verifyHandshake({
      userId,
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });
  }

  @Get(':id')
  async status(@Param('id') id: string) {
    return this.payments.statusOf(id);
  }

  /**
   * Completes a payment with no gateway involved.
   *
   * Registered only outside production — see `PaymentModule`. Without it there is no way to
   * demonstrate the booking → QR → check-in path until the client's Razorpay account is
   * live, which would block the entire front-end build behind a third party.
   */
  @Post(':id/simulate-success')
  async simulate(@Param('id') id: string) {
    if (loadEnv().NODE_ENV === 'production') {
      throw new Error('Simulation is not available in production.');
    }
    return this.payments.simulateSuccess(id);
  }
}
