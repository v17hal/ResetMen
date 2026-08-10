import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';

const API_BASE = 'https://api.razorpay.com/v1';

export interface GatewayOrder {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
}

export interface GatewayPayment {
  readonly id: string;
  readonly order_id: string | null;
  readonly status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  readonly amount: number;
  readonly method?: string;
  readonly error_description?: string;
  readonly amount_refunded?: number;
}

export interface GatewayRefund {
  readonly id: string;
  readonly payment_id: string;
  readonly amount: number;
  readonly status: 'pending' | 'processed' | 'failed';
}

/**
 * Razorpay REST client.
 *
 * Hand-rolled over `fetch` rather than pulling in the vendor SDK: the surface used here is
 * four endpoints and two HMACs, and the SDK would add a dependency whose failure modes are
 * harder to see than these thirty lines.
 *
 * **Simulated mode.** With no credentials configured the client fabricates order and
 * payment identifiers locally and signs them with a development secret. That is what makes
 * the whole checkout path — hold, order, verify, confirm, QR — runnable and testable before
 * the client's Razorpay account exists. It refuses to engage in production, because a live
 * deployment that silently accepts fake payments is the worst bug this file could have.
 */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger(RazorpayClient.name);
  private readonly keyId: string | undefined;
  private readonly keySecret: string | undefined;
  private readonly webhookSecret: string | undefined;
  readonly simulated: boolean;

  constructor() {
    const env = loadEnv();
    this.keyId = env.RAZORPAY_KEY_ID;
    this.keySecret = env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    this.simulated = this.keyId === undefined || this.keySecret === undefined;

    if (this.simulated) {
      if (env.NODE_ENV === 'production') {
        throw new Error(
          'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production. ' +
            'Refusing to start in simulated payment mode.',
        );
      }
      this.logger.warn(
        'No Razorpay credentials — payments run in SIMULATED mode. Orders are fabricated locally.',
      );
    }
  }

  /** Publishable key handed to the checkout widget. */
  get publishableKey(): string {
    return this.keyId ?? 'rzp_test_simulated';
  }

  private get secret(): string {
    return this.keySecret ?? 'simulated-razorpay-secret';
  }

  async createOrder(params: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder> {
    if (this.simulated) {
      return {
        id: `order_sim${randomBytes(9).toString('hex')}`,
        amount: params.amountPaise,
        currency: params.currency,
        status: 'created',
      };
    }

    return this.request<GatewayOrder>('POST', '/orders', {
      amount: params.amountPaise,
      currency: params.currency,
      receipt: params.receipt,
      notes: params.notes,
      payment_capture: 1,
    });
  }

  async fetchPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
    if (this.simulated) {
      return {
        id: gatewayPaymentId,
        order_id: null,
        status: 'captured',
        amount: 0,
        method: 'simulated',
      };
    }

    return this.request<GatewayPayment>('GET', `/payments/${gatewayPaymentId}`);
  }

  /** Payments against an order — the reconciliation job's view of the truth. */
  async fetchPaymentsForOrder(gatewayOrderId: string): Promise<GatewayPayment[]> {
    if (this.simulated) return [];

    const result = await this.request<{ items: GatewayPayment[] }>(
      'GET',
      `/orders/${gatewayOrderId}/payments`,
    );
    return result.items ?? [];
  }

  async refund(params: {
    gatewayPaymentId: string;
    amountPaise: number;
    notes: Record<string, string>;
  }): Promise<GatewayRefund> {
    if (this.simulated) {
      return {
        id: `rfnd_sim${randomBytes(9).toString('hex')}`,
        payment_id: params.gatewayPaymentId,
        amount: params.amountPaise,
        status: 'processed',
      };
    }

    return this.request<GatewayRefund>('POST', `/payments/${params.gatewayPaymentId}/refund`, {
      amount: params.amountPaise,
      speed: 'normal',
      notes: params.notes,
    });
  }

  /**
   * Checkout handshake signature: `HMAC_SHA256(order_id + "|" + payment_id, key_secret)`.
   */
  verifyCheckoutSignature(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }): boolean {
    const expected = createHmac('sha256', this.secret)
      .update(`${params.gatewayOrderId}|${params.gatewayPaymentId}`)
      .digest('hex');

    return constantTimeEquals(expected, params.signature);
  }

  /** Signature the client is expected to send back. Simulated mode only — it needs the secret. */
  signCheckout(gatewayOrderId: string, gatewayPaymentId: string): string {
    return createHmac('sha256', this.secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');
  }

  /**
   * Webhook signature: `HMAC_SHA256(raw_request_body, webhook_secret)`.
   *
   * Computed over the *raw* bytes. Re-serialising the parsed JSON produces a different
   * string — key order and whitespace differ — and every signature would fail.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const secret = this.webhookSecret ?? this.secret;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return constantTimeEquals(expected, signature);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      // Network failure or timeout. Distinct from a gateway rejection, and retryable.
      this.logger.error(
        `Razorpay ${method} ${path} unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new AppError(
        'PAYMENT_FAILED',
        502,
        'Payment provider unreachable',
        'Could not reach the payment gateway. Please try again in a moment.',
      );
    }

    const text = await response.text();

    if (!response.ok) {
      const description = extractErrorDescription(text);
      this.logger.error(`Razorpay ${method} ${path} → ${response.status}: ${description}`);

      throw new AppError(
        'PAYMENT_FAILED',
        response.status >= 500 ? 502 : 422,
        'Payment could not be processed',
        description,
      );
    }

    return JSON.parse(text) as T;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function extractErrorDescription(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { description?: string } };
    return parsed.error?.description ?? 'The payment gateway rejected the request.';
  } catch {
    return 'The payment gateway returned an unreadable response.';
  }
}
