import { z } from 'zod';

import { instant, paise, uuid } from './common.js';

export const productOrderStatus = z.enum([
  'PENDING',
  'PAID',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CANCELLED',
]);
export type ProductOrderStatus = z.infer<typeof productOrderStatus>;

export const productDto = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  images: z.array(z.string()),
  pricePaise: paise,
  mrpPaise: paise.nullable(),
  /** Exposed as a flag, not a number — competitors should not be able to read the shelf. */
  inStock: z.boolean(),
  sku: z.string().nullable(),
});
export type ProductDto = z.infer<typeof productDto>;

export const cartLine = z.object({
  productId: uuid,
  qty: z.number().int().min(1).max(20),
});

export const createProductOrderRequest = z.object({
  items: z.array(cartLine).min(1).max(20),
});
export type CreateProductOrderRequest = z.infer<typeof createProductOrderRequest>;

export const productOrderDto = z.object({
  id: uuid,
  publicId: z.string(),
  status: productOrderStatus,
  totalPaise: paise,
  createdAt: instant,
  items: z.array(
    z.object({
      productId: uuid,
      name: z.string(),
      unitPricePaise: paise,
      qty: z.number().int(),
      linePaise: paise,
    }),
  ),
});
export type ProductOrderDto = z.infer<typeof productOrderDto>;

// ── Admin ───────────────────────────────────────────────────────────────────

export const productInput = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lower-case words separated by hyphens.'),
  description: z.string().max(2000).nullable().default(null),
  images: z.array(z.string().url()).max(8).default([]),
  pricePaise: paise,
  mrpPaise: paise.nullable().default(null),
  stockQty: z.number().int().min(0).default(0),
  sku: z.string().max(60).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type ProductInput = z.infer<typeof productInput>;

/** Signed delta rather than an absolute — two staff adjusting stock must not clobber each other. */
export const stockAdjustment = z.object({
  delta: z.number().int(),
  reason: z.string().max(200).optional(),
});
export type StockAdjustment = z.infer<typeof stockAdjustment>;

export const productOrderStatusChange = z.object({
  status: z.enum(['READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED']),
  reason: z.string().max(200).optional(),
});
