/**
 * The MEN menu, exactly as photographed by the client.
 *
 * Prices are in paise. ₹49 → 4900.
 *
 * Instant Glow ships with `isActive: false` because the menu photo has no price or duration
 * for its three services, and the availability engine cannot schedule a service without a
 * duration. The category stays invisible to customers until the owner fills those in from
 * the admin panel. Tracked as docs/10-open-questions.md#q2.
 */

export interface SeedAddonOption {
  readonly name: string;
  readonly pricePaise: number;
  readonly durationDeltaMinutes?: number;
}

export interface SeedAddonGroup {
  readonly key: string;
  readonly name: string;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly SeedAddonOption[];
}

export interface SeedService {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly pricePaise: number;
  readonly durationMinutes: number;
  readonly isActive: boolean;
  /** Keys into ADDON_GROUPS. The menu writes "same" against repeated groups. */
  readonly addonGroupKeys: readonly string[];
}

export interface SeedCategory {
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly services: readonly SeedService[];
}

export const ADDON_GROUPS: readonly SeedAddonGroup[] = [
  {
    key: 'oil-choice',
    name: 'Oil choice',
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: 'Non-Sticky', pricePaise: 1000 },
      { name: 'Hair Fall (Bhringraj)', pricePaise: 2000 },
      { name: 'Almond', pricePaise: 3000 },
    ],
  },
  {
    key: 'gel-choice',
    name: 'Gel choice',
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: 'Aloe Vera', pricePaise: 5000 },
      { name: 'Aloe Vera Mint Gel', pricePaise: 10000 },
    ],
  },
];

export const MEN_CATEGORIES: readonly SeedCategory[] = [
  {
    name: 'Stress Relief',
    slug: 'stress-relief',
    description: 'Short, targeted sessions that undo a long day in minutes.',
    services: [
      {
        name: 'Head',
        slug: 'head',
        description: 'A focused 10-minute head session. The quickest reset there is.',
        pricePaise: 4900,
        durationMinutes: 10,
        isActive: true,
        addonGroupKeys: ['oil-choice'],
      },
      {
        name: 'Head + Neck + Shoulder',
        slug: 'head-neck-shoulder',
        description: 'Loosen up the whole upper body in fifteen minutes.',
        pricePaise: 9900,
        durationMinutes: 15,
        isActive: true,
        addonGroupKeys: ['oil-choice'],
      },
      {
        name: 'Head + Neck + Shoulder + Back',
        slug: 'head-neck-shoulder-back',
        description: 'Full upper-body reset, back included.',
        pricePaise: 14900,
        durationMinutes: 20,
        isActive: true,
        addonGroupKeys: ['oil-choice'],
      },
    ],
  },
  {
    name: 'Full Body Relax',
    slug: 'full-body-relax',
    description: 'Head to toe. Walk out lighter than you walked in.',
    services: [
      {
        name: 'Basic',
        slug: 'full-body-basic',
        description: 'Twenty minutes, head to toe.',
        pricePaise: 19900,
        durationMinutes: 20,
        isActive: true,
        addonGroupKeys: [],
      },
      {
        name: 'Premium',
        slug: 'full-body-premium',
        description: 'Thirty minutes, with your choice of gel.',
        pricePaise: 29900,
        durationMinutes: 30,
        isActive: true,
        addonGroupKeys: ['gel-choice'],
      },
    ],
  },
  {
    name: 'Instant Glow',
    slug: 'instant-glow',
    description: 'Quick grooming pick-me-ups.',
    services: [
      {
        name: 'Facial Mask',
        slug: 'facial-mask',
        description: 'Pricing and duration to be confirmed by the store owner.',
        pricePaise: 0,
        // Placeholder. The service cannot be published until the owner sets a real duration.
        durationMinutes: 15,
        isActive: false,
        addonGroupKeys: [],
      },
      {
        name: 'Face De-Tan',
        slug: 'face-de-tan',
        description: 'Pricing and duration to be confirmed by the store owner.',
        pricePaise: 0,
        durationMinutes: 15,
        isActive: false,
        addonGroupKeys: [],
      },
      {
        name: 'Scrub',
        slug: 'scrub',
        description: 'Pricing and duration to be confirmed by the store owner.',
        pricePaise: 0,
        durationMinutes: 15,
        isActive: false,
        addonGroupKeys: [],
      },
    ],
  },
];
