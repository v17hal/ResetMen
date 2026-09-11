import { Injectable, Logger } from '@nestjs/common';
import type { SupportAuthor, SupportStatus } from '@prisma/client';
import type { CreateSupportThread } from '@reset/types';

import { generateCode } from '../booking/public-id.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationService } from '../notifications/notification.service.js';

/**
 * Past this, a new question waits until one is answered or closed. Five is more than any
 * real customer needs at once and fewer than it takes to bury the owner's inbox.
 */
const MAX_OPEN_PER_CUSTOMER = 5;
const PREVIEW_LENGTH = 140;

const BOOKING_SELECT = {
  select: { id: true, publicId: true, startsAt: true, serviceNameSnapshot: true },
} as const;

interface ThreadRow {
  id: string;
  publicId: string;
  subject: string;
  status: SupportStatus;
  lastMessageAt: Date;
  lastMessageBy: SupportAuthor;
  createdAt: Date;
  booking: { id: string; publicId: string; startsAt: Date; serviceNameSnapshot: string } | null;
}

/**
 * Help desk — client request 11/09/2026.
 *
 * The phone number came off the site. Customers write in from the website or the app,
 * whoever is on the desk answers from the admin panel, and both sides see the same
 * conversation. A reply from the store pushes a notification to the customer's phone.
 *
 * Two unread flags rather than read receipts per message: the only questions anyone asks
 * are "is there something I have not seen?" on each side, and a flag answers that with one
 * indexed column instead of a join.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Customer ───────────────────────────────────────────────────────────────

  async listForCustomer(userId: string, storeId: string) {
    const rows = await this.prisma.supportThread.findMany({
      where: { userId, storeId },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        booking: BOOKING_SELECT,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
    });

    return rows.map((row) => ({
      ...summary(row),
      unread: row.unreadByCustomer,
      preview: preview(row.messages[0]?.body),
    }));
  }

  async createThread(userId: string, storeId: string, input: CreateSupportThread) {
    if (input.bookingId !== null) {
      const booking = await this.prisma.booking.findFirst({
        where: { id: input.bookingId, userId, storeId },
        select: { id: true },
      });
      if (booking === null) {
        throw AppError.validation('That booking is not one of yours.', { field: 'bookingId' });
      }
    }

    const open = await this.prisma.supportThread.count({
      where: { userId, storeId, status: 'OPEN' },
    });
    if (open >= MAX_OPEN_PER_CUSTOMER) {
      throw AppError.validation(
        `You already have ${open} open questions. We will answer those first — or close ` +
          'one you no longer need and ask again.',
      );
    }

    // The code space is 28⁶ ≈ 480 million, so a clash is a curiosity; retrying costs one
    // line and turns it from a 500 into nothing at all.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const thread = await this.prisma.supportThread.create({
          data: {
            publicId: generateCode('HLP'),
            storeId,
            userId,
            bookingId: input.bookingId,
            subject: input.subject,
            messages: { create: { author: 'CUSTOMER', body: input.body } },
          },
          select: { id: true },
        });
        return this.getForCustomer(userId, thread.id);
      } catch (error) {
        if (attempt < 3 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  /** Opening the conversation is what clears its "new reply" dot. */
  async getForCustomer(userId: string, threadId: string) {
    const thread = await this.prisma.supportThread.findFirst({
      where: { id: threadId, userId },
      include: {
        booking: BOOKING_SELECT,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, author: true, body: true, createdAt: true },
        },
      },
    });
    if (thread === null) throw AppError.notFound('Question');

    if (thread.unreadByCustomer) {
      await this.prisma.supportThread.update({
        where: { id: thread.id },
        data: { unreadByCustomer: false },
      });
    }

    return {
      ...summary(thread),
      unread: false,
      preview: preview(thread.messages.at(-1)?.body),
      // Staff names stay inside the store. The customer is talking to "RESET", not to
      // whichever member of staff happened to be on the desk.
      messages: thread.messages.map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  /** Writing to a closed question reopens it — the customer clearly is not done. */
  async replyAsCustomer(userId: string, threadId: string, body: string) {
    const thread = await this.prisma.supportThread.findFirst({
      where: { id: threadId, userId },
      select: { id: true },
    });
    if (thread === null) throw AppError.notFound('Question');

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { threadId, author: 'CUSTOMER', body } }),
      this.prisma.supportThread.update({
        where: { id: threadId },
        data: {
          status: 'OPEN',
          closedAt: null,
          lastMessageAt: new Date(),
          lastMessageBy: 'CUSTOMER',
          unreadByStaff: true,
        },
      }),
    ]);

    return this.getForCustomer(userId, threadId);
  }

  async closeAsCustomer(userId: string, threadId: string) {
    const updated = await this.prisma.supportThread.updateMany({
      where: { id: threadId, userId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (updated.count === 0) throw AppError.notFound('Question');
    return this.getForCustomer(userId, threadId);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────

  /** Unanswered first, then most recent — the order someone on the desk works through. */
  async listForStaff(storeId: string, status: 'OPEN' | 'CLOSED' | 'ALL') {
    const rows = await this.prisma.supportThread.findMany({
      where: { storeId, ...(status === 'ALL' ? {} : { status }) },
      orderBy: [{ unreadByStaff: 'desc' }, { lastMessageAt: 'desc' }],
      take: 200,
      include: {
        booking: BOOKING_SELECT,
        user: { select: { id: true, name: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        _count: { select: { messages: true } },
      },
    });

    return rows.map((row) => ({
      ...summary(row),
      unread: row.unreadByStaff,
      preview: preview(row.messages[0]?.body),
      messageCount: row._count.messages,
      customer: row.user,
    }));
  }

  unreadCount(storeId: string): Promise<number> {
    return this.prisma.supportThread.count({
      where: { storeId, status: 'OPEN', unreadByStaff: true },
    });
  }

  async getForStaff(storeId: string, threadId: string) {
    const thread = await this.prisma.supportThread.findFirst({
      where: { id: threadId, storeId },
      include: {
        booking: BOOKING_SELECT,
        user: { select: { id: true, name: true, phone: true, email: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { adminUser: { select: { name: true } } },
        },
      },
    });
    if (thread === null) throw AppError.notFound('Question');

    if (thread.unreadByStaff) {
      await this.prisma.supportThread.update({
        where: { id: thread.id },
        data: { unreadByStaff: false },
      });
    }

    return {
      ...summary(thread),
      unread: false,
      preview: preview(thread.messages.at(-1)?.body),
      messageCount: thread.messages.length,
      customer: thread.user,
      messages: thread.messages.map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        staffName: message.adminUser?.name ?? null,
      })),
    };
  }

  async replyAsStaff(storeId: string, threadId: string, adminUserId: string, body: string) {
    const thread = await this.prisma.supportThread.findFirst({
      where: { id: threadId, storeId },
      select: { id: true },
    });
    if (thread === null) throw AppError.notFound('Question');

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { threadId, author: 'STAFF', adminUserId, body },
      }),
      this.prisma.supportThread.update({
        where: { id: threadId },
        data: {
          status: 'OPEN',
          closedAt: null,
          lastMessageAt: new Date(),
          lastMessageBy: 'STAFF',
          unreadByCustomer: true,
          unreadByStaff: false,
        },
      }),
    ]);

    // After the commit, and never fatal. A push that fails to send must not turn a saved
    // reply into an error on the desk — the customer still sees it next time they look.
    this.notifications.notifySupportReply(threadId).catch((error: unknown) => {
      this.logger.warn(
        `Reply notification for ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return this.getForStaff(storeId, threadId);
  }

  async setStatusAsStaff(storeId: string, threadId: string, status: SupportStatus) {
    const updated = await this.prisma.supportThread.updateMany({
      where: { id: threadId, storeId },
      data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
    });
    if (updated.count === 0) throw AppError.notFound('Question');
    return this.getForStaff(storeId, threadId);
  }
}

function summary(row: ThreadRow) {
  return {
    id: row.id,
    publicId: row.publicId,
    subject: row.subject,
    status: row.status,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessageBy: row.lastMessageBy,
    createdAt: row.createdAt.toISOString(),
    booking:
      row.booking === null
        ? null
        : {
            id: row.booking.id,
            publicId: row.booking.publicId,
            startsAt: row.booking.startsAt.toISOString(),
            serviceName: row.booking.serviceNameSnapshot,
          },
  };
}

function preview(body: string | undefined): string {
  if (body === undefined) return '';
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= PREVIEW_LENGTH ? flat : `${flat.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
