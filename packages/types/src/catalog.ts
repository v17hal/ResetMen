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
});
export type ServiceInput = z.infer<typeof serviceInput>;

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
