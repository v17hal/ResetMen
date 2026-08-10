import { describe, expect, it } from 'vitest';

import {
  blockingReason,
  discountFor,
  labelFor,
  postVisitCreditFor,
  subtotalOf,
} from '../../src/rewards/reward-math.js';

const basket = { basePricePaise: 19_900, addonsPricePaise: 5_000 };

/**
 * Reward arithmetic.
 *
 * Every case here is a way the store could lose money or a customer could be short-changed
 * at the counter. The rounding and clamping tests matter more than they look: a discount
 * that exceeds the subtotal produces a negative payable, and Razorpay rejects that with an
 * error the customer sees at the worst possible moment.
 */
describe('discountFor', () => {
  it('takes a percentage of the whole basket, add-ons included', () => {
    expect(discountFor({ rewardType: 'PERCENT_OFF', rewardValue: 20 }, basket)).toBe(4_980);
  });

  it('floors percentage discounts rather than rounding up', () => {
    // 33% of ₹101 = 3333.0 paise exactly; use a value that does not divide evenly.
    const odd = { basePricePaise: 10_101, addonsPricePaise: 0 };
    expect(discountFor({ rewardType: 'PERCENT_OFF', rewardValue: 33 }, odd)).toBe(3_333);
  });

  it('clamps a percentage above 100 instead of paying the customer', () => {
    expect(discountFor({ rewardType: 'PERCENT_OFF', rewardValue: 150 }, basket)).toBe(
      subtotalOf(basket),
    );
  });

  it('never discounts more than the subtotal', () => {
    expect(discountFor({ rewardType: 'FLAT_OFF', rewardValue: 100_000 }, basket)).toBe(
      subtotalOf(basket),
    );
  });

  it('makes the session free but still charges for add-ons', () => {
    expect(discountFor({ rewardType: 'FREE_SERVICE', rewardValue: 0 }, basket)).toBe(19_900);
  });

  it('caps a free session at its stated value', () => {
    expect(discountFor({ rewardType: 'FREE_SERVICE', rewardValue: 15_000 }, basket)).toBe(15_000);
  });

  it('discounts only the add-ons for a free-add-on reward', () => {
    expect(discountFor({ rewardType: 'FREE_ADDON', rewardValue: 0 }, basket)).toBe(5_000);
  });

  it('gives cashback nothing at checkout — it is paid back afterwards', () => {
    expect(discountFor({ rewardType: 'CASHBACK', rewardValue: 5_000 }, basket)).toBe(0);
  });

  it('caps the post-visit credit at what was actually spent', () => {
    expect(postVisitCreditFor({ rewardType: 'CASHBACK', rewardValue: 999_999 }, basket)).toBe(
      subtotalOf(basket),
    );
  });

  it('credits nothing after the visit for a reward that is not cashback', () => {
    expect(postVisitCreditFor({ rewardType: 'FLAT_OFF', rewardValue: 5_000 }, basket)).toBe(0);
  });

  it('returns zero on an empty basket rather than dividing by nothing', () => {
    const empty = { basePricePaise: 0, addonsPricePaise: 0 };
    expect(discountFor({ rewardType: 'PERCENT_OFF', rewardValue: 50 }, empty)).toBe(0);
  });
});

describe('blockingReason', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const active = {
    rewardType: 'FLAT_OFF' as const,
    rewardValue: 5_000,
    minOrderPaise: 0,
    status: 'ACTIVE',
    validTill: new Date('2026-09-10T12:00:00Z'),
  };

  it('allows a valid reward on a sufficient basket', () => {
    expect(blockingReason(active, basket, now)).toBeNull();
  });

  it('blocks an expired reward', () => {
    const expired = { ...active, validTill: new Date('2026-08-01T12:00:00Z') };
    expect(blockingReason(expired, basket, now)).toBe('Expired');
  });

  it('blocks one already used', () => {
    expect(blockingReason({ ...active, status: 'REDEEMED' }, basket, now)).toBe('Already used');
  });

  it('explains an unmet minimum in rupees, not paise', () => {
    const withMinimum = { ...active, minOrderPaise: 50_000 };
    expect(blockingReason(withMinimum, basket, now)).toBe('Needs a booking of ₹500 or more');
  });

  it('tells the customer to add an add-on rather than silently offering nothing', () => {
    const addonOnly = { ...active, rewardType: 'FREE_ADDON' as const, rewardValue: 0 };
    const noAddons = { basePricePaise: 19_900, addonsPricePaise: 0 };
    expect(blockingReason(addonOnly, noAddons, now)).toBe('Add an add-on to use this');
  });

  it('allows cashback even though it discounts nothing at checkout', () => {
    // Blocking it — the original behaviour — made cashback impossible to ever redeem, since
    // the reward can only be attached to a booking through the same applicability check.
    const cashback = { ...active, rewardType: 'CASHBACK' as const };
    expect(blockingReason(cashback, basket, now)).toBeNull();
    expect(discountFor(cashback, basket)).toBe(0);
    expect(postVisitCreditFor(cashback, basket)).toBe(5_000);
  });

  it('still enforces a minimum order on cashback', () => {
    const cashback = { ...active, rewardType: 'CASHBACK' as const, minOrderPaise: 50_000 };
    expect(blockingReason(cashback, basket, now)).toBe('Needs a booking of ₹500 or more');
  });

  it('validates without a basket for the wallet screen', () => {
    expect(blockingReason(active, null, now)).toBeNull();
  });
});

describe('labelFor', () => {
  it('drops trailing zeroes on whole rupees', () => {
    expect(labelFor({ rewardType: 'FLAT_OFF', rewardValue: 5_000 })).toBe('₹50 off');
  });

  it('keeps paise when they are not zero', () => {
    expect(labelFor({ rewardType: 'FLAT_OFF', rewardValue: 5_050 })).toBe('₹50.50 off');
  });

  it('labels an uncapped free session without a meaningless "up to ₹0"', () => {
    expect(labelFor({ rewardType: 'FREE_SERVICE', rewardValue: 0 })).toBe('Free session');
  });
});
