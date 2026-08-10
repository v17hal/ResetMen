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
import { RateLimitGuard, RateLimited } from '../common/rate-limit.guard.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BookingLifecycleService } from './booking-lifecycle.service.js';
import { BookingService } from './booking.service.js';

@ApiTags('bookings')
@Controller('bookings')
export class BookingController {
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
  @RateLimited({ limit: 20, windowSeconds: 3600 })
  async hold(
    @Body(new ZodValidationPipe(holdRequest)) body: z.infer<typeof holdRequest>,
    @OptionalUser() userId: string | null,
    @Headers('idempotency-key') idempotencyKey?: string,
    @StoreIdHeader() header?: string,
  ) {
    return this.bookings.hold({
      storeId: await this.scope.resolve(header),
      serviceId: body.serviceId,
      addonOptionIds: body.addonOptionIds,
      startsAt: body.startsAt,
      userId,
      rewardId: body.rewardId,
      source: 'WEB',
      idempotencyKey,
    });
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
