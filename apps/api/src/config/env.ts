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
   * Absent in development, where the payment module runs in simulated mode. It refuses to
   * start in production without them — a live deployment silently accepting fake payments
   * is the worst failure this config could permit.
   */
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  RAZORPAY_WEBHOOK_SECRET: optionalSecret,

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

  return parsed.data;
}
