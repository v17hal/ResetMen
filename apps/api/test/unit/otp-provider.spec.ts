import type { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOtpProvider, generateOtpCode } from '../../src/auth/otp.provider.js';

/**
 * Provider selection.
 *
 * Ordered by preference rather than by what happens to be set: MSG91 first, because the
 * launch market is India and a DLT-registered template delivers where an international
 * long code does not.
 *
 * SMS is no longer the front door — customers sign in through Firebase — so an absent
 * provider degrades to logging instead of refusing to boot. What must still hold is that
 * the choice is made from configuration and never silently sends nothing while claiming
 * to have sent something.
 */
describe('createOtpProvider', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of [
      'MSG91_AUTH_KEY',
      'MSG91_OTP_TEMPLATE_ID',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_FROM_NUMBER',
    ]) {
      delete process.env[key];
    }
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL ??= 'postgresql://reset:reset@localhost:5432/reset';
    // loadEnv() enforces the production requirements, and sign-in is now the one thing it
    // refuses to boot without. Set here so the production case below exercises provider
    // selection rather than tripping over unrelated config.
    process.env.FIREBASE_PROJECT_ID ??= 'reset-test-project';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('falls back to the console provider in development', () => {
    expect(createOtpProvider().constructor.name).toBe('ConsoleOtpProvider');
  });

  it('prefers MSG91 when it is configured', () => {
    process.env.MSG91_AUTH_KEY = 'key';
    process.env.MSG91_OTP_TEMPLATE_ID = 'tmpl';

    expect(createOtpProvider().constructor.name).toBe('Msg91OtpProvider');
  });

  it('uses Twilio when MSG91 is absent', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';

    expect(createOtpProvider().constructor.name).toBe('TwilioOtpProvider');
  });

  it('still prefers MSG91 when both are configured', () => {
    process.env.MSG91_AUTH_KEY = 'key';
    process.env.MSG91_OTP_TEMPLATE_ID = 'tmpl';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';

    expect(createOtpProvider().constructor.name).toBe('Msg91OtpProvider');
  });

  it('treats a blank env value as unconfigured', () => {
    // `.env` files carry empty placeholders. Reading `MSG91_AUTH_KEY=` as *present* would
    // send OTPs to MSG91 with no credentials and fail every sign-in.
    process.env.MSG91_AUTH_KEY = '';
    process.env.MSG91_OTP_TEMPLATE_ID = '   ';

    expect(createOtpProvider().constructor.name).toBe('ConsoleOtpProvider');
  });

  /**
   * This used to throw.
   *
   * When phone + OTP was the only way in, an unconfigured production deployment looked
   * healthy right up until the first customer tried to sign in — so refusing to boot was
   * the safer failure. Customers now sign in through Firebase, so SMS is off the critical
   * path: its absence costs a reminder channel, not the front door. The guard that matters
   * moved to FIREBASE_PROJECT_ID in config/env.ts, which is tested there.
   */
  it('disables phone sign-in in production rather than logging codes', async () => {
    process.env.NODE_ENV = 'production';

    const warn = vi.fn();
    const logger = { log: vi.fn(), warn } as unknown as Logger;
    const provider = createOtpProvider(logger);

    expect(provider.constructor.name).toBe('DisabledOtpProvider');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No SMS provider configured'));

    // The point of the class: it fails loudly at send instead of printing a working
    // credential to the log, which is what the console provider would do.
    await expect(provider.send('+919404491801', '123456')).rejects.toMatchObject({
      title: 'Phone sign-in is unavailable',
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('generateOtpCode', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});
