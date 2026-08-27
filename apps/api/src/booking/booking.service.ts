import { Injectable, Logger } from '@nestjs/common';
import type { Booking } from '@prisma/client';
import { assignStation, computeAvailability } from '@reset/slot-engine-core';
import { DateTime } from 'luxon';

import { AvailabilityService, toIso } from '../availability/availability.service.js';
import { ScheduleResolverService } from '../availability/schedule-resolver.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService, isSlotConflict } from '../database/prisma.service.js';
import { labelFor } from '../rewards/reward-math.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { generatePublicId } from './public-id.js';

export interface QuoteRequest {
  readonly storeId: string;
  readonly serviceId: string;
  readonly addonOptionIds: readonly string[];
  readonly userId?: string | null;
  readonly rewardId?: string | null;
}

export interface QuoteDto {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly durationMinutes: number;
  readonly basePricePaise: number;
  readonly addonsPricePaise: number;
  readonly discountPaise: number;
  readonly payablePaise: number;
  readonly addons: readonly { id: string; name: string; pricePaise: number }[];
  readonly appliedReward: {
    readonly id: string;
    readonly label: string;
    readonly discountPaise: number;
    /**
     * Cashback only, and zero for every other type. Credited on check-in rather than taken
     * off the total, so the checkout screen shows it as "₹50 back after your visit" instead
     * of as a discount that never arrives.
     */
    readonly postVisitCreditPaise: number;
  } | null;
}

export interface HoldRequest extends QuoteRequest {
  readonly userId: string | null;
  /** ISO-8601 with offset. */
  readonly startsAt: string;
  readonly source: 'APP' | 'WEB' | 'ADMIN_WALKIN';
  readonly idempotencyKey?: string;
}

