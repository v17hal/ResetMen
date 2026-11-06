import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BookingStatus, Coupon } from '@prisma/client';
import type { CouponInput } from '@reset/types';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { discountFor, labelFor, postVisitCreditFor, rupees, subtotalOf } from './reward-math.js';
import type { Basket } from './reward-math.js';

/**
 * Booking states in which a code counts as used.
 *
 * A cancelled or expired booking gives its use back simply by no longer matching, so no path
 * — customer cancel, admin cancel, the hold-expiry job — has to remember to release anything.
 * A no-show keeps it: the slot was taken and the discount was the reason it was booked.
 */
const USING: readonly BookingStatus[] = [
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
];

type CouponRules = Pick<
  Coupon,
  | 'isActive'
  | 'validFrom'
  | 'validTill'
  | 'maxUses'
  | 'maxUsesPerCustomer'
  | 'rewardType'
  | 'rewardValue'
  | 'minOrderPaise'
>;

/**
 * Why a code cannot be used on this booking by this customer, or null when it can.
 *
 * Pure, so every rule is tested without a database. The wording is shown to the customer
 * as it is: "This code has expired" ends the conversation; "Coupon invalid" starts one at
 * the counter.
 */
export function couponProblem(
  coupon: CouponRules,
  context: { now: Date; basket: Basket; usesTotal: number; usesByCustomer: number },
): string | null {
  if (!coupon.isActive) return 'This code is no longer active.';
  if (coupon.validFrom !== null && context.now < coupon.validFrom) {
    return 'This code is not active yet.';
  }
  if (coupon.validTill !== null && context.now > coupon.validTill) {
    return 'This code has expired.';
  }
  if (coupon.maxUses !== null && context.usesTotal >= coupon.maxUses) {
    return 'This code has been used up.';
  }
  if (coupon.maxUsesPerCustomer !== null && context.usesByCustomer >= coupon.maxUsesPerCustomer) {
    return coupon.maxUsesPerCustomer === 1
      ? 'You have already used this code.'
      : `You have already used this code ${coupon.maxUsesPerCustomer} times, the most it allows.`;
  }
  if (coupon.minOrderPaise > 0 && subtotalOf(context.basket) < coupon.minOrderPaise) {
    return `This code needs a booking of ₹${rupees(coupon.minOrderPaise)} or more.`;
  }
  // Cashback takes nothing off now by design; the checks below are about a discount that
  // would do nothing, which does not apply to it.
  if (coupon.rewardType === 'CASHBACK') return null;
  if (coupon.rewardType === 'FREE_ADDON' && context.basket.addonsPricePaise === 0) {
    return 'Add an add-on to use this code.';
  }
  if (discountFor(coupon, context.basket) === 0) return 'This code takes nothing off this booking.';
  return null;
}

