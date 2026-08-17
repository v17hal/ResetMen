import { z } from 'zod';

/**
 * Environment schema.
 *
 * Validated once at boot. A bad config makes the process refuse to start, rather than
 * failing on the first request at 2 a.m. — which is the only time misconfiguration is ever
 * discovered otherwise.
 */
/**
 * An optional secret, where a blank value means "not configured".
 *
 * `.env` files carry keys with empty values as placeholders — `RAZORPAY_KEY_SECRET=` is how
 * you say "fill this in later". Plain `.optional()` reads that as the empty string, which is
 * *present*, and the payment client would leave simulated mode and start signing requests to
 * Razorpay with a blank secret. Every checkout in development would fail with a gateway
 * error that points nowhere near this line.
 */
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  CHECKIN_HMAC_SECRET: z.string().min(32).optional(),

  /**
   * Online payment, off by default.
   *
   * The store takes payment at the counter (client decision, Aug 2026), so a booking is
   * confirmed the moment it is made and there is nothing to capture. Turning this on
   * re-enables the whole Razorpay path — which is kept intact and tested rather than
   * deleted, because "we'll add payments later" is the most common thing a shop asks for
   * six months in.
   *
   * When on, the keys below become mandatory in production.
   */
  PAYMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Absent while payments are off. When PAYMENTS_ENABLED is true these are required in
   * production — a live deployment silently accepting fake payments is the worst failure
   * this config could permit.
   */
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  RAZORPAY_WEBHOOK_SECRET: optionalSecret,

  /**
   * Firebase project id, e.g. `reset-booking-52ee0`.
   *
   * Customers sign in through Firebase, and this is what an incoming ID token is checked
   * against — both `aud` and the issuer. Without it the API cannot authenticate anyone, so
   * unlike the secrets above it is required in production.
   */
  FIREBASE_PROJECT_ID: optionalSecret,

  /** Firebase service-account JSON, raw or base64. Absent → push is logged, not sent. */
  FCM_SERVICE_ACCOUNT_JSON: optionalSecret,

  /**
   * SMS. MSG91 is preferred for India: transactional SMS to an Indian number must be sent
   * against a DLT-registered template or the operator drops it silently.
   */
  MSG91_AUTH_KEY: optionalSecret,
  MSG91_OTP_TEMPLATE_ID: optionalSecret,
  MSG91_SMS_TEMPLATE_ID: optionalSecret,
  MSG91_SENDER_ID: optionalSecret,
  MSG91_WHATSAPP_NUMBER: optionalSecret,

  TWILIO_ACCOUNT_SID: optionalSecret,
  TWILIO_AUTH_TOKEN: optionalSecret,
  TWILIO_FROM_NUMBER: optionalSecret,

  /** Resend-compatible HTTP email API. Absent → email is logged, not sent. */
  EMAIL_API_KEY: optionalSecret,
  EMAIL_FROM: optionalSecret,

  /** Days a soft-deleted account is retained before its personal data is purged. */
  DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),

  MEDIA_ROOT: z.string().default('./var/media'),
  /** Prefix put in front of stored keys to build image URLs. */
  MEDIA_PUBLIC_BASE_URL: z.string().default('/api/v1/media'),

  /**
   * Off only in tests, where a suite drives dozens of requests through one endpoint in
   * seconds. Never set this to false in any deployed environment — OTP is gone, but the
   * booking and refund routes are still worth protecting from a script.
   */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  /**
   * Production-only requirements.
   *
   * Refusing to boot is deliberate. The alternative is a deployment that looks healthy and
   * fails on the first customer — the failure surfaces at the worst possible moment, to the
   * person least able to report it usefully.
   */
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];

    if (env.FIREBASE_PROJECT_ID === undefined) {
      missing.push('FIREBASE_PROJECT_ID — customers sign in through Firebase; without it nobody can sign in');
    }

    if (
      env.PAYMENTS_ENABLED &&
      (env.RAZORPAY_KEY_ID === undefined || env.RAZORPAY_KEY_SECRET === undefined)
    ) {
      missing.push('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — PAYMENTS_ENABLED is true');
    }

    if (env.PAYMENTS_ENABLED && env.RAZORPAY_WEBHOOK_SECRET === undefined) {
      missing.push('RAZORPAY_WEBHOOK_SECRET — without it no payment can ever be confirmed');
    }

    if (missing.length > 0) {
      throw new Error(
        `Refusing to start in production. Missing configuration:\n${missing
          .map((line) => `  • ${line}`)
          .join('\n')}`,
      );
    }
  }

  return env;
}
