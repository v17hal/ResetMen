import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * The three families from docs/08 §2.2, self-hosted.
 *
 * `next/font` downloads them at build time and serves them from our own origin. That kills
 * the render-blocking request to a third-party CDN on the critical path — the thing the
 * design doc explicitly rules out — and `display: swap` plus the size-adjusted fallback
 * metrics mean text is readable immediately and does not jump when the real face lands.
 *
 * Exposed as CSS variables rather than classes, because `@reset/design-tokens/css` already
 * declares `--reset-font-display` and friends, and the Tailwind preset resolves through
 * them. Assigning here overrides those declarations with the hashed family names.
 */

export const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  // 600 and 700 only — those are the two weights the type scale actually uses. Shipping
  // the full range would be four more font files nobody sees.
  weight: ['600', '700'],
  display: 'swap',
  variable: '--reset-font-display',
});

export const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--reset-font-body',
});

/**
 * Booking codes, times and prices.
 *
 * Monospace so a column of prices lines up on the decimal, and so `RST-2K8F4M` cannot be
 * misread — in a proportional face `1`, `l` and `I` are close enough to cost a phone call
 * when someone reads their code out at the counter.
 */
export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--reset-font-mono',
});

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable}`;
