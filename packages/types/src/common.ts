import { z } from 'zod';

/** Integer paise. ₹99 → 9900. No floats anywhere in the money path. */
export const paise = z.number().int().nonnegative();

/** ISO-8601 instant with an offset, e.g. `2026-08-08T09:15:00+05:30`. */
export const instant = z.string().datetime({ offset: true });

/** Store-local calendar date. */
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Wall-clock time of day. */
export const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');

export const uuid = z.string().uuid();

/** 0 = Sunday … 6 = Saturday, matching the database. */
export const dayOfWeek = z.number().int().min(0).max(6);

export const cursorPage = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPage = z.infer<typeof cursorPage>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/**
 * Accepts `?ids=a,b` and repeated `?ids=a&ids=b`, because clients disagree about which is
 * correct and both arrive in practice.
 */
export const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return [] as string[];
    const list = Array.isArray(value) ? value : value.split(',');
    return list.map((v) => v.trim()).filter((v) => v.length > 0);
  });

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'OTP_RATE_LIMITED',
  'SLOT_TAKEN',
  'SLOT_UNAVAILABLE',
  'HOLD_EXPIRED',
  'SERVICE_UNAVAILABLE_AT_TIME',
  'PAYMENT_FAILED',
  'PAYMENT_NOT_REFUNDABLE',
  'WEBHOOK_SIGNATURE_INVALID',
  'BOOKING_NOT_CANCELLABLE',
  'REWARD_INVALID',
  'SCRATCH_ALREADY_USED',
  'OUT_OF_STOCK',
  'CUSTOMER_BLOCKED',
  'CHECKIN_INVALID',
  'CHECKIN_ALREADY_USED',
  'IDEMPOTENT_REPLAY_MISMATCH',
  'STORE_CLOSED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const errorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCode>;

/** RFC 9457. Clients switch on `code`, never on `title` or `detail`. */
export const problemDetail = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: errorCode,
  detail: z.string().optional(),
  instance: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ProblemDetail = z.infer<typeof problemDetail>;
