import { z } from 'zod';

import { adminRole, gender, phone } from './auth.js';
import { instant, localDate, paise, uuid } from './common.js';

// ── Customers ───────────────────────────────────────────────────────────────

export const customerListQuery = z.object({
  /** Matches name or phone. */
  q: z.string().max(80).optional(),
  blocked: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const customerSummary = z.object({
  id: uuid,
  phone,
  name: z.string().nullable(),
  gender,
  isBlocked: z.boolean(),
  totalBookings: z.number().int(),
  completedVisits: z.number().int(),
  lifetimeValuePaise: paise,
  lastVisitAt: instant.nullable(),
  currentStreak: z.number().int(),
  createdAt: instant,
});
export type CustomerSummary = z.infer<typeof customerSummary>;

/**
 * Blocking is reversible and always carries a reason — an unexplained block is a support
 * call the counter cannot answer.
 */
export const blockCustomerInput = z.object({
  blocked: z.boolean(),
  reason: z.string().max(200).optional(),
});
export type BlockCustomerInput = z.infer<typeof blockCustomerInput>;

// ── Staff ───────────────────────────────────────────────────────────────────

export const staffInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  role: adminRole,
  /** Required on create, ignored on update — password changes go through their own route. */
  password: z.string().min(10).max(200).optional(),
  isActive: z.boolean().default(true),
});
export type StaffInput = z.infer<typeof staffInput>;

export const staffPasswordInput = z.object({ password: z.string().min(10).max(200) });

export const staffSummary = z.object({
  id: uuid,
  email: z.string().email(),
  name: z.string(),
  role: adminRole,
  isActive: z.boolean(),
  lastLoginAt: instant.nullable(),
  createdAt: instant,
});
export type StaffSummary = z.infer<typeof staffSummary>;

// ── Reports ─────────────────────────────────────────────────────────────────

/**
 * Reporting window, in store-local dates.
 *
 * Inclusive of both ends — "1st to 7th" means seven days, which is what anyone asking for
 * a report means by it.
 */
export const reportRange = z
  .object({
    from: localDate,
    to: localDate,
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must not be after to.',
    path: ['from'],
  });
export type ReportRange = z.infer<typeof reportRange>;

export const revenueReport = z.object({
  from: localDate,
  to: localDate,
  currency: z.string(),
  grossPaise: paise,
  discountPaise: paise,
  netPaise: paise,
  refundedPaise: paise,
  bookingCount: z.number().int(),
  averageOrderPaise: paise,
  byDay: z.array(
    z.object({
      date: localDate,
      netPaise: paise,
      bookingCount: z.number().int(),
    }),
  ),
  byService: z.array(
    z.object({
      serviceId: uuid.nullable(),
      serviceName: z.string(),
      bookingCount: z.number().int(),
      netPaise: paise,
    }),
  ),
});
export type RevenueReport = z.infer<typeof revenueReport>;

/**
 * Station utilisation.
 *
 * `bufferMinutes` is reported separately from `bookedMinutes` because it is the number the
 * owner will challenge — "why is my utilisation only 70%" is answered by showing how much
 * of the day is cleaning time.
 */
export const utilisationReport = z.object({
  from: localDate,
  to: localDate,
  openMinutes: z.number().int(),
  bookedMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  utilisationPercent: z.number(),
  byStation: z.array(
    z.object({
      stationId: uuid,
      stationName: z.string(),
      openMinutes: z.number().int(),
      bookedMinutes: z.number().int(),
      bufferMinutes: z.number().int(),
      utilisationPercent: z.number(),
      sessionCount: z.number().int(),
    }),
  ),
  byHour: z.array(
    z.object({
      hour: z.number().int().min(0).max(23),
      sessionCount: z.number().int(),
    }),
  ),
});
export type UtilisationReport = z.infer<typeof utilisationReport>;

export const noShowReport = z.object({
  from: localDate,
  to: localDate,
  confirmedCount: z.number().int(),
  noShowCount: z.number().int(),
  cancelledCount: z.number().int(),
  noShowPercent: z.number(),
  forfeitedRevenuePaise: paise,
  repeatOffenders: z.array(
    z.object({
      userId: uuid,
      name: z.string().nullable(),
      phone,
      noShowCount: z.number().int(),
    }),
  ),
});
export type NoShowReport = z.infer<typeof noShowReport>;

export const retentionReport = z.object({
  from: localDate,
  to: localDate,
  newCustomers: z.number().int(),
  repeatCustomers: z.number().int(),
  repeatPercent: z.number(),
  averageVisitsPerCustomer: z.number(),
  activeStreaks: z.number().int(),
  rewardsIssued: z.number().int(),
  rewardsRedeemed: z.number().int(),
});
export type RetentionReport = z.infer<typeof retentionReport>;

export const reportKind = z.enum(['revenue', 'utilisation', 'no-show', 'retention', 'bookings']);
export const csvExportQuery = reportRange.and(z.object({ report: reportKind }));
