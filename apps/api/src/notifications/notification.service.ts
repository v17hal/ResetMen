import { Injectable, Logger } from '@nestjs/common';
import type { DevicePlatform, NotificationChannel, Prisma } from '@prisma/client';
import type { NotificationTemplate } from '@reset/types';
import { DateTime } from 'luxon';

import { loadEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmailProvider, SmsProvider, WhatsAppProvider } from './channel.providers.js';
import { FcmProvider } from './fcm.provider.js';

interface Rendered {
  readonly title: string;
  readonly body: string;
  readonly deepLink: string | null;
}

interface TemplateSpec {
  readonly render: (v: Record<string, string>) => Rendered;
  /**
   * Fall back to SMS (and WhatsApp, when configured) if push reached nobody.
   *
   * Off by default, and that default is the point. Push is free; SMS is billed per message
   * and paid for by the client. Only messages the customer would be *materially harmed* by
   * missing — a confirmation they need to turn up for, a cancellation, an order waiting at
   * the counter — are worth the money. A scratch card is not.
   */
  readonly fallbackToSms?: boolean;
  /** Also send an email when the customer has one on file. Receipts and records only. */
  readonly email?: (v: Record<string, string>) => { subject: string; body: string };
}

/**
 * Notification copy.
 *
 * Server-side so it can be corrected without a Play Store release, and — the reason it
 * matters here — so the words stay inside the client's vocabulary rules. "Session",
 * "Attendant", "Reset": never spa, therapy or massage (client requirement 01/08/2026,
 * docs/01-product-requirements.md §2).
 */
