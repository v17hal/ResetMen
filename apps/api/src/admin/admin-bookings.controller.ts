import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { adminStatusChange, localDate, rescheduleRequest, walkInRequest } from '@reset/types';
import { z } from 'zod';

import { AdminGuard, CurrentAuth, Roles, RolesGuard } from '../auth/auth.guards.js';
import type { TokenClaims } from '../auth/token.service.js';
import { BookingLifecycleService } from '../booking/booking-lifecycle.service.js';
import { BookingService } from '../booking/booking.service.js';
import { StoreIdHeader, StoreScopeService } from '../common/store-scope.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PaymentService } from '../payments/payment.service.js';

/** How the counter took the money. Free text would make the takings unreportable. */
const markPaidRequest = z.object({
  method: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']).default('CASH'),
  note: z.string().trim().max(200).optional(),
});

const timelineQuery = z.object({ date: localDate });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/bookings')
@UseGuards(AdminGuard, RolesGuard)
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly scope: StoreScopeService,
    private readonly payments: PaymentService,
  ) {}

  private async storeFor(auth: TokenClaims, header?: string): Promise<string> {
    return auth.storeId ?? (await this.scope.resolve(header));
  }

  /** Station-wise day timeline — the screen staff actually live in. */
  @Get('timeline')
  async timeline(
    @CurrentAuth() auth: TokenClaims,
    @Query(new ZodValidationPipe(timelineQuery)) query: z.infer<typeof timelineQuery>,
    @StoreIdHeader() header?: string,
  ) {
    return this.lifecycle.timeline(await this.storeFor(auth, header), query.date);
  }

  /**
   * Staff-created walk-in.
   *
   * The most operationally important endpoint in the admin panel. If someone walks in off
   * the street, is served on Station 2, and nothing is entered, the engine believes
   * Station 2 is free and will sell that time to an app customer who then arrives to an
   * occupied station. See docs/10-open-questions.md#q4.
   *
   * Goes through exactly the same engine and the same exclusion constraint as a customer
   * booking — a walk-in cannot double-book a station either.
   */
  @Post('walk-in')
  async walkIn(
    @CurrentAuth() auth: TokenClaims,
    @Body(new ZodValidationPipe(walkInRequest)) body: z.infer<typeof walkInRequest>,
    @StoreIdHeader() header?: string,
  ) {
    const storeId = await this.storeFor(auth, header);

    const hold = await this.bookings.hold({
      storeId,
      serviceId: body.serviceId,
      addonOptionIds: body.addonOptionIds,
      startsAt: body.startsAt,
      userId: null,
      source: 'ADMIN_WALKIN',
    });

    // A walk-in is paid at the counter, so it is confirmed immediately rather than waiting
    // on a payment webhook that will never arrive.
    await this.lifecycle.confirm(hold.bookingId, null);

    return { ...hold, status: 'CONFIRMED' };
  }

  @Post(':id/status')
  async setStatus(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adminStatusChange)) body: z.infer<typeof adminStatusChange>,
  ) {
    return this.lifecycle.transition(id, body.status, 'ADMIN', auth.sub, body.reason);
  }

  /**
   * Records money taken at the counter.
   *
   * There is no gateway, so every booking arrives unpaid and staff settle it in person —
   * either when the customer walks in, or by ringing the number on the booking. This writes
   * the Payment row that says so, which is what moves the booking off the unpaid list and
   * into revenue.
   *
   * Idempotent: pressing it twice is a double-tap at a busy counter, not a second payment.
   */
  @Post(':id/mark-paid')
  @Roles('OWNER', 'MANAGER')
  async markPaid(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markPaidRequest)) body: z.infer<typeof markPaidRequest>,
  ) {
    return this.payments.recordCounterPayment({
      bookingId: id,
      adminUserId: auth.sub,
      method: body.method,
      note: body.note,
    });
  }

  @Post(':id/reassign-station')
  @Roles('OWNER', 'MANAGER')
  async reassign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ stationId: z.string().uuid() })))
    body: { stationId: string },
  ) {
    return this.bookings.reassignStation(id, body.stationId);
  }

  /**
   * Staff-side reschedule — the counter taking a phone call.
   *
   * Not subject to the cancellation window: a customer who rings at short notice is exactly
   * who staff need to be able to help, and refusing them at the counter while the policy
   * exists to stop *self-service* last-minute churn would be the wrong rule in the wrong
   * place.
   */
  @Post(':id/reschedule')
  async reschedule(
    @CurrentAuth() auth: TokenClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rescheduleRequest)) body: z.infer<typeof rescheduleRequest>,
  ) {
    return this.bookings.reschedule({
      bookingId: id,
      userId: null,
      startsAt: body.startsAt,
      actorType: 'ADMIN',
      actorId: auth.sub,
    });
  }
}
