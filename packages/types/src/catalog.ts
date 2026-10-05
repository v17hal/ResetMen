import { z } from 'zod';

import { localDate, paise, uuid } from './common.js';

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a lowercase, hyphenated slug');

export const segmentInput = z.object({
  name: z.string().min(1).max(60),
  slug,
  imageUrl: z.string().url().nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type SegmentInput = z.infer<typeof segmentInput>;

export const categoryInput = z.object({
  segmentId: uuid,
  name: z.string().min(1).max(80),
  slug,
  description: z.string().max(500).nullable().default(null),
  imageUrl: z.string().url().nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const serviceInput = z.object({
  categoryId: uuid,
  name: z.string().min(1).max(100),
  slug,
  description: z.string().max(1000).nullable().default(null),
  imageUrl: z.string().url().nullable().default(null),
  pricePaise: paise,
  /**
   * Required and positive. The availability engine cannot schedule a service without a
   * duration, so a service with none can never be published — this is what keeps the
   * unpriced Instant Glow placeholders invisible to customers.
   */
  durationMinutes: z.number().int().min(1).max(480),
  bufferOverrideMinutes: z.number().int().min(0).max(120).nullable().default(null),
  maxPerSlot: z.number().int().min(1).nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),

  // How the menu presents it — client request 11/09/2026. Display only.

  /** "💆‍♂️". Short enough for one emoji and its skin-tone and gender modifiers. */
  emoji: z.string().trim().max(16).nullable().default(null),
  /** "Head, Neck & Shoulder" — one line under the name. */
  tagline: z.string().trim().max(80).nullable().default(null),
  /** The struck-through "was" price. Only shown when above the price. */
  compareAtPricePaise: paise.nullable().default(null),
  /** "BESTSELLER". */
  badge: z.string().trim().max(20).nullable().default(null),
});
export type ServiceInput = z.infer<typeof serviceInput>;

/** A home-screen promotion. The image is uploaded through /admin/media first. */
/**
 * Who the shop serves — client request 14/09/2026, "how do I turn the female option on
 * later". One switch in the admin panel: it changes the wording on the website, in the app
 * and in the data Google reads. It does not touch the catalog, the stations or who may book,
 * because none of those are decided by this.
 */
export const storeAudience = z.enum(['MEN_ONLY', 'EVERYONE']);
export type StoreAudience = z.infer<typeof storeAudience>;

/** Used wherever the shop has not written its own line. */
export const DEFAULT_TAGLINE: Record<StoreAudience, string> = {
  MEN_ONLY:
    'Quick dry massage and wellness for men — head, neck, shoulder and full body. ' +
    'Ten to thirty minutes, walk straight in.',
  EVERYONE:
    'Quick dry massage and wellness — head, neck, shoulder and full body. ' +
    'Ten to thirty minutes, walk straight in.',
};

/** What the admin panel may change about the shop itself. Hours live under Capacity. */
export const storeProfileInput = z.object({
  name: z.string().trim().min(2, 'The shop needs a name.').max(60),
  /**
   * An emptied box means "use the standard wording", not "publish nothing" — so blank
   * becomes null here rather than failing the minimum length. Without this the API refused
   * to let a shop undo its own sentence.
   */
  tagline: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z
      .string()
      .trim()
      .min(10, 'A line customers read — ten characters at least.')
      .max(200, 'Keep it under 200 characters; it is one line, not a paragraph.')
      .nullable()
      .default(null),
  ),
  /** Shown above "Book your reset" on the website and in the app. */
  logoUrl: z.string().url().nullable().default(null),
  address: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().max(60).nullable().default(null),
  pincode: z.string().trim().max(12).nullable().default(null),
  phone: z.string().trim().max(20).nullable().default(null),
  audience: storeAudience,
});
export type StoreProfileInput = z.infer<typeof storeProfileInput>;

export const bannerMedia = z.enum(['IMAGE', 'VIDEO']);
export type BannerMedia = z.infer<typeof bannerMedia>;

/** Where a banner appears — client request 05/10/2026. */
export const bannerPlacement = z.enum(['HOME', 'CATEGORY', 'SERVICE']);
export type BannerPlacement = z.infer<typeof bannerPlacement>;

export const bannerInput = z
  .object({
    /** The picture or the MP4. `mediaType` says which. */
    imageUrl: z.string().url(),
    mediaType: bannerMedia.default('IMAGE'),
    altText: z
      .string()
      .trim()
      .min(3, 'Describe the picture — screen readers and Google cannot read the artwork.')
      .max(160),
    /** Where a tap goes. Null makes the banner decorative. */
    serviceId: uuid.nullable().default(null),
    /** Where it appears, which is a different question from where a tap goes. */
    placement: bannerPlacement.default('HOME'),
    placementCategoryId: uuid.nullable().default(null),
    placementServiceId: uuid.nullable().default(null),
    sortOrder: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    // A banner placed nowhere renders nowhere, and the shop would have no way of telling
    // why the thing it just uploaded is invisible.
    if (value.placement === 'CATEGORY' && value.placementCategoryId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['placementCategoryId'],
        message: 'Choose which category this banner belongs to.',
      });
    }
    if (value.placement === 'SERVICE' && value.placementServiceId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['placementServiceId'],
        message: 'Choose which service this banner belongs to.',
      });
    }
  });
export type BannerInput = z.infer<typeof bannerInput>;

export const addonGroupInput = z
  .object({
    name: z.string().min(1).max(80),
    minSelect: z.number().int().min(0).default(0),
    maxSelect: z.number().int().min(1).default(1),
    sortOrder: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.maxSelect >= v.minSelect, {
    message: 'maxSelect must be at least minSelect.',
    path: ['maxSelect'],
  });
export type AddonGroupInput = z.infer<typeof addonGroupInput>;

export const addonOptionInput = z.object({
  name: z.string().min(1).max(80),
  priceDeltaPaise: paise,
  durationDeltaMinutes: z.number().int().min(0).max(120).default(0),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type AddonOptionInput = z.infer<typeof addonOptionInput>;

export const reorderInput = z.object({
  items: z.array(z.object({ id: uuid, sortOrder: z.number().int().nonnegative() })),
});

export const availabilityQuery = z.object({
  serviceId: uuid,
  date: localDate,
  addonOptionIds: z.array(uuid).default([]),
});

export const slot = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  /** Drives the "only 1 left" cue. Station identity is never exposed. */
  stationsAvailable: z.number().int().positive(),
});
export type Slot = z.infer<typeof slot>;
