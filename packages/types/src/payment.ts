import { z } from 'zod';

import { instant, paise, uuid } from './common.js';

export const paymentStatus = z.enum([
  'CREATED',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type PaymentStatus = z.infer<typeof paymentStatus>;

/**
 * Opens a checkout for something already held.
 *
 * The amount is deliberately absent: it comes from the booking row the server already
 * wrote. A client-supplied amount is a client-supplied discount.
 */
export const createOrderRequest = z
  .object({
    bookingId: uuid.optional(),
    productOrderId: uuid.optional(),
  })
  .refine(
    (v) => (v.bookingId === undefined) !== (v.productOrderId === undefined),
    { message: 'Provide exactly one of bookingId or productOrderId.' },
  );
export type CreateOrderRequest = z.infer<typeof createOrderRequest>;

/**
 * Everything the Razorpay checkout widget needs, and nothing it does not. `keyId` is a
 * publishable key; the secret never leaves the server.
 */
export const orderResponse = z.object({
  paymentId: uuid,
  gatewayOrderId: z.string(),
  keyId: z.string(),
  amountPaise: paise,
  currency: z.string(),
  /** True in local development, where no Razorpay credentials are configured. */
  simulated: z.boolean(),
  prefill: z.object({
    name: z.string().nullable(),
    contact: z.string().nullable(),
    email: z.string().nullable(),
  }),
});
export type OrderResponse = z.infer<typeof orderResponse>;

/**
 * Handshake posted by the browser when checkout returns.
 *
 * Advisory only — the webhook is authoritative. Its value is that the success screen can
 * appear a second sooner than the webhook round-trip allows.
 */
export const verifyPaymentRequest = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyPaymentRequest = z.infer<typeof verifyPaymentRequest>;

export const refundRequest = z.object({
  /** Omit for a full refund. */
  amountPaise: paise.optional(),
  reason: z.string().max(200).optional(),
});
export type RefundRequest = z.infer<typeof refundRequest>;

export const paymentSummary = z.object({
  id: uuid,
  status: paymentStatus,
  amountPaise: paise,
  refundedPaise: paise,
  method: z.string().nullable(),
  gatewayPaymentId: z.string().nullable(),
  createdAt: instant,
});
export type PaymentSummary = z.infer<typeof paymentSummary>;
