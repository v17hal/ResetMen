import { z } from 'zod';

import { instant, uuid } from './common.js';

export const devicePlatform = z.enum(['ANDROID', 'IOS', 'WEB']);
export type DevicePlatform = z.infer<typeof devicePlatform>;

export const notificationChannel = z.enum(['PUSH', 'SMS', 'EMAIL', 'WHATSAPP']);
export const notificationStatus = z.enum(['QUEUED', 'SENT', 'FAILED']);

export const registerDeviceRequest = z.object({
  token: z.string().min(10).max(4096),
  platform: devicePlatform,
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequest>;

/**
 * Template identifiers.
 *
 * A closed set rather than free text: the copy lives server-side so it can be corrected
 * without an app release, and the Flutter deep-link router switches on this exact string.
 */
export const NOTIFICATION_TEMPLATES = [
  'booking_confirmed',
  'booking_reminder_60',
  'booking_reminder_10',
  'booking_cancelled',
  'booking_rescheduled',
  'reward_earned',
  'scratch_card_issued',
  'streak_milestone',
  'cashback_credited',
  'product_order_ready',
] as const;

export const notificationTemplate = z.enum(NOTIFICATION_TEMPLATES);
export type NotificationTemplate = z.infer<typeof notificationTemplate>;

export const notificationDto = z.object({
  id: uuid,
  channel: notificationChannel,
  template: notificationTemplate,
  title: z.string(),
  body: z.string(),
  status: notificationStatus,
  sentAt: instant.nullable(),
  createdAt: instant,
  /** Deep link the client opens on tap, e.g. `reset://bookings/<id>`. */
  deepLink: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof notificationDto>;
