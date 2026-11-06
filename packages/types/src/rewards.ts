import { z } from 'zod';

import { instant, paise, uuid } from './common.js';

export const rewardType = z.enum([
  'PERCENT_OFF',
  'FLAT_OFF',
  'FREE_SERVICE',
  'FREE_ADDON',
  'CASHBACK',
]);
export type RewardType = z.infer<typeof rewardType>;

export const rewardStatus = z.enum(['ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED']);
export const rewardSource = z.enum(['SCRATCH_CARD', 'STREAK', 'PROMO', 'MANUAL']);
export const scratchTrigger = z.enum(['ON_CHECKIN', 'ON_NTH_BOOKING', 'ON_STREAK_COMPLETE']);
export type ScratchTrigger = z.infer<typeof scratchTrigger>;
export const scratchCardStatus = z.enum(['ISSUED', 'SCRATCHED', 'EXPIRED']);

/**
 * One entry in the customer's wallet.
 *
 * `applicable` and `blockedReason` are computed server-side against a specific basket so
 * the app never has to reason about minimum-order rules — it greys out the row and shows
 * the reason it was given.
 */
export const walletEntry = z.object({
  id: uuid,
  source: rewardSource,
  rewardType,
  rewardValue: z.number().int(),
  label: z.string(),
  minOrderPaise: paise,
  validTill: instant,
  status: rewardStatus,
  applicable: z.boolean(),
  blockedReason: z.string().nullable(),
  /** What this reward would take off the basket that was priced. */
  discountPaise: paise,
  /**
   * What it credits back *after* the visit instead — cashback only, and only on check-in.
   *
   * Separate from `discountPaise` so a client can never add the two together, and so the
   * checkout screen can say "₹50 back after your visit" rather than showing a reward that
   * appears to do nothing.
   */
  postVisitCreditPaise: paise,
});
export type WalletEntry = z.infer<typeof walletEntry>;

export const walletQuery = z.object({
  /** Optional basket to test each reward against. */
  serviceId: uuid.optional(),
  addonOptionIds: z.array(uuid).default([]),
  includeUsed: z.coerce.boolean().default(false),
});

export const scratchCardDto = z.object({
  id: uuid,
  campaignName: z.string(),
  status: scratchCardStatus,
  issuedAt: instant,
  expiresAt: instant.nullable(),
  /** null until the card is scratched — the whole point of the mechanic. */
  reward: z
    .object({
      label: z.string(),
      rewardType,
      rewardValue: z.number().int(),
      validTill: instant,
      rewardId: uuid,
    })
    .nullable(),
});
export type ScratchCardDto = z.infer<typeof scratchCardDto>;

export const streakDto = z.object({
  currentCount: z.number().int(),
  bestCount: z.number().int(),
  totalVisits: z.number().int(),
  lastCheckinAt: instant.nullable(),
  /** The rule being worked towards, if the store has one configured. */
  goal: z
    .object({
      name: z.string(),
      requiredVisits: z.number().int(),
      withinDays: z.number().int(),
      rewardLabel: z.string(),
      /** Visits still needed. Zero means the next check-in completes it. */
      remaining: z.number().int(),
      windowEndsAt: instant.nullable(),
    })
    .nullable(),
});
export type StreakDto = z.infer<typeof streakDto>;

// ── Admin ───────────────────────────────────────────────────────────────────

export const streakRuleInput = z.object({
  name: z.string().min(1).max(80),
  requiredVisits: z.number().int().min(2).max(100),
  withinDays: z.number().int().min(1).max(365),
  rewardType,
  rewardValue: z.number().int().min(0),
  rewardServiceId: uuid.nullable().default(null),
  validityDays: z.number().int().min(1).max(365).default(30),
  isActive: z.boolean().default(true),
});
export type StreakRuleInput = z.infer<typeof streakRuleInput>;

export const scratchRewardInput = z.object({
  label: z.string().min(1).max(80),
  rewardType,
  rewardValue: z.number().int().min(0),
  /** Relative draw weight. A slice worth 1 against a slice worth 9 is drawn a tenth as often. */
  weight: z.number().int().min(0).max(10_000).default(1),
  /** null = unlimited. Otherwise the hard cap the weighted draw respects. */
  stockTotal: z.number().int().min(0).nullable().default(null),
  validityDays: z.number().int().min(1).max(365).default(30),
  isActive: z.boolean().default(true),
});
export type ScratchRewardInput = z.infer<typeof scratchRewardInput>;

export const scratchCampaignInput = z
  .object({
    name: z.string().min(1).max(80),
    trigger: scratchTrigger,
    triggerValue: z.number().int().min(1).nullable().default(null),
    isActive: z.boolean().default(true),
    startsAt: instant.nullable().default(null),
    endsAt: instant.nullable().default(null),
    rewards: z.array(scratchRewardInput).min(1),
  })
  .refine((v) => v.trigger !== 'ON_NTH_BOOKING' || v.triggerValue !== null, {
    message: 'ON_NTH_BOOKING needs a triggerValue — which booking number issues the card.',
    path: ['triggerValue'],
  })
  .refine((v) => v.rewards.some((r) => r.isActive && r.weight > 0), {
    message: 'At least one active reward must have a non-zero weight, or nothing can be won.',
    path: ['rewards'],
  });
export type ScratchCampaignInput = z.infer<typeof scratchCampaignInput>;

// ── Coupon codes ────────────────────────────────────────────────────────────

/**
 * A code as a customer types it. Spaces are dropped and case ignored, so "reset20",
 * "RESET20" and " Reset 20 " are one code — the version that reached the counter by word of
 * mouth is rarely the one on the poster.
 */
export const couponCode = z
  .string()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/, 'A code is 3 to 20 letters or digits.'));

/** Client request 06/11/2026: codes the shop creates and hands out. */
export const couponInput = z
  .object({
    code: couponCode,
    /** For staff only — where the code was handed out. */
    note: z.string().max(120).nullable().default(null),
    rewardType,
    rewardValue: z.number().int().min(0),
    minOrderPaise: paise.default(0),
    validFrom: instant.nullable().default(null),
    validTill: instant.nullable().default(null),
    /** Across all customers; null = unlimited. */
    maxUses: z.number().int().min(1).nullable().default(null),
    /** Per customer; null = unlimited. One by default, because that is what a code usually means. */
    maxUsesPerCustomer: z.number().int().min(1).nullable().default(1),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.rewardType !== 'PERCENT_OFF' || v.rewardValue <= 100, {
    message: 'A percentage cannot be more than 100.',
    path: ['rewardValue'],
  })
  .refine(
    (v) => v.validFrom === null || v.validTill === null || new Date(v.validFrom) < new Date(v.validTill),
    { message: 'The code must start before it ends.', path: ['validTill'] },
  );
export type CouponInput = z.infer<typeof couponInput>;

/** Manually granted reward — the "sorry about the wait" lever every counter needs. */
export const grantRewardInput = z.object({
  userId: uuid,
  rewardType,
  rewardValue: z.number().int().min(0),
  minOrderPaise: paise.default(0),
  validityDays: z.number().int().min(1).max(365).default(30),
  reason: z.string().max(200).optional(),
});
export type GrantRewardInput = z.infer<typeof grantRewardInput>;
