import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOtpProvider, generateOtpCode } from '../../src/auth/otp.provider.js';

/**
 * Provider selection.
 *
 * The case that matters is the last one: a production deployment with no SMS provider
 * configured must fail at boot, not at the first customer's first sign-in attempt. Getting
 * that wrong produces a launch that looks fine until nobody can log in.
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

  it('refuses to start in production with no SMS provider', () => {
    process.env.NODE_ENV = 'production';

    expect(() => createOtpProvider()).toThrow(/No SMS provider configured/);
  });
});

describe('generateOtpCode', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});
