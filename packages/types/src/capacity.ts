import { z } from 'zod';

import { dayOfWeek, instant, localTime, uuid } from './common.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Stations
// ─────────────────────────────────────────────────────────────────────────────

export const stationInput = z.object({
  name: z.string().min(1).max(60),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type StationInput = z.infer<typeof stationInput>;

/**
 * Station → service designation. Client requirement 02/08/2026:
 * "certain beds may be designated only for head massage based on space constraints".
 */
export const stationServices = z
  .object({
    allowsAllServices: z.boolean(),
    serviceIds: z.array(uuid).default([]),
  })
  .refine(
    (value) => value.allowsAllServices || value.serviceIds.length > 0,
    'A restricted station must be designated for at least one service, otherwise it can never be booked.',
  );
export type StationServices = z.infer<typeof stationServices>;

// ─────────────────────────────────────────────────────────────────────────────
//  Allocation rules
// ─────────────────────────────────────────────────────────────────────────────

export const allocationMode = z.enum(['EXCLUSIVE_TO', 'EXCLUDE_FROM']);
export const allocationRecurrence = z.enum(['ONE_OFF', 'WEEKLY']);

/**
 * Time-boxed station reservation. Client requirement 02/08/2026 — the morning ₹199 push.
 *
 * Stations are listed explicitly rather than by count: "reserve 2 beds" is ambiguous, and
 * resolving *which* two differently on each query produces slot lists that flicker between
 * page loads. The admin UI offers "reserve N stations" and persists the chosen ones.
 */
export const allocationRuleInput = z
  .object({
    name: z.string().min(1).max(80),
    mode: allocationMode,
    recurrence: allocationRecurrence.default('WEEKLY'),
    daysOfWeek: z.array(dayOfWeek).default([]),
    dateFrom: z.string().date().nullable().default(null),
    dateTo: z.string().date().nullable().default(null),
    startsAtLocal: localTime,
    endsAtLocal: localTime,
    stationIds: z.array(uuid).min(1, 'Pick at least one station'),
    serviceIds: z.array(uuid).min(1, 'Pick at least one service'),
    priority: z.number().int().default(100),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.endsAtLocal > v.startsAtLocal, {
    message: 'The window must end after it starts.',
    path: ['endsAtLocal'],
  })
  .refine((v) => v.recurrence !== 'WEEKLY' || v.daysOfWeek.length > 0, {
    message: 'A weekly rule needs at least one day.',
    path: ['daysOfWeek'],
  })
  .refine((v) => v.recurrence !== 'ONE_OFF' || v.dateFrom !== null, {
    message: 'A one-off rule needs a date.',
    path: ['dateFrom'],
  });
export type AllocationRuleInput = z.infer<typeof allocationRuleInput>;

/**
 * The dry-run response. Capacity rules have non-obvious second-order effects — reserving
 * two stations for a ₹199 push can quietly eliminate all morning availability for the ₹299
 * Premium, which is the opposite of what the owner intended.
 */
export const allocationRulePreview = z.object({
  date: z.string(),
  effects: z.array(
    z.object({
      serviceId: uuid,
      serviceName: z.string(),
      slotsBefore: z.number().int(),
      slotsAfter: z.number().int(),
      stationsBeforeInWindow: z.number().int(),
      stationsAfterInWindow: z.number().int(),
    }),
  ),
  conflicts: z.array(
    z.object({
      bookingId: uuid,
      publicId: z.string(),
      serviceName: z.string(),
      stationName: z.string(),
      startsAt: instant,
    }),
  ),
});
export type AllocationRulePreview = z.infer<typeof allocationRulePreview>;

// ─────────────────────────────────────────────────────────────────────────────
//  Hours, blackouts, settings
// ─────────────────────────────────────────────────────────────────────────────

export const storeHourInput = z
  .object({
    dayOfWeek,
    opensAt: localTime,
    closesAt: localTime,
    isClosed: z.boolean().default(false),
  })
  .refine((v) => v.isClosed || v.closesAt > v.opensAt, {
    message: 'Closing time must be after opening time.',
    path: ['closesAt'],
  });
export type StoreHourInput = z.infer<typeof storeHourInput>;

export const storeHoursInput = z.object({ hours: z.array(storeHourInput) });

export const blackoutInput = z
  .object({
    stationId: uuid.nullable().default(null),
    startsAt: instant,
    endsAt: instant,
    reason: z.string().max(200).optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'A blackout must end after it starts.',
    path: ['endsAt'],
  });
export type BlackoutInput = z.infer<typeof blackoutInput>;

export const storeSettingsInput = z.object({
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  slotGranularityMinutes: z.number().int().min(1).max(60).optional(),
  bookingHorizonDays: z.number().int().min(1).max(90).optional(),
  minLeadMinutes: z.number().int().min(0).max(1440).optional(),
  holdTtlMinutes: z.number().int().min(1).max(60).optional(),
  cancellationWindowMinutes: z.number().int().min(0).max(10080).optional(),
});
export type StoreSettingsInput = z.infer<typeof storeSettingsInput>;
