import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  bookingListQuery,
  cancelRequest,
  holdRequest,
  quoteRequest,
  rescheduleRequest,
} from '@reset/types';
import type { z } from 'zod';

import {
  CurrentAuth,
  CustomerGuard,
  OptionalCustomerGuard,
  OptionalUser,
} from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { AppError } from '../common/errors.js';
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { loadEnv } from '../config/env.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BookingLifecycleService } from './booking-lifecycle.service.js';
import { BookingService } from './booking.service.js';

@ApiTags('bookings')
@Controller('bookings')
export class BookingController {
  /** Read once at construction — it cannot change without a restart. */
  private readonly paymentsEnabled = loadEnv().PAYMENTS_ENABLED;

  constructor(
    private readonly bookings: BookingService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly scope: StoreScopeService,
  ) {}

  @Post('quote')
  @UseGuards(OptionalCustomerGuard)
  async quote(
    @Body(new ZodValidationPipe(quoteRequest)) body: z.infer<typeof quoteRequest>,
    @OptionalUser() userId: string | null,
    @StoreIdHeader() header?: string,
  ) {
    return this.bookings.quote({
      storeId: await this.scope.resolve(header),
      serviceId: body.serviceId,
      addonOptionIds: body.addonOptionIds,
      userId,
      rewardId: body.rewardId,
    });
  }

  /**
   * Optional auth: a signed-in customer's booking is attached to them, and an anonymous
   * hold still works so the slot can be locked before the OTP step. Nobody should lose a
   * slot because they had to go and find their phone.
   */
  @Post('hold')
  @UseGuards(OptionalCustomerGuard, RateLimitGuard)
  // Per customer where there is one, falling back to per-IP for a guest hold. Keyed only
  // by address, one person's twenty holds were the whole store's twenty.
  @RateLimited({ limit: 20, windowSeconds: 3600, by: 'user' })
  async hold(
    @Body(new ZodValidationPipe(holdRequest)) body: z.infer<typeof holdRequest>,
    @OptionalUser() userId: string | null,
    @Headers('idempotency-key') idempotencyKey?: string,
    @StoreIdHeader() header?: string,
  ) {
    /**
     * Refuse an anonymous hold before taking the slot, not after.
     *
     * With payments off there is nothing for a hold to wait for, so a booking has to belong
     * to somebody the moment it is made — and this check used to run *after* the hold. The
     * caller got their 401 and the row stayed: a HELD booking owned by nobody, occupying a
     * station until its TTL lapsed. Live data had eighteen of them, and repeating the call
     * would have kept a popular time unbookable for as long as someone cared to.
     *
     * `paymentsEnabled` is what decides it. With a gateway an anonymous hold is the whole
     * point — the slot is kept while someone goes to find their phone — and the payment step
     * claims it afterwards.
     */
    if (!this.paymentsEnabled && userId === null) {
      throw new AppError(
        'UNAUTHENTICATED',
        401,
        'Sign in to book',
        'Sign in so we can send you your booking and your QR code.',
      );
    }

    const hold = await this.bookings.hold({
      storeId: await this.scope.resolve(header),
      serviceId: body.serviceId,
      addonOptionIds: body.addonOptionIds,
      startsAt: body.startsAt,
      userId,
      rewardId: body.rewardId,
      source: 'WEB',
      idempotencyKey,
    });

    /**
     * With online payment off, there is nothing for a hold to wait for.
     *
     * A hold exists to keep a slot while someone pays. When the store takes money at the
     * counter, leaving the booking HELD means the expiry job quietly cancels a real
     * booking ten minutes later and the customer arrives to nothing.
     *
     * Confirmed here rather than inside BookingService so the hold path stays one thing —
     * this is the same two-step the walk-in endpoint already uses, and it goes through the
     * identical lifecycle, notifications and QR issuance.
     *
     * Signing in is still required, but only because an anonymous booking has nobody to
     * notify and no QR to show.
     */
    if (!this.paymentsEnabled) {
      await this.lifecycle.confirm(hold.bookingId, userId);
      return { ...hold, status: 'CONFIRMED', paymentRequired: false };
    }

    return { ...hold, paymentRequired: true };
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async list(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(bookingListQuery)) query: z.infer<typeof bookingListQuery>,
  ) {
    return this.lifecycle.listForUser({
      userId: auth.sub,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async detail(@CurrentAuth() auth: TokenClaims, @Param('id') id: string) {
    return this.lifecycle.detailForUser(id, auth.sub);
  }

  /**
   * Moves a confirmed booking to a new time.
   *
   * Not cancel-and-rebook: the payment, the QR and the price all survive, and the old slot is
   * only released once the new one is secured.
   */
  @Post(':id/reschedule')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard, RateLimitGuard)
  @RateLimited({ limit: 10, windowSeconds: 3600 })
  async reschedule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rescheduleRequest)) body: z.infer<typeof rescheduleRequest>,
  ) {
    return this.bookings.reschedule({
      bookingId: id,
      userId: auth.sub,
      startsAt: body.startsAt,
      actorType: 'CUSTOMER',
      actorId: auth.sub,
    });
  }

  @Post(':id/cancel')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async cancel(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelRequest)) body: z.infer<typeof cancelRequest>,
  ) {
    return this.lifecycle.cancelByCustomer(id, auth.sub, body.reason);
  }

  /**
   * Client-side confirmation after checkout returns.
   *
   * The payment webhook is authoritative; this only makes the success screen appear a
   * second sooner. If it never fires, the webhook still confirms the booking, and if the
   * webhook is lost the reconciliation job catches it.
   */
  @Post(':id/confirm')
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async confirm(@CurrentAuth() auth: TokenClaims, @Param('id') id: string) {
    const result = await this.lifecycle.confirm(id, auth.sub);
    return { ...result, booking: await this.lifecycle.detailForUser(id, auth.sub) };
  }
}
