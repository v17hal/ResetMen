import { z } from 'zod';

import { instant, paise, uuid } from './common.js';

export const bookingStatus = z.enum([
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);
export type BookingStatus = z.infer<typeof bookingStatus>;

export const bookingSource = z.enum(['APP', 'WEB', 'ADMIN_WALKIN']);

export const quoteRequest = z.object({
  serviceId: uuid,
  addonOptionIds: z.array(uuid).default([]),
  rewardId: uuid.nullable().default(null),
});
export type QuoteRequest = z.infer<typeof quoteRequest>;

export const pricing = z.object({
  basePricePaise: paise,
  addonsPricePaise: paise,
  discountPaise: paise,
  payablePaise: paise,
});
export type Pricing = z.infer<typeof pricing>;

export const holdRequest = z.object({
  serviceId: uuid,
  startsAt: instant,
  addonOptionIds: z.array(uuid).default([]),
  rewardId: uuid.nullable().default(null),
});
export type HoldRequest = z.infer<typeof holdRequest>;

/** Staff-created booking. Without this the engine's picture of the store drifts from
 *  reality within a day — see docs/10-open-questions.md#q4. */
export const walkInRequest = holdRequest.extend({
  customerPhone: z.string().optional(),
  customerName: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
});
export type WalkInRequest = z.infer<typeof walkInRequest>;

export const cancelRequest = z.object({ reason: z.string().max(200).optional() });

/**
 * Moves an existing confirmed booking.
 *
 * No service or add-on fields: changing what was bought is a different purchase, and mixing
 * the two would mean re-pricing and re-charging inside what the customer thinks is "move my
 * appointment".
 */
export const rescheduleRequest = z.object({ startsAt: instant });
export type RescheduleRequest = z.infer<typeof rescheduleRequest>;

export const rescheduleResult = z.object({
  bookingId: uuid,
  publicId: z.string(),
  status: bookingStatus,
  previousStartsAt: instant,
  startsAt: instant,
  endsAt: instant,
  /** Unchanged by a reschedule — surfaced so the UI can say nothing was re-charged. */
  payablePaise: paise,
});
export type RescheduleResult = z.infer<typeof rescheduleResult>;

export const bookingSummary = z.object({
  id: uuid,
  publicId: z.string(),
  status: bookingStatus,
  serviceName: z.string(),
  startsAt: instant,
  endsAt: instant,
  durationMinutes: z.number().int(),
  payablePaise: paise,
  addons: z.array(z.object({ name: z.string(), pricePaise: paise })),
  canCancel: z.boolean(),
  /**
   * Whether the store has been paid.
   *
   * There is no gateway, so a booking arrives unpaid and someone rings the customer to
   * settle it. Until that happens the booking holds a slot but is not something to turn up
   * for, and it is shown as awaiting confirmation rather than as booked.
   */
  isPaid: z.boolean(),
});
export type BookingSummary = z.infer<typeof bookingSummary>;

export const bookingDetail = bookingSummary.extend({
  source: bookingSource,
  pricing,
  /** `RST1.<publicId>.<hmac>` — the payload encoded into the QR. */
  checkinPayload: z.string().nullable(),
  checkedInAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  createdAt: instant,
});
export type BookingDetail = z.infer<typeof bookingDetail>;

export const bookingListQuery = z.object({
  status: z.enum(['upcoming', 'completed', 'cancelled']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Admin status transitions. Deliberately a subset — HELD, EXPIRED and CONFIRMED are reached
 * by the booking and payment flows, never set by hand.
 */
export const adminStatusChange = z.object({
  status: z.enum(['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED']),
  reason: z.string().max(200).optional(),
});
export type AdminStatusChange = z.infer<typeof adminStatusChange>;

export const checkinRequest = z.object({ token: z.string().min(1) });
export const manualCheckinRequest = z.object({ publicId: z.string().min(1) });