export interface PricedCoupon {
  readonly coupon: Coupon;
  readonly discountPaise: number;
  readonly postVisitCreditPaise: number;
}

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prices a typed code against a basket without using it. Used by the quote, and again
   * inside the hold transaction — see `claim`.
   *
   * Throws with the reason rather than returning nothing: a customer who types a code and
   * sees no change has no way to know whether they mistyped it.
   */
  async priceWith(params: {
    code: string;
    userId: string | null;
    storeId: string;
    basket: Basket;
    db?: Prisma.TransactionClient;
  }): Promise<PricedCoupon> {
    const db = params.db ?? this.prisma;

    if (params.userId === null) {
      throw new AppError('COUPON_INVALID', 422, 'Sign in to use a code', 'Sign in, then enter the code again.');
    }

    const coupon = await db.coupon.findUnique({
      where: { storeId_code: { storeId: params.storeId, code: params.code } },
    });
    if (coupon === null) {
      throw new AppError(
        'COUPON_INVALID',
        404,
        'Code not recognised',
        `We do not recognise "${params.code}". Check the spelling, or ask at the counter.`,
      );
    }

    const [usesTotal, usesByCustomer] = await Promise.all([
      db.booking.count({ where: { appliedCouponId: coupon.id, status: { in: [...USING] } } }),
      db.booking.count({
        where: { appliedCouponId: coupon.id, userId: params.userId, status: { in: [...USING] } },
      }),
    ]);

    const problem = couponProblem(coupon, {
      now: new Date(),
      basket: params.basket,
      usesTotal,
      usesByCustomer,
    });
    if (problem !== null) {
      throw new AppError('COUPON_INVALID', 422, 'Code cannot be used', problem, { code: coupon.code });
    }

    return {
      coupon,
      discountPaise: discountFor(coupon, params.basket),
      postVisitCreditPaise: postVisitCreditFor(coupon, params.basket),
    };
  }

  /**
   * Re-checks a code inside the hold transaction, holding its row.
   *
   * The quote checked the limits a moment ago, but two customers can reach the last use of a
   * code at once. Locking the coupon row makes the second wait for the first booking to be
   * written, and then count it — the same guarantee `SELECT … FOR UPDATE` gives a wallet
   * reward. Must run before the booking row is created, or the count includes itself.
   */
  async claim(
    tx: Prisma.TransactionClient,
    params: { couponId: string; code: string; userId: string; storeId: string; basket: Basket },
  ): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "coupons" WHERE "id" = ${params.couponId}::uuid FOR UPDATE`;
    await this.priceWith({
      code: params.code,
      userId: params.userId,
      storeId: params.storeId,
      basket: params.basket,
      db: tx,
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async list(storeId: string) {
    const coupons = await this.prisma.coupon.findMany({
      where: { storeId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    const uses = await this.prisma.booking.groupBy({
      by: ['appliedCouponId'],
      where: { storeId, appliedCouponId: { not: null }, status: { in: [...USING] } },
      _count: { _all: true },
    });
    const usesById = new Map(uses.map((u) => [u.appliedCouponId, u._count._all]));

    return coupons.map((coupon) => ({ ...this.toDto(coupon), uses: usesById.get(coupon.id) ?? 0 }));
  }

  async create(storeId: string, input: CouponInput) {
    try {
      const created = await this.prisma.coupon.create({ data: { storeId, ...this.toData(input) } });
      return { ...this.toDto(created), uses: 0 };
    } catch (error) {
      throw this.duplicateOr(error, input.code);
    }
  }

  async update(storeId: string, id: string, input: CouponInput) {
    const before = await this.prisma.coupon.findFirst({ where: { id, storeId } });
    if (before === null) throw AppError.notFound('Code');

    try {
      const after = await this.prisma.coupon.update({ where: { id }, data: this.toData(input) });
      const uses = await this.prisma.booking.count({
        where: { appliedCouponId: id, status: { in: [...USING] } },
      });
      return { before: this.toDto(before), after: { ...this.toDto(after), uses } };
    } catch (error) {
      throw this.duplicateOr(error, input.code);
    }
  }

  private toData(input: CouponInput) {
    return {
      code: input.code,
      note: input.note,
      rewardType: input.rewardType,
      rewardValue: input.rewardValue,
      minOrderPaise: input.minOrderPaise,
      validFrom: input.validFrom === null ? null : new Date(input.validFrom),
      validTill: input.validTill === null ? null : new Date(input.validTill),
      maxUses: input.maxUses,
      maxUsesPerCustomer: input.maxUsesPerCustomer,
      isActive: input.isActive,
    };
  }

  private toDto(coupon: Coupon) {
    return {
      id: coupon.id,
      code: coupon.code,
      note: coupon.note,
      rewardType: coupon.rewardType,
      rewardValue: coupon.rewardValue,
      label: labelFor(coupon),
      minOrderPaise: coupon.minOrderPaise,
      validFrom: coupon.validFrom?.toISOString() ?? null,
      validTill: coupon.validTill?.toISOString() ?? null,
      maxUses: coupon.maxUses,
      maxUsesPerCustomer: coupon.maxUsesPerCustomer,
      isActive: coupon.isActive,
      createdAt: coupon.createdAt.toISOString(),
    };
  }

  private duplicateOr(error: unknown, code: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.validation(`There is already a code called ${code}. Pick another.`, {
        field: 'code',
      });
    }
    return error;
  }
}