const TEMPLATES: Record<NotificationTemplate, TemplateSpec> = {
  booking_confirmed: {
    render: (v) => ({
      // Not "show your QR": a booking paid at the counter has no QR until it is paid, so the
      // code is what the customer gives on arrival.
      title: 'Booking confirmed',
      body: `${v.serviceName} on ${v.when}. Your booking code is ${v.publicId}.`,
      deepLink: `reset://bookings/${v.bookingId}`,
    }),
    fallbackToSms: true,
    email: (v) => ({
      subject: `Your RESET booking — ${v.publicId}`,
      body:
        `Your booking is confirmed.\n\n` +
        `Reference: ${v.publicId}\n` +
        `Session:   ${v.serviceName}\n` +
        `When:      ${v.when}\n\n` +
        `Give your booking code at the counter when you arrive. You can reschedule or ` +
        `cancel from My bookings at resetmen.in or in the app.`,
    }),
  },
  booking_reminder_60: {
    render: (v) => ({
      title: 'See you in an hour',
      body: `${v.serviceName} at ${v.time}. Your station is reserved.`,
      deepLink: `reset://bookings/${v.bookingId}`,
    }),
  },
  booking_reminder_10: {
    render: (v) => ({
      title: 'Almost time',
      body: `${v.serviceName} at ${v.time}. Have your QR ready.`,
      deepLink: `reset://bookings/${v.bookingId}`,
    }),
  },
  booking_cancelled: {
    render: (v) => ({
      title: 'Booking cancelled',
      body: `Your ${v.serviceName} on ${v.when} has been cancelled.`,
      deepLink: `reset://bookings/${v.bookingId}`,
    }),
    fallbackToSms: true,
  },
  booking_rescheduled: {
    render: (v) => ({
      title: 'Booking moved',
      body: `${v.serviceName} is now ${v.when}. Your QR still works.`,
      deepLink: `reset://bookings/${v.bookingId}`,
    }),
    fallbackToSms: true,
  },
  reward_earned: {
    render: (v) => ({
      title: 'Reward unlocked',
      body: `${v.label} is waiting in your wallet.`,
      deepLink: 'reset://rewards',
    }),
  },
  scratch_card_issued: {
    render: () => ({
      title: 'You have a scratch card',
      body: 'Tap to find out what you won.',
      deepLink: 'reset://rewards/scratch',
    }),
  },
  streak_milestone: {
    render: (v) => ({
      title: 'Streak complete',
      body: `Nice work — you earned ${v.label}.`,
      deepLink: 'reset://rewards',
    }),
  },
  cashback_credited: {
    render: (v) => ({
      title: 'Cashback added',
      body: `${v.label} has been credited to your wallet.`,
      deepLink: 'reset://rewards',
    }),
  },
  product_order_ready: {
    render: (v) => ({
      title: 'Ready for pickup',
      body: `Order ${v.publicId} is ready at the counter.`,
      deepLink: `reset://orders/${v.orderId}`,
    }),
    fallbackToSms: true,
  },
  support_reply: {
    render: (v) => ({
      title: 'RESET replied',
      body: `Re: ${v.subject} — tap to read.`,
      deepLink: `reset://help/${v.threadId}`,
    }),
  },
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmProvider,
    private readonly sms: SmsProvider,
    private readonly whatsapp: WhatsAppProvider,
    private readonly email: EmailProvider,
  ) {}

  async registerDevice(userId: string, token: string, platform: DevicePlatform) {
    // Tokens migrate between users on a shared device — an upsert on the token, rather than
    // a create, is what stops the previous owner receiving the new one's bookings.
    const device = await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });

    return { id: device.id, registered: true };
  }

  async unregisterDevice(userId: string, token: string) {
    const { count } = await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { removed: count > 0 };
  }

  /**
   * Delivers one notification across the channels its template allows.
   *
   * Push first, always — it is free and it deep-links into the app. SMS and WhatsApp are
   * **fallbacks, not duplicates**: they fire only when push reached nobody, and only for the
   * handful of templates a customer would be materially harmed by missing. Sending both
   * every time would double the client's messaging bill to tell people something they
   * already read on their lock screen.
   *
   * Never throws. A notification is an accessory to whatever just happened — a push that
   * fails must not roll back the booking that triggered it.
   */
  async send(params: {
    userId: string;
    template: NotificationTemplate;
    variables: Record<string, string>;
  }): Promise<void> {
    const spec = TEMPLATES[params.template];
    if (spec === undefined) {
      this.logger.error(`No copy defined for template "${params.template}"`);
      return;
    }

    const rendered = spec.render(params.variables);

    try {
      const pushed = await this.deliverPush(params, rendered);

      if (!pushed && spec.fallbackToSms === true) {
        await this.deliverSmsFallback(params, rendered);
      }

      if (spec.email !== undefined) {
        await this.deliverEmail(params, spec.email(params.variables));
      }
    } catch (error) {
      this.logger.error(
        `Notification ${params.template} for ${params.userId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** @returns true when at least one device received it. */
  private async deliverPush(
    params: { userId: string; template: NotificationTemplate; variables: Record<string, string> },
    rendered: Rendered,
  ): Promise<boolean> {
    const log = await this.log(params, 'PUSH', rendered);

    const devices = await this.prisma.deviceToken.findMany({ where: { userId: params.userId } });

    if (devices.length === 0) {
      await this.finish(log.id, false, 'No registered devices');
      return false;
    }

    const stale: string[] = [];
    let delivered = 0;
    let lastError: string | null = null;

    for (const device of devices) {
      const outcome = await this.fcm.send({
        token: device.token,
        title: rendered.title,
        body: rendered.body,
        data: {
          template: params.template,
          deepLink: rendered.deepLink ?? '',
          ...params.variables,
        },
      });

      if (outcome.ok) {
        delivered += 1;
        continue;
      }

      lastError = outcome.error;
      if (outcome.unregistered) stale.push(device.token);
    }

    if (stale.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: stale } } });
      this.logger.log(`Dropped ${stale.length} dead device token(s)`);
    }

    await this.finish(log.id, delivered > 0, lastError);
    return delivered > 0;
  }

  /**
   * SMS, plus WhatsApp when the client has it configured.
   *
   * WhatsApp is attempted alongside rather than instead of SMS because delivery is the whole
   * point of a fallback: this path is only reached when push already failed, so the customer
   * has no other way of hearing about a session they have paid for.
   */
  private async deliverSmsFallback(
    params: { userId: string; template: NotificationTemplate; variables: Record<string, string> },
    rendered: Rendered,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { phone: true, deletedAt: true },
    });
    if (user === null || user.deletedAt !== null) return;

    // No phone number, nothing to fall back to. Customers who signed in with Google have
    // only an email until they choose to add one, and that is not an error — push and
    // email still carry the message.
    const phone = user.phone;
    if (phone === null) return;

    const smsLog = await this.log(params, 'SMS', rendered);
    const sms = await this.sms.send(phone, {
      name: params.variables.serviceName ?? 'your session',
      time: params.variables.when ?? params.variables.time ?? '',
      ref: params.variables.publicId ?? '',
    });
    await this.finish(smsLog.id, sms.ok, sms.error ?? null);

    if (!this.whatsapp.configured) return;

    const waLog = await this.log(params, 'WHATSAPP', rendered);
    const wa = await this.whatsapp.send(phone, params.template, [
      params.variables.serviceName ?? '',
      params.variables.when ?? params.variables.time ?? '',
      params.variables.publicId ?? '',
    ]);
    await this.finish(waLog.id, wa.ok, wa.error ?? null);
  }

  /** Email is additive, not a fallback — a booking confirmation is worth having on record. */
  private async deliverEmail(
    params: { userId: string; template: NotificationTemplate; variables: Record<string, string> },
    content: { subject: string; body: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, deletedAt: true },
    });
    if (user?.email == null || user.deletedAt !== null) return;

    const log = await this.log(
      params,
      'EMAIL',
      { title: content.subject, body: content.body, deepLink: null },
    );

    const outcome = await this.email.send(user.email, content.subject, content.body);
    await this.finish(log.id, outcome.ok, outcome.error ?? null);
  }

  private async log(
    params: { userId: string; template: NotificationTemplate; variables: Record<string, string> },
    channel: NotificationChannel,
    rendered: Rendered,
  ) {
    return this.prisma.notificationLog.create({
      data: {
        userId: params.userId,
        channel,
        template: params.template,
        payload: {
          ...params.variables,
          title: rendered.title,
          body: rendered.body,
          deepLink: rendered.deepLink,
        } as Prisma.InputJsonValue,
        status: 'QUEUED',
      },
    });
  }

  private async finish(logId: string, ok: boolean, error: string | null): Promise<void> {
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: ok
        ? { status: 'SENT', sentAt: new Date() }
        : { status: 'FAILED', error: error ?? 'Delivery failed' },
    });
  }

  // ── Named events ───────────────────────────────────────────────────────────

  async notifyBookingConfirmed(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { store: { select: { timezone: true } } },
    });
    if (booking?.userId == null) return;

    const when = DateTime.fromJSDate(booking.startsAt)
      .setZone(booking.store.timezone)
      .toFormat('ccc d LLL, h:mm a');

    await this.send({
      userId: booking.userId,
      template: 'booking_confirmed',
      variables: {
        bookingId,
        publicId: booking.publicId,
        serviceName: booking.serviceNameSnapshot,
        when,
      },
    });
  }

  /**
   * Tells the shop a customer has booked.
   *
   * Client request 06/11/2026: "booking hone ke baad mujhe notifications nahi aa raha".
   * Nothing told the shop at all — every message here went to the customer. Email, because
   * the owner's phone is not a device the customer push path can reach; the admin panel adds
   * its own sound-and-pop-up alert while it is open.
   *
   * Walk-ins are skipped: the person who would be told is the one who typed it in.
   */
  async notifyStoreOfBooking(bookingId: string): Promise<void> {
    const env = loadEnv();
    const recipients = (env.STORE_ALERT_EMAIL ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address.length > 0);
    if (recipients.length === 0) return;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        store: { select: { timezone: true } },
        user: { select: { name: true, phone: true, email: true } },
        appliedCoupon: { select: { code: true } },
        payments: { where: { status: 'CAPTURED', gateway: 'RAZORPAY' }, select: { id: true } },
      },
    });
    if (booking === null || booking.source === 'ADMIN_WALKIN') return;

    const when = DateTime.fromJSDate(booking.startsAt)
      .setZone(booking.store.timezone)
      .toFormat('ccc d LLL, h:mm a');
    const price = `₹${(booking.payablePaise / 100).toFixed(booking.payablePaise % 100 === 0 ? 0 : 2)}`;

    const subject = `New booking: ${booking.serviceNameSnapshot}, ${when}`;
    const body = [
      `${booking.user?.name ?? 'A customer'} has booked.`,
      '',
      `Session:   ${booking.serviceNameSnapshot}`,
      `When:      ${when}`,
      `Price:     ${price}${booking.appliedCoupon === null ? '' : ` (code ${booking.appliedCoupon.code})`}`,
      `Payment:   ${booking.payments.length > 0 ? 'Paid online' : 'Pay at the counter'}`,
      `Phone:     ${booking.user?.phone ?? '—'}`,
      `Reference: ${booking.publicId}`,
      ...(env.ADMIN_DOMAIN === undefined ? [] : ['', `Open the admin panel: https://${env.ADMIN_DOMAIN}`]),
    ].join('\n');

    for (const to of recipients) {
      const log = await this.prisma.notificationLog.create({
        data: {
          userId: null,
          channel: 'EMAIL',
          template: 'store_new_booking',
          payload: { bookingId, publicId: booking.publicId, to, title: subject, body } as Prisma.InputJsonValue,
          status: 'QUEUED',
        },
      });
      const outcome = await this.email.send(to, subject, body);
      await this.finish(log.id, outcome.ok, outcome.error ?? null);
    }
  }

  async notifyBookingCancelled(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { store: { select: { timezone: true } } },
    });
    if (booking?.userId == null) return;

    await this.send({
      userId: booking.userId,
      template: 'booking_cancelled',
      variables: {
        bookingId,
        serviceName: booking.serviceNameSnapshot,
        when: DateTime.fromJSDate(booking.startsAt)
          .setZone(booking.store.timezone)
          .toFormat('ccc d LLL, h:mm a'),
      },
    });
  }

  async notifyBookingRescheduled(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { store: { select: { timezone: true } } },
    });
    if (booking?.userId == null) return;

    await this.send({
      userId: booking.userId,
      template: 'booking_rescheduled',
      variables: {
        bookingId,
        publicId: booking.publicId,
        serviceName: booking.serviceNameSnapshot,
        when: DateTime.fromJSDate(booking.startsAt)
          .setZone(booking.store.timezone)
          .toFormat('ccc d LLL, h:mm a'),
      },
    });
  }

  async notifyRewardEarned(userId: string, label: string): Promise<void> {
    await this.send({ userId, template: 'reward_earned', variables: { label } });
  }

  async notifyCashbackCredited(userId: string, label: string): Promise<void> {
    await this.send({ userId, template: 'cashback_credited', variables: { label } });
  }

  async notifyStreakMilestone(userId: string, label: string): Promise<void> {
    await this.send({ userId, template: 'streak_milestone', variables: { label } });
  }

  async notifyScratchCardIssued(userId: string): Promise<void> {
    await this.send({ userId, template: 'scratch_card_issued', variables: {} });
  }

  async notifyOrderReady(userId: string, orderId: string, publicId: string): Promise<void> {
    await this.send({
      userId,
      template: 'product_order_ready',
      variables: { orderId, publicId },
    });
  }

  /** The store answered a help-desk question. */
  async notifySupportReply(threadId: string): Promise<void> {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { userId: true, subject: true },
    });
    if (thread === null) return;

    await this.send({
      userId: thread.userId,
      template: 'support_reply',
      variables: { threadId, subject: thread.subject },
    });
  }

  async listForUser(userId: string, limit: number) {
    const rows = await this.prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => {
      const payload = (row.payload ?? {}) as Record<string, string>;
      return {
        id: row.id,
        channel: row.channel,
        template: row.template,
        title: payload.title ?? '',
        body: payload.body ?? '',
        status: row.status,
        sentAt: row.sentAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        deepLink: payload.deepLink ?? null,
      };
    });
  }
}
