import { Injectable } from '@nestjs/common';
import { computeAvailability } from '@reset/slot-engine-core';
import { DateTime } from 'luxon';

import { ScheduleResolverService } from './schedule-resolver.service.js';

export interface SlotDto {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly stationsAvailable: number;
}

export interface AvailabilityDto {
  readonly date: string;
  readonly timezone: string;
  readonly serviceId: string;
  readonly totalDurationMinutes: number;
  readonly payablePaise: number;
  readonly slots: readonly SlotDto[];
  readonly computedAt: string;
}

export interface DayAvailabilityDto {
  readonly date: string;
  readonly isOpen: boolean;
  readonly slotCount: number;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly resolver: ScheduleResolverService) {}

  /**
   * Free times for one service on one date.
   *
   * Deliberately not cached. A stale slot list means the customer picks a time that has
   * already gone and hits a 409 during payment — the worst possible moment. The catalog
   * around it is cached aggressively instead.
   */
  async getSlots(params: {
    storeId: string;
    serviceId: string;
    date: string;
    addonOptionIds: readonly string[];
    now?: Date;
  }): Promise<AvailabilityDto> {
    const { input, store, service, addons } = await this.resolver.resolve({
      storeId: params.storeId,
      serviceId: params.serviceId,
      localDate: params.date,
      addonOptionIds: params.addonOptionIds,
      now: params.now,
    });

    const result = computeAvailability(input);
    const zone = store.timezone;

    return {
      date: params.date,
      timezone: zone,
      serviceId: service.id,
      totalDurationMinutes: result.sessionDurationMinutes,
      payablePaise:
        service.pricePaise + addons.reduce((sum, a) => sum + a.pricePaise, 0),
      slots: result.slots.map((slot) => ({
        startsAt: toIso(slot.startsAt, zone),
        endsAt: toIso(slot.endsAt, zone),
        stationsAvailable: slot.stationsAvailable,
      })),
      // Drives the "Updated just now" hint and the 60-second auto-refresh. Availability is
      // live, so the UI says so rather than pretending otherwise.
      computedAt: toIso((params.now ?? new Date()).getTime(), zone),
    };
  }

  /**
   * Which dates are bookable at all, so the date strip renders in one request rather than
   * one per day.
   */
  async getDays(params: {
    storeId: string;
    serviceId: string;
    from: string;
    to: string;
    addonOptionIds: readonly string[];
    now?: Date;
  }): Promise<readonly DayAvailabilityDto[]> {
    const start = DateTime.fromISO(params.from);
    const end = DateTime.fromISO(params.to);
    const days: DayAvailabilityDto[] = [];

    for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
      const date = cursor.toISODate();
      if (date === null) continue;

      const availability = await this.getSlots({
        storeId: params.storeId,
        serviceId: params.serviceId,
        date,
        addonOptionIds: params.addonOptionIds,
        now: params.now,
      });

      days.push({
        date,
        isOpen: availability.slots.length > 0,
        slotCount: availability.slots.length,
      });
    }

    return days;
  }
}

export function toIso(millis: number, zone: string): string {
  return DateTime.fromMillis(millis, { zone }).toISO({ suppressMilliseconds: true }) ?? '';
}
