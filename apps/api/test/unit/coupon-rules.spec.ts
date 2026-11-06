import { couponCode } from '@reset/types';
import { describe, expect, it } from 'vitest';

import { couponProblem } from '../../src/rewards/coupon.service.js';
import { discountFor } from '../../src/rewards/reward-math.js';

/**
 * The rules a typed code is held to — client request 06/11/2026. Each message here is shown
 * to the customer as it is, so the wording is part of what is tested.
 */

const now = new Date('2026-11-06T10:00:00+05:30');
const basket = { basePricePaise: 24_900, addonsPricePaise: 0 };

const code = (overrides: Partial<Parameters<typeof couponProblem>[0]> = {}) => ({
  isActive: true,
  validFrom: null,
  validTill: null,
  maxUses: null,
  maxUsesPerCustomer: 1,
  rewardType: 'FLAT_OFF' as const,
  rewardValue: 5_000,
  minOrderPaise: 0,
  ...overrides,
});

const fresh = { now, basket, usesTotal: 0, usesByCustomer: 0 };

describe('what a customer may type', () => {
  it('ignores case and spaces', () => {
    expect(couponCode.parse(' reset 20 ')).toBe('RESET20');
    expect(couponCode.parse('Reset20')).toBe('RESET20');
  });

  it('refuses anything that is not 3 to 20 letters or digits', () => {
    expect(couponCode.safeParse('AB').success).toBe(false);
    expect(couponCode.safeParse('RESET-20').success).toBe(false);
    expect(couponCode.safeParse('A'.repeat(21)).success).toBe(false);
  });
});

describe('when a code can be used', () => {
  it('accepts a live code on a booking it discounts', () => {
    expect(couponProblem(code(), fresh)).toBeNull();
  });

  it('refuses a code the shop turned off', () => {
    expect(couponProblem(code({ isActive: false }), fresh)).toBe('This code is no longer active.');
  });

  it('refuses a code before it starts and after it ends', () => {
    expect(couponProblem(code({ validFrom: new Date('2026-11-07T00:00:00+05:30') }), fresh)).toBe(
      'This code is not active yet.',
    );
    expect(couponProblem(code({ validTill: new Date('2026-11-05T23:59:00+05:30') }), fresh)).toBe(
      'This code has expired.',
    );
  });

  it('stops at the total number of uses', () => {
    expect(couponProblem(code({ maxUses: 10 }), { ...fresh, usesTotal: 9 })).toBeNull();
    expect(couponProblem(code({ maxUses: 10 }), { ...fresh, usesTotal: 10 })).toBe(
      'This code has been used up.',
    );
  });

  it('allows one use per customer unless the shop says otherwise', () => {
    expect(couponProblem(code(), { ...fresh, usesByCustomer: 1 })).toBe(
      'You have already used this code.',
    );
    expect(couponProblem(code({ maxUsesPerCustomer: 3 }), { ...fresh, usesByCustomer: 2 })).toBeNull();
    expect(couponProblem(code({ maxUsesPerCustomer: 3 }), { ...fresh, usesByCustomer: 3 })).toBe(
      'You have already used this code 3 times, the most it allows.',
    );
    expect(couponProblem(code({ maxUsesPerCustomer: null }), { ...fresh, usesByCustomer: 50 })).toBeNull();
  });

  it('says what the minimum booking is', () => {
    expect(couponProblem(code({ minOrderPaise: 30_000 }), fresh)).toBe(
      'This code needs a booking of ₹300 or more.',
    );
  });

  it('accepts cashback even though it takes nothing off now', () => {
    const cashback = code({ rewardType: 'CASHBACK', rewardValue: 5_000 });
    expect(discountFor(cashback, basket)).toBe(0);
    expect(couponProblem(cashback, fresh)).toBeNull();
  });

  it('refuses a free add-on code on a booking without an add-on', () => {
    expect(couponProblem(code({ rewardType: 'FREE_ADDON', rewardValue: 0 }), fresh)).toBe(
      'Add an add-on to use this code.',
    );
  });

  it('never takes more than the booking costs', () => {
    expect(discountFor(code({ rewardValue: 1_00_000 }), basket)).toBe(24_900);
    expect(discountFor(code({ rewardType: 'PERCENT_OFF', rewardValue: 20 }), basket)).toBe(4_980);
  });
});
