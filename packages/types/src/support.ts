import { z } from 'zod';

import { uuid } from './common.js';

/**
 * Help desk — client request 11/09/2026.
 *
 * The phone number came off the site; customers write in instead, staff answer from the
 * admin panel, and both sides can see the whole conversation.
 */

export const supportStatus = z.enum(['OPEN', 'CLOSED']);
export type SupportStatus = z.infer<typeof supportStatus>;

/** Trimmed before the length check, so a message of spaces is empty rather than valid. */
const messageBody = z
  .string()
  .trim()
  .min(1, 'Write a message first.')
  .max(2000, 'Keep it under 2,000 characters.');

export const createSupportThread = z.object({
  subject: z
    .string()
    .trim()
    .min(3, 'Give it a short subject — three characters at least.')
    .max(120, 'Keep the subject under 120 characters.'),
  body: messageBody,
  /** Optional — "about my booking on Saturday". Must be the customer's own. */
  bookingId: uuid.nullable().default(null),
});
export type CreateSupportThread = z.infer<typeof createSupportThread>;

export const supportReply = z.object({ body: messageBody });
export type SupportReply = z.infer<typeof supportReply>;

export const supportStatusUpdate = z.object({ status: supportStatus });
export type SupportStatusUpdate = z.infer<typeof supportStatusUpdate>;

export const adminSupportQuery = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'ALL']).default('OPEN'),
});
export type AdminSupportQuery = z.infer<typeof adminSupportQuery>;
