import { Injectable, Logger } from '@nestjs/common';

import { loadEnv } from '../config/env.js';

export interface DeliveryOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * SMS, WhatsApp and email, each behind the same shape as `FcmProvider`.
 *
 * All three degrade to logging when unconfigured, so every notification path is exercisable
 * before the client's accounts exist — and all three refuse to pretend in production, which
 * is checked at boot rather than at the first send.
 *
 * Written over `fetch` for the same reason the Razorpay client is: the surface used here is
 * one POST each, and three vendor SDKs would be three dependencies whose failure modes are
 * harder to see than these files.
 */
@Injectable()
export class SmsProvider {
  private readonly logger = new Logger('SMS');
  private readonly authKey: string | undefined;
  private readonly templateId: string | undefined;
  private readonly senderId: string | undefined;

  readonly configured: boolean;

  constructor() {
    const env = loadEnv();
    this.authKey = env.MSG91_AUTH_KEY;
    this.templateId = env.MSG91_SMS_TEMPLATE_ID;
    this.senderId = env.MSG91_SENDER_ID;
    this.configured = this.authKey !== undefined && this.templateId !== undefined;

    if (!this.configured) {
      this.logger.warn('No MSG91 SMS template — transactional SMS is logged, not sent.');
    }
  }

  /**
   * `variables` are substituted into a DLT-registered template, not concatenated into a
   * message body. Indian operators drop transactional SMS that does not match a registered
   * template, so the wording genuinely does live in MSG91's console rather than here.
   */
  async send(phone: string, variables: Record<string, string>): Promise<DeliveryOutcome> {
    if (!this.configured) {
      this.logger.log(`[sms:dry-run] → ${maskPhone(phone)} ${JSON.stringify(variables)}`);
      return { ok: true };
    }

    try {
      const response = await fetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: this.authKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: this.templateId,
          ...(this.senderId === undefined ? {} : { sender: this.senderId }),
          recipients: [{ mobiles: phone.replace(/^\+/, ''), ...variables }],
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const text = await response.text();
      const rejected = !response.ok || text.includes('"type":"error"');

      return rejected ? { ok: false, error: text.slice(0, 200) } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * WhatsApp via MSG91's business API.
 *
 * Worth having for this client specifically: they send their own requirements over WhatsApp,
 * and in India a WhatsApp booking confirmation is read far more reliably than an SMS. Like
 * SMS, the message body is a pre-approved template.
 */
@Injectable()
export class WhatsAppProvider {
  private readonly logger = new Logger('WhatsApp');
  private readonly authKey: string | undefined;
  private readonly fromNumber: string | undefined;

  readonly configured: boolean;

  constructor() {
    const env = loadEnv();
    this.authKey = env.MSG91_AUTH_KEY;
    this.fromNumber = env.MSG91_WHATSAPP_NUMBER;
    this.configured = this.authKey !== undefined && this.fromNumber !== undefined;

    if (!this.configured) {
      this.logger.warn('No WhatsApp sender number — WhatsApp messages are logged, not sent.');
    }
  }

  async send(
    phone: string,
    template: string,
    variables: readonly string[],
  ): Promise<DeliveryOutcome> {
    if (!this.configured) {
      this.logger.log(`[whatsapp:dry-run] → ${maskPhone(phone)} ${template} ${variables.join('|')}`);
      return { ok: true };
    }

    try {
      const response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST',
        headers: { authkey: this.authKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrated_number: this.fromNumber,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
              name: template,
              language: { code: 'en', policy: 'deterministic' },
              to_and_components: [
                {
                  to: [phone.replace(/^\+/, '')],
                  components: Object.fromEntries(
                    variables.map((value, index) => [`body_${index + 1}`, { type: 'text', value }]),
                  ),
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok
        ? { ok: true }
        : { ok: false, error: (await response.text()).slice(0, 200) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Email over a Resend-compatible HTTP API. Receipts and account notices, not marketing. */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger('Email');
  private readonly apiKey: string | undefined;
  private readonly from: string;

  readonly configured: boolean;

  constructor() {
    const env = loadEnv();
    this.apiKey = env.EMAIL_API_KEY;
    this.from = env.EMAIL_FROM ?? 'RESET <no-reply@reset.app>';
    this.configured = this.apiKey !== undefined;

    if (!this.configured) {
      this.logger.warn('No email API key — email is logged, not sent.');
    }
  }

  async send(to: string, subject: string, body: string): Promise<DeliveryOutcome> {
    if (!this.configured) {
      this.logger.log(`[email:dry-run] → ${to} — ${subject}`);
      return { ok: true };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, text: body }),
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok
        ? { ok: true }
        : { ok: false, error: (await response.text()).slice(0, 200) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}…${phone.slice(-3)}`;
}