export interface HoldDto {
  readonly bookingId: string;
  readonly publicId: string;
  readonly status: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly holdExpiresAt: string;
  readonly pricing: {
    readonly basePricePaise: number;
    readonly addonsPricePaise: number;
    readonly discountPaise: number;
    readonly payablePaise: number;
  };
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ScheduleResolverService,
    private readonly availability: AvailabilityService,
    private readonly rewards: RewardsService,
  ) {}

  /**
   * Price preview. No side effects, and — critically — the only place a total is ever
   * computed. The Flutter app and the web app both render what this returns rather than
   * doing the arithmetic themselves, which is what stops Dart and TypeScript disagreeing
   * about what a basket costs.
   */
  async quote(request: QuoteRequest): Promise<QuoteDto> {
    const service = await this.prisma.service.findFirst({
      where: { id: request.serviceId, storeId: request.storeId, deletedAt: null },
    });
    if (service === null) throw AppError.notFound('Service');

    const addons =
      request.addonOptionIds.length === 0
        ? []
        : await this.prisma.addonOption.findMany({
            where: { id: { in: [...request.addonOptionIds] }, isActive: true },
          });

    await this.assertAddonSelectionIsValid(service.id, addons.map((a) => a.addonGroupId));

    const addonsPricePaise = addons.reduce((sum, a) => sum + a.pricePaise, 0);
    const durationMinutes =
      service.durationMinutes +
      addons.reduce((sum, a) => sum + a.durationDeltaMinutes, 0);

    const basket = { basePricePaise: service.pricePaise, addonsPricePaise };

    // A reward that cannot be used throws rather than being ignored: a customer who picks
    // one and sees the total unchanged will assume the app is broken, and be right.
    const applied =
      request.rewardId == null
        ? null
        : await this.rewards.priceWith({
            rewardId: request.rewardId,
            userId: request.userId ?? null,
            storeId: request.storeId,
            basket,
          });

    const discountPaise = applied?.discountPaise ?? 0;

    return {
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes,
      basePricePaise: service.pricePaise,
      addonsPricePaise,
      discountPaise,
      payablePaise: service.pricePaise + addonsPricePaise - discountPaise,
      addons: addons.map((a) => ({ id: a.id, name: a.name, pricePaise: a.pricePaise })),
      appliedReward:
        applied === null
          ? null
          : {
              id: applied.reward.id,
              label: labelFor(applied.reward),
              discountPaise: applied.discountPaise,
              postVisitCreditPaise: applied.postVisitCreditPaise,
            },
    };
  }

  /**
   * Creates a HELD booking and assigns a station.
   *
   * Three layers of defence, each doing a different job:
   *
   *   1. An advisory lock on (store, day) — *performance*. Turns a thundering herd of
   *      doomed retries on a popular slot into an orderly queue.
   *   2. A fresh availability recompute inside the lock — *accuracy*. The availability the
   *      customer saw may be seconds stale.
   *   3. The GiST exclusion constraint — *correctness*. The only layer that actually
   *      guarantees anything, and the only one that survives a future refactor, a second
   *      API replica, or a bug in layers 1 and 2.
   */
  async hold(request: HoldRequest): Promise<HoldDto> {
    const startsAt = DateTime.fromISO(request.startsAt);
    if (!startsAt.isValid) {
      throw AppError.validation(`"${request.startsAt}" is not a valid instant.`);
    }

    const store = await this.prisma.store.findUnique({
      where: { id: request.storeId },
      include: { settings: true },
    });
    if (store === null || store.settings === null) throw AppError.notFound('Store');

    // Blocking is also enforced at sign-in, but an access token lives for fifteen minutes.
    // Checking here closes the window in which someone blocked mid-session can still take a
    // slot — which is the exact scenario blocking exists for.
    await this.assertNotBlocked(request.userId);

    // Staff take the number in person; the app must have it before it takes the slot.
    if (request.source !== 'ADMIN_WALKIN') {
      await this.assertReachable(request.userId);
    }

    const localDate = startsAt.setZone(store.timezone).toISODate();
    if (localDate === null) throw AppError.validation('Could not resolve the booking date.');

    const quote = await this.quote(request);

    if (request.idempotencyKey !== undefined) {
      const existing = await this.prisma.booking.findFirst({
        where: { storeId: request.storeId, idempotencyKey: request.idempotencyKey },
      });
      if (existing !== null) return this.toHoldDto(existing, store.timezone);
    }

    try {
      const booking = await this.prisma.$transaction(async (tx) => {
        await this.prisma.lockStoreDay(tx, store.id, localDate);

        // The exclusion constraint counts HELD rows, so an unswept expired hold would block
        // a slot that is genuinely free. Sweep before recomputing, inside the same lock.
        await this.prisma.expireStaleHolds(tx, store.id);

        // `tx` matters here: the resolver must read inside this transaction so it sees the
        // sweep above, and so a single hold consumes one pooled connection rather than two.
        const { input } = await this.resolver.resolve({
          storeId: store.id,
          serviceId: request.serviceId,
          localDate,
          addonOptionIds: request.addonOptionIds,
          tx,
        });

        // A customer may only take a time the engine actually offered.
        //
        // `assignStation` answers "can a station take this instant", which is not the same
        // question. It says yes to instants availability would never list: a time in the
        // past, one off the granularity grid, one months beyond the booking horizon. The
        // app never sends those, but the endpoint is reachable directly, and a booking at
        // 09:03:27 last Tuesday still consumes a station through the exclusion constraint.
        //
        // Staff are exempt on purpose. A walk-in is entered *after* the person has sat
        // down, at whatever ragged time that was, and refusing it would leave the engine
        // believing an occupied station is free — the exact failure walk-in entry exists to
        // prevent. See admin-bookings.controller.ts#walkIn.
        if (request.source !== 'ADMIN_WALKIN') {
          const horizonEnd = DateTime.now()
            .setZone(store.timezone)
            .startOf('day')
            .plus({ days: store.settings!.bookingHorizonDays });

          const offered = computeAvailability(input).slots;
          const requestedMs = startsAt.toMillis();
          const onOffer = offered.some((slot) => slot.startsAt === requestedMs);

          if (!onOffer || startsAt >= horizonEnd) {
            throw AppError.slotUnavailable(
              'That time is not available for this service.',
              { refreshedSlots: offered.map((s) => ({
                  startsAt: toIso(s.startsAt, store.timezone),
                  stationsAvailable: s.stationsAvailable,
                })) },
            );
          }
        }

        const assignment = assignStation(input, startsAt.toMillis());
        if (assignment === null) {
          throw AppError.slotUnavailable(
            'That time is no longer bookable for this service.',
            { refreshedSlots: computeAvailability(input).slots.map((s) => ({
                startsAt: toIso(s.startsAt, store.timezone),
                stationsAvailable: s.stationsAvailable,
              })) },
          );
        }

        const holdExpiresAt = DateTime.now()
          .plus({ minutes: store.settings!.holdTtlMinutes })
          .toJSDate();

        const created = await tx.booking.create({
          data: {
            publicId: generatePublicId(),
            storeId: store.id,
            userId: request.userId,
            serviceId: request.serviceId,
            stationId: assignment.stationId,
            status: 'HELD',
            source: request.source,
            startsAt: new Date(assignment.startsAt),
            endsAt: new Date(assignment.endsAt),
            blockedUntil: new Date(assignment.blockedUntil),
            totalDurationMinutes: quote.durationMinutes,
            holdExpiresAt,
            serviceNameSnapshot: quote.serviceName,
            basePricePaise: quote.basePricePaise,
            addonsPricePaise: quote.addonsPricePaise,
            discountPaise: quote.discountPaise,
            payablePaise: quote.payablePaise,
            appliedRewardId: quote.appliedReward?.id ?? null,
            idempotencyKey: request.idempotencyKey ?? null,
            addons: {
              create: quote.addons.map((addon) => ({
                addonOptionId: addon.id,
                nameSnapshot: addon.name,
                pricePaise: addon.pricePaise,
                durationDeltaMinutes: 0,
              })),
            },
            statusHistory: {
              create: {
                toStatus: 'HELD',
                actorType: request.source === 'ADMIN_WALKIN' ? 'ADMIN' : 'CUSTOMER',
                actorId: request.userId,
              },
            },
          },
        });

        // Claimed at hold time, not at payment: two checkouts open in two tabs must not
        // both show the same single-use reward as applied. An abandoned hold gives it back
        // when it expires — see RewardsService.release.
        if (quote.appliedReward !== null && request.userId !== null) {
          await this.rewards.reserve(tx, {
            rewardId: quote.appliedReward.id,
            userId: request.userId,
            bookingId: created.id,
          });
        }

        return created;
      }, {
        // Under contention the advisory lock serialises attempts, so a request can sit in
        // the queue for a while before it even starts. The defaults (2s wait / 5s run) turn
        // that queue into a wall of timeouts where *nobody* books.
        maxWait: 15_000,
        timeout: 20_000,
      });

      return this.toHoldDto(booking, store.timezone);
    } catch (error) {
      if (isSlotConflict(error)) {
        // Lost the race in the last few hundred milliseconds. Hand back a fresh slot list
        // so the client re-renders in place instead of making the user retry by hand.
        this.logger.log(
          `Slot conflict for service ${request.serviceId} at ${request.startsAt}`,
        );

        const refreshed = await this.availability.getSlots({
          storeId: store.id,
          serviceId: request.serviceId,
          date: localDate,
          addonOptionIds: request.addonOptionIds,
        });

        throw AppError.slotTaken(refreshed.slots);
      }

      throw error;
    }
  }

  /**
   * Moves a confirmed booking to a new time.
   *
   * Deliberately *not* cancel-and-rebook. That would refund and re-charge, break the payment
   * link, void the QR, and — the part that actually matters — release the old slot before the
   * new one is secured, so a customer moving from a busy hour to another busy hour could end
   * up with neither.
   *
   * Instead the row is updated in place inside the same three-layer defence a hold uses. The
   * exclusion constraint is what makes it safe: if the target time is taken, the UPDATE is
   * rejected and the original booking is untouched.
   *
   * Price is not recomputed. A service that got more expensive since the booking was made
   * must not silently produce a bill at the counter, and one that got cheaper is not a refund
   * this endpoint should decide on.
   */
  async reschedule(params: {
    bookingId: string;
    userId: string | null;
    startsAt: string;
    actorType: 'CUSTOMER' | 'ADMIN';
    actorId: string | null;
  }) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: params.bookingId,
        ...(params.userId === null ? {} : { userId: params.userId }),
      },
      include: {
        addons: { select: { addonOptionId: true } },
        store: { include: { settings: true } },
      },
    });
    if (booking === null) throw AppError.notFound('Booking');

    if (booking.status !== 'CONFIRMED') {
      throw AppError.validation(
        booking.status === 'HELD'
          ? 'This booking has not been paid for yet. Let the hold lapse and pick a new time.'
          : `A booking that is ${booking.status} cannot be rescheduled.`,
      );
    }

    // Same window as cancellation. Someone who cannot cancel at 10 minutes' notice must not
    // be able to achieve the same thing by moving the booking to next week instead.
    if (params.actorType === 'CUSTOMER') {
      const windowMinutes = booking.store.settings?.cancellationWindowMinutes ?? 120;
      const cutoff = new Date(booking.startsAt.getTime() - windowMinutes * 60_000);

      if (new Date() > cutoff) {
        throw new AppError(
          'BOOKING_NOT_CANCELLABLE',
          409,
          'Too late to reschedule',
          `Bookings can be moved up to ${windowMinutes} minutes before the slot.`,
          { reschedulableUntil: cutoff.toISOString() },
        );
      }
    }

    const startsAt = DateTime.fromISO(params.startsAt);
    if (!startsAt.isValid) {
      throw AppError.validation(`"${params.startsAt}" is not a valid instant.`);
    }

    const zone = booking.store.timezone;
    const localDate = startsAt.setZone(zone).toISODate();
    if (localDate === null) throw AppError.validation('Could not resolve the new date.');

    if (startsAt.toMillis() === booking.startsAt.getTime()) {
      throw AppError.validation('That is the time this booking is already at.');
    }

    const addonOptionIds = booking.addons.map((a) => a.addonOptionId);

    try {
      const moved = await this.prisma.$transaction(
        async (tx) => {
          await this.prisma.lockStoreDay(tx, booking.storeId, localDate);
          await this.prisma.expireStaleHolds(tx, booking.storeId);

          const { input } = await this.resolver.resolve({
            storeId: booking.storeId,
            serviceId: booking.serviceId,
            localDate,
            addonOptionIds,
            tx,
            // Its own current slot must not block it. Without this, moving a booking
            // forward by five minutes collides with the booking being moved.
            excludeBookingId: booking.id,
          });

          const assignment = assignStation(input, startsAt.toMillis());
          if (assignment === null) {
            throw AppError.slotUnavailable('That time is not available for this service.');
          }

          const updated = await tx.booking.update({
            where: { id: booking.id },
            data: {
              stationId: assignment.stationId,
              startsAt: new Date(assignment.startsAt),
              endsAt: new Date(assignment.endsAt),
              blockedUntil: new Date(assignment.blockedUntil),
            },
          });

          await tx.bookingStatusHistory.create({
            data: {
              bookingId: booking.id,
              fromStatus: 'CONFIRMED',
              toStatus: 'CONFIRMED',
              actorType: params.actorType,
              actorId: params.actorId,
              reason: `Rescheduled from ${toIso(booking.startsAt.getTime(), zone)}`,
            },
          });

          return updated;
        },
        { maxWait: 15_000, timeout: 20_000 },
      );

      this.logger.log(
        `${booking.publicId} rescheduled ${toIso(booking.startsAt.getTime(), zone)} → ${toIso(
          moved.startsAt.getTime(),
          zone,
        )}`,
      );

      return {
        bookingId: moved.id,
        publicId: moved.publicId,
        status: moved.status,
        previousStartsAt: toIso(booking.startsAt.getTime(), zone),
        startsAt: toIso(moved.startsAt.getTime(), zone),
        endsAt: toIso(moved.endsAt.getTime(), zone),
        // Unchanged, and returned so the client can show that nothing was re-charged.
        payablePaise: moved.payablePaise,
      };
    } catch (error) {
      if (isSlotConflict(error)) {
        const refreshed = await this.availability.getSlots({
          storeId: booking.storeId,
          serviceId: booking.serviceId,
          date: localDate,
          addonOptionIds,
        });

        throw AppError.slotTaken(refreshed.slots);
      }
      throw error;
    }
  }

  /**
   * Manual station override by a manager.
   *
   * No engine involvement — this is a deliberate human decision ("move him to Station 3,
   * the fan is broken on 1"). The exclusion constraint still applies, so an override that
   * would double-book fails exactly like any other write.
   */
  async reassignStation(bookingId: string, stationId: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const station = await this.prisma.station.findFirst({
      where: { id: stationId, storeId: booking.storeId, isActive: true },
    });
    if (station === null) throw AppError.notFound('Station');

    try {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { stationId },
      });
    } catch (error) {
      if (isSlotConflict(error)) {
        throw AppError.slotUnavailable(
          `${station.name} is already occupied for that window.`,
        );
      }
      throw error;
    }

    return { bookingId, stationId, stationName: station.name };
  }

  /**
   * Refuses a booking from a blocked account.
   *
   * Anonymous holds are unaffected — there is nobody to block, and a walk-in taken at the
   * counter is the staff's call, not the engine's.
   */
  private async assertNotBlocked(userId: string | null): Promise<void> {
    if (userId === null) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isBlocked: true, blockedReason: true },
    });

    if (user?.isBlocked === true) {
      throw new AppError(
        'CUSTOMER_BLOCKED',
        403,
        'Booking not available',
        user.blockedReason ?? 'Please contact the store.',
      );
    }
  }

  /**
   * A booking nobody can be called about is not much of a booking.
   *
   * With no gateway, every booking is settled at the counter, and the only way staff can
   * chase one that never turns up — or take payment for one made this morning — is to ring
   * the customer. Google sign-in yields an email and no phone, so without this the store
   * fills up with confirmed slots attached to nobody reachable.
   *
   * Anonymous holds pass: there is no profile to complete yet, and the number is collected
   * before the hold is claimed. Walk-ins pass because staff are standing in front of the
   * person.
   */
  private async assertReachable(userId: string | null): Promise<void> {
    if (userId === null) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    if (user === null || user.phone === null || user.phone.trim().length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        422,
        'Add your phone number',
        'The store needs a number to confirm your booking and take payment.',
        { field: 'phone' },
      );
    }
  }

  /**
   * Add-on groups carry min/max selection rules, and a basket that breaks them must be
   * rejected before it reaches pricing rather than after.
   */
  private async assertAddonSelectionIsValid(
    serviceId: string,
    selectedGroupIds: readonly string[],
  ): Promise<void> {
    const groups = await this.prisma.serviceAddonGroup.findMany({
      where: { serviceId },
      include: { addonGroup: true },
    });

    for (const link of groups) {
      const chosen = selectedGroupIds.filter((id) => id === link.addonGroupId).length;

      if (chosen < link.addonGroup.minSelect) {
        throw AppError.validation(
          `"${link.addonGroup.name}" requires at least ${link.addonGroup.minSelect} selection.`,
        );
      }
      if (chosen > link.addonGroup.maxSelect) {
        throw AppError.validation(
          `"${link.addonGroup.name}" allows at most ${link.addonGroup.maxSelect} selection.`,
        );
      }
    }

    const known = new Set(groups.map((g) => g.addonGroupId));
    for (const groupId of selectedGroupIds) {
      if (!known.has(groupId)) {
        throw AppError.validation('An add-on was selected that this service does not offer.');
      }
    }
  }

  private toHoldDto(booking: Booking, zone: string): HoldDto {
    return {
      bookingId: booking.id,
      publicId: booking.publicId,
      status: booking.status,
      startsAt: toIso(booking.startsAt.getTime(), zone),
      endsAt: toIso(booking.endsAt.getTime(), zone),
      holdExpiresAt: toIso((booking.holdExpiresAt ?? booking.endsAt).getTime(), zone),
      pricing: {
        basePricePaise: booking.basePricePaise,
        addonsPricePaise: booking.addonsPricePaise,
        discountPaise: booking.discountPaise,
        payablePaise: booking.payablePaise,
      },
    };
  }
}
