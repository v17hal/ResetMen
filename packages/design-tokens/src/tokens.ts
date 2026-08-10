/**
 * RESET design tokens — the single source of truth.
 *
 * Emitted by `src/build.ts` to three targets so the app and the website cannot drift:
 *   • TypeScript object      → web + admin (Tailwind preset, component props)
 *   • CSS custom properties  → web + admin (`@reset/design-tokens/css`)
 *   • Dart `ResetTokens`     → apps/mobile
 *
 * Rationale for every value is in docs/08-ui-ux-design.md. Change it here, run
 * `pnpm gen:tokens`, and all three surfaces move together.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Colour
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The brand is a *fresh start*: a deep, calm base with one energising mint accent.
 *
 * Amber is reserved exclusively for rewards. When the accent colour only ever means
 * "you earned something", the streak ring and scratch card carry weight without needing
 * an animation to explain themselves.
 */
export const colors = {
  light: {
    bg: '#F8F6F2',
    surface: '#FFFFFF',
    surface2: '#F1EDE6',
    border: '#E4DED4',
    text: '#0B0F14',
    textMuted: '#6B7280',
    primary: '#0E9F76',
    primaryFg: '#FFFFFF',
    accent: '#D97706',
    success: '#0E9F76',
    warning: '#B45309',
    danger: '#DC2626',
    info: '#2563EB',
  },
  dark: {
    bg: '#0B0F14',
    surface: '#12181F',
    surface2: '#1A222B',
    border: '#252F3A',
    text: '#F3F5F7',
    textMuted: '#9AA6B2',
    primary: '#12B886',
    primaryFg: '#05100C',
    accent: '#F59E0B',
    success: '#12B886',
    warning: '#F59E0B',
    danger: '#F87171',
    info: '#60A5FA',
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

// ─────────────────────────────────────────────────────────────────────────────
//  Typography
// ─────────────────────────────────────────────────────────────────────────────

export const fonts = {
  /** Screen and section titles. */
  display: 'Plus Jakarta Sans',
  /** Body copy. */
  body: 'Inter',
  /** Booking codes (RST-2K8F4M), times, prices — anything that must align in a column. */
  mono: 'JetBrains Mono',
} as const;

export interface TypeStyle {
  readonly font: keyof typeof fonts;
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: number;
  readonly letterSpacing: number;
}

export const typography = {
  display: { font: 'display', size: 32, lineHeight: 38, weight: 700, letterSpacing: -0.4 },
  h1: { font: 'display', size: 24, lineHeight: 30, weight: 700, letterSpacing: -0.3 },
  h2: { font: 'display', size: 20, lineHeight: 26, weight: 600, letterSpacing: -0.2 },
  body: { font: 'body', size: 16, lineHeight: 24, weight: 400, letterSpacing: 0 },
  bodySm: { font: 'body', size: 14, lineHeight: 20, weight: 400, letterSpacing: 0 },
  caption: { font: 'body', size: 12, lineHeight: 16, weight: 500, letterSpacing: 0.2 },
  mono: { font: 'mono', size: 16, lineHeight: 20, weight: 600, letterSpacing: 0.5 },
} as const satisfies Record<string, TypeStyle>;

export type TypeToken = keyof typeof typography;

// ─────────────────────────────────────────────────────────────────────────────
//  Spacing, radius
// ─────────────────────────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
  '5xl': 72,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  /** The default for cards. */
  lg: 16,
  xl: 24,
  full: 999,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Elevation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One soft shadow, used sparingly. Depth comes from surface tone, not stacked shadows.
 *
 * `card` is a softened take on the elevated-card treatment in the Best-Flutter-UI-Templates
 * reference: a wide, low-opacity blur that reads as lift rather than as a drawn outline.
 * The reference offsets its shadow diagonally (4, 4); we drop it straight down, because a
 * diagonal shadow implies a light source the rest of the interface never commits to.
 */
export const elevation = {
  none: { x: 0, y: 0, blur: 0, spread: 0, opacity: 0 },
  card: { x: 0, y: 4, blur: 16, spread: 0, opacity: 0.1 },
  raised: { x: 0, y: 8, blur: 24, spread: 0, opacity: 0.12 },
  overlay: { x: 0, y: 16, blur: 40, spread: 0, opacity: 0.18 },
} as const;

export type ElevationToken = keyof typeof elevation;

// ─────────────────────────────────────────────────────────────────────────────
//  Motion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The staggered fade-and-rise is the signature entry motion, taken from the
 * Best-Flutter-UI-Templates reference: each item in a list fades in while translating up
 * by `staggerRiseDistance`, with each successive item starting a fraction later.
 *
 * Two deliberate departures from the reference:
 *
 *  1. `staggerMaxItems` caps how many items stagger. The reference computes its interval as
 *     `(1 / count) * index`, which means a 40-item list gives each item a 2.5% slice of the
 *     timeline — imperceptible, and the last items arrive long after the user has started
 *     scrolling. Past the cap, items simply fade in.
 *
 *  2. Slot chips never stagger. Availability is the one screen where the user is scanning
 *     for a specific time under mild time pressure; animating 60 chips in sequence delays
 *     the only information they came for.
 *
 * Everything here is suppressed under `prefers-reduced-motion` / `MediaQuery.disableAnimations`.
 */
export const motion = {
  duration: {
    /** Micro-interactions: press states, toggles. */
    micro: 150,
    /** Screen transitions, sheets, card entry. */
    base: 250,
    /** Deliberate reveals: scratch card, streak ring fill. */
    slow: 600,
  },
  easing: {
    /** The workhorse. Matches Flutter's `Curves.fastOutSlowIn`. */
    standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },
  /** How far a list item travels up as it fades in, in logical pixels. */
  staggerRiseDistance: 40,
  /** Beyond this many items, entry is a plain fade with no per-item delay. */
  staggerMaxItems: 8,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Layout
// ─────────────────────────────────────────────────────────────────────────────

export const layout = {
  /** Minimum tap target. Admin uses 48 because the counter is used in a hurry. */
  touchTarget: 44,
  touchTargetAdmin: 48,
  /** Horizontal page gutter on mobile. */
  gutter: 20,
  /** Max content width on desktop web. */
  contentMaxWidth: 1120,
  bottomNavHeight: 62,
} as const;

export const tokens = {
  colors,
  fonts,
  typography,
  spacing,
  radius,
  elevation,
  motion,
  layout,
} as const;

export type Tokens = typeof tokens;
