'use client';

import type { OrderResponse, VerifyPaymentRequest } from '@reset/api-client';

/**
 * Razorpay's hosted checkout.
 *
 * The script is loaded on demand rather than in the root layout: it is a third-party
 * blocking script on the critical path, and most visits never reach checkout at all.
 *
 * `keyId` is a publishable key. The secret never leaves the server, and the signature this
 * returns is verified server-side against it — a client that lies about having paid is
 * rejected by `/payments/verify`, and by the webhook that actually confirms the booking.
 */

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name?: string; contact?: string; email?: string };
  theme: { color: string };
  handler: (response: RazorpayHandlerResponse) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: { error?: { description?: string } }) => void) => void;
}

type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in a browser.'));
  if ((window as { Razorpay?: RazorpayCtor }).Razorpay !== undefined) return Promise.resolve();

  // Single-flight: two components reaching checkout together must not inject two tags.
  loader ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing !== null) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Checkout failed to load.')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt try again rather than caching the failure forever — this is
      // usually a flaky network, not a permanently broken CDN.
      loader = null;
      reject(new Error('Could not reach the payment provider. Check your connection.'));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export async function openRazorpayCheckout(params: {
  order: OrderResponse;
  name: string;
  description: string;
}): Promise<VerifyPaymentRequest> {
  await loadScript();

  const Razorpay = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;

  return new Promise<VerifyPaymentRequest>((resolve, reject) => {
    const instance = new Razorpay({
      key: params.order.keyId,
      amount: params.order.amountPaise,
      currency: params.order.currency,
      name: params.name,
      description: params.description,
      order_id: params.order.gatewayOrderId,
      prefill: {
        ...(params.order.prefill.name !== null ? { name: params.order.prefill.name } : {}),
        ...(params.order.prefill.contact !== null
          ? { contact: params.order.prefill.contact }
          : {}),
        ...(params.order.prefill.email !== null ? { email: params.order.prefill.email } : {}),
      },
      theme: {
        // Read from the live token so the widget matches whichever theme is showing.
        color:
          getComputedStyle(document.documentElement)
            .getPropertyValue('--reset-color-primary')
            .trim() || '#0E9F76',
      },
      handler: (response) =>
        resolve({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        }),
      modal: {
        // Closing the sheet is a deliberate cancellation, not a payment failure. The hold
        // survives, so the customer can simply press Pay again.
        ondismiss: () => reject(new PaymentCancelled()),
      },
    });

    instance.on('payment.failed', (payload) => {
      reject(new Error(payload.error?.description ?? 'The payment was declined.'));
    });

    instance.open();
  });
}

/** Thrown when the customer closes the checkout sheet themselves. */
export class PaymentCancelled extends Error {
  constructor() {
    super('Payment cancelled');
    this.name = 'PaymentCancelled';
  }
}
