import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { loadEnv } from '../config/env.js';

/**
 * OTP delivery, behind an interface.
 *
 * MSG91 and Twilio are one adapter each. Keeping the swap to a single file is the whole
 * point — provider pricing and deliverability in India change often enough that being
 * locked in is a real cost.
 */
export interface OtpProvider {
  send(phone: string, code: string): Promise<void>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export function generateOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

/**
 * Development provider: logs the code instead of sending it.
 *
 * Refuses to be used in production — an OTP printed to the log is an authentication bypass
 * for anyone who can read logs, and "we'll swap it before launch" is exactly the promise
 * that gets forgotten.
 */
@Injectable()
export class ConsoleOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ConsoleOtpProvider must never run in production — it prints OTP codes to the log. ' +
          'Configure a real provider before deploying.',
      );
    }
  }

  send(phone: string, code: string): Promise<void> {
    this.logger.warn(`[dev] OTP for ${phone} is ${code}`);
    return Promise.resolve();
  }
}

/**
 * MSG91 — the launch provider.
 *
 * Indian-domiciled, so it handles DLT registration, which is not optional: since 2021 every
 * transactional SMS to an Indian number must be sent against a template registered with the
 * operator, or it is silently dropped. That is why this adapter sends a `template_id` and a
 * variable rather than a message body — the wording lives in MSG91's console, registered
 * under the client's DLT entity, and cannot be changed from here.
 */
@Injectable()
export class Msg91OtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');

  constructor(
    private readonly authKey: string,
    private readonly templateId: string,
    private readonly senderId: string | undefined,
  ) {}

  async send(phone: string, code: string): Promise<void> {
    // MSG91 wants the number without a leading '+'.
    const recipient = phone.replace(/^\+/, '');

    const response = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: this.templateId,
        mobile: recipient,
        otp: code,
        ...(this.senderId === undefined ? {} : { sender: this.senderId }),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await response.text();

    // MSG91 answers 200 with `{"type":"error"}` for a rejected send, so the status code
    // alone is not enough to know the message went anywhere.
    let failed = !response.ok;
    try {
      failed = failed || (JSON.parse(text) as { type?: string }).type === 'error';
    } catch {
      failed = failed || text.length === 0;
    }

    if (failed) {
      this.logger.error(`MSG91 rejected the OTP for ${maskPhone(phone)}: ${text.slice(0, 200)}`);
      throw new Error('SMS provider rejected the message');
    }
  }
}

/** Twilio — the fallback, and what non-Indian numbers will use. */
@Injectable()
export class TwilioOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OTP');

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(phone: string, code: string): Promise<void> {
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: phone,
          From: this.fromNumber,
          Body: `${code} is your RESET verification code. It expires in 5 minutes.`,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Twilio rejected the OTP for ${maskPhone(phone)}: ${text.slice(0, 200)}`);
      throw new Error('SMS provider rejected the message');
    }
  }
}

/**
 * Chooses the provider from configuration.
 *
 * Ordered by preference rather than by what happens to be set: MSG91 first because the
 * launch market is India and DLT-registered templates deliver where an international long
 * code does not.
 *
 * The production guard lives here rather than in the console provider alone, because the
 * failure being prevented is *silence* — an unconfigured production deployment that appears
 * to work until the first customer tries to sign in.
 */
export function createOtpProvider(logger = new Logger('OTP')): OtpProvider {
  const env = loadEnv();

  if (env.MSG91_AUTH_KEY !== undefined && env.MSG91_OTP_TEMPLATE_ID !== undefined) {
    logger.log('OTP delivery: MSG91');
    return new Msg91OtpProvider(env.MSG91_AUTH_KEY, env.MSG91_OTP_TEMPLATE_ID, env.MSG91_SENDER_ID);
  }

  if (
    env.TWILIO_ACCOUNT_SID !== undefined &&
    env.TWILIO_AUTH_TOKEN !== undefined &&
    env.TWILIO_FROM_NUMBER !== undefined
  ) {
    logger.log('OTP delivery: Twilio');
    return new TwilioOtpProvider(
      env.TWILIO_ACCOUNT_SID,
      env.TWILIO_AUTH_TOKEN,
      env.TWILIO_FROM_NUMBER,
    );
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No SMS provider configured. Set MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID, or the ' +
        'TWILIO_* trio. Refusing to start in production without a way to deliver OTPs.',
    );
  }

  logger.warn('OTP delivery: console (development only) — codes are printed, not sent.');
  return new ConsoleOtpProvider();
}

/** Logs are read by more people than the database is. */
function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}…${phone.slice(-3)}`;
}
