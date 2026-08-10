import type { RewardType } from '@prisma/client';

export interface Basket {
  readonly basePricePaise: number;
  readonly addonsPricePaise: number;
}

/**
 * The shape every reward-bearing row shares.
 *
 * `minOrderPaise` is optional because streak rules and scratch prizes carry no minimum —
 * they only become one once granted as a `UserReward`. Making it required would force three
 * call sites to invent a zero.
 */
export interface RewardLike {
  readonly rewardType: RewardType;
  readonly rewardValue: number;
  readonly minOrderPaise?: number;
}

export function subtotalOf(basket: Basket): number {
  return basket.basePricePaise + basket.addonsPricePaise;
}

/**
 * What a reward takes off a basket, in paise.
 *
 * Pure and integer-only, for the same reason the slot engine is pure: this is the one
 * calculation whose disagreement between two surfaces produces a customer holding a phone
 * that says ₹199 at a counter whose screen says ₹249. It is computed here, on the server,
 * and every client renders the result.
 *
 * Never returns more than the subtotal, so payable can never go negative.
 */
export function discountFor(reward: RewardLike, basket: Basket): number {
  const subtotal = subtotalOf(basket);
  if (subtotal <= 0) return 0;

  const raw = ((): number => {
    switch (reward.rewardType) {
      case 'PERCENT_OFF':
        // Floor, so rounding always favours the store by at most one paisa rather than
        // producing a total that is a paisa short of what was collected.
        return Math.floor((subtotal * clampPercent(reward.rewardValue)) / 100);

      case 'FLAT_OFF':
        return Math.max(0, reward.rewardValue);

      case 'FREE_SERVICE':
        // The session is free; add-ons are still chargeable. A cap of 0 means uncapped.
        return reward.rewardValue > 0
          ? Math.min(basket.basePricePaise, reward.rewardValue)
          : basket.basePricePaise;

      case 'FREE_ADDON':
        return reward.rewardValue > 0
          ? Math.min(basket.addonsPricePaise, reward.rewardValue)
          : basket.addonsPricePaise;

      case 'CASHBACK':
        // Paid back after the visit, not deducted at checkout. Deliberately zero here.
        return 0;

      default:
        return 0;
    }
  })();

  return Math.min(raw, subtotal);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Human-readable label. One definition, so the wallet and the receipt always agree. */
export function labelFor(reward: RewardLike): string {
  switch (reward.rewardType) {
    case 'PERCENT_OFF':
      return `${clampPercent(reward.rewardValue)}% off`;
    case 'FLAT_OFF':
      return `₹${rupees(reward.rewardValue)} off`;
    case 'FREE_SERVICE':
      return reward.rewardValue > 0 ? `Free session up to ₹${rupees(reward.rewardValue)}` : 'Free session';
    case 'FREE_ADDON':
      return reward.rewardValue > 0 ? `Free add-on up to ₹${rupees(reward.rewardValue)}` : 'Free add-on';
    case 'CASHBACK':
      return `₹${rupees(reward.rewardValue)} cashback`;
    default:
      return 'Reward';
  }
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2);
}

/**
 * Why a reward cannot be used on this basket, or null when it can.
 *
 * Returned to the client so the wallet row can be greyed out *with its reason shown*.
 * "Not applicable" with no explanation is the kind of thing that generates a phone call to
 * the store.
 */
export function blockingReason(
  reward: RewardLike & { validTill: Date; status: string },
  basket: Basket | null,
  now: Date,
): string | null {
  if (reward.status !== 'ACTIVE') return 'Already used';
  if (reward.validTill < now) return 'Expired';

  if (basket === null) return null;

  const subtotal = subtotalOf(basket);
  const minimum = reward.minOrderPaise ?? 0;
  if (minimum > 0 && subtotal < minimum) {
    return `Needs a booking of ₹${rupees(minimum)} or more`;
  }

  // Cashback is usable — it simply pays back afterwards rather than discounting now. The
  // checks below are about a *discount* being pointless, which does not apply to it. Marking
  // it blocked (as this did originally) made cashback impossible to ever redeem.
  if (reward.rewardType === 'CASHBACK') return null;

  if (reward.rewardType === 'FREE_ADDON' && basket.addonsPricePaise === 0) {
    return 'Add an add-on to use this';
  }

  if (discountFor(reward, basket) === 0) return 'Nothing to discount on this booking';

  return null;
}

/**
 * What a reward returns *after* the visit rather than at checkout.
 *
 * Kept separate from `discountFor` so the two can never be confused: this money is credited
 * on check-in, and a customer who does not turn up never receives it.
 */
export function postVisitCreditFor(reward: RewardLike, basket: Basket): number {
  if (reward.rewardType !== 'CASHBACK') return 0;
  return Math.min(Math.max(0, reward.rewardValue), subtotalOf(basket));
}
