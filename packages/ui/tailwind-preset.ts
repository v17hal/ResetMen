import { layout, motion, radius, spacing, typography } from '@reset/design-tokens';
import type { Config } from 'tailwindcss';

/**
 * Tailwind preset generated from the design tokens.
 *
 * Colours resolve to CSS custom properties rather than hex literals, so `bg-surface` is one
 * class that follows the theme instead of two classes plus a `dark:` variant on every
 * element. The variables and their dark values come from `@reset/design-tokens/css`, which
 * both apps import once in their root layout.
 *
 * Scales that are *not* colour — spacing, radius, type, motion — are emitted as literals,
 * because Tailwind needs their values at build time to generate the utilities at all.
 *
 * Usage, in each app's tailwind.config.ts:
 *
 * ```ts
 * import preset from '@reset/ui/tailwind-preset';
 *
 * export default {
 *   presets: [preset],
 *   content: ['./src/**\/*.{ts,tsx}', '../../packages/ui/src/**\/*.{ts,tsx}'],
 * } satisfies Config;
 * ```
 *
 * The second content glob is not optional: without it Tailwind never sees the classes used
 * inside the shared components and silently ships them unstyled.
 */

const px = (value: number): string => `${value / 16}rem`;

const colorVar = (name: string) => `var(--reset-color-${name})`;

type FontSizeEntry = [string, { lineHeight: string; fontWeight: string; letterSpacing: string }];

/** `bodySm` is the token name; `text-body-sm` is the class anyone would guess. */
const fontSize: Record<string, FontSizeEntry> = Object.fromEntries(
  Object.entries(typography).map(([key, style]) => [
    key === 'bodySm' ? 'body-sm' : key,
    [
      px(style.size),
      {
        lineHeight: px(style.lineHeight),
        fontWeight: String(style.weight),
        letterSpacing: `${style.letterSpacing}px`,
      },
    ] satisfies FontSizeEntry,
  ]),
);

const preset: Omit<Config, 'content'> = {
  darkMode: ['class', ':root[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: colorVar('bg'),
        surface: colorVar('surface'),
        surface2: colorVar('surface2'),
        border: colorVar('border'),
        text: colorVar('text'),
        'text-muted': colorVar('text-muted'),
        primary: {
          DEFAULT: colorVar('primary'),
          fg: colorVar('primary-fg'),
        },
        /** Rewards only. When amber only ever means "you earned something", it carries weight. */
        accent: colorVar('accent'),
        success: colorVar('success'),
        warning: colorVar('warning'),
        danger: colorVar('danger'),
        info: colorVar('info'),
      },

      spacing: Object.fromEntries(
        Object.entries(spacing).map(([key, value]) => [key, px(value)]),
      ),

      borderRadius: Object.fromEntries(
        Object.entries(radius).map(([key, value]) => [key, px(value)]),
      ),

      fontFamily: {
        display: ['var(--reset-font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--reset-font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--reset-font-mono)', 'ui-monospace', 'monospace'],
      },

      fontSize,

      boxShadow: {
        card: 'var(--reset-elevation-card)',
        raised: 'var(--reset-elevation-raised)',
        overlay: 'var(--reset-elevation-overlay)',
      },

      transitionDuration: {
        micro: `${motion.duration.micro}ms`,
        base: `${motion.duration.base}ms`,
        slow: `${motion.duration.slow}ms`,
      },

      transitionTimingFunction: {
        standard: motion.easing.standard,
        decelerate: motion.easing.decelerate,
        accelerate: motion.easing.accelerate,
      },

      minHeight: {
        touch: px(layout.touchTarget),
        'touch-admin': px(layout.touchTargetAdmin),
      },
      minWidth: {
        touch: px(layout.touchTarget),
        'touch-admin': px(layout.touchTargetAdmin),
      },
      maxWidth: {
        content: px(layout.contentMaxWidth),
      },

      keyframes: {
        /** The signature entry motion: fade in while translating up. */
        'rise-in': {
          from: { opacity: '0', transform: `translateY(var(--reset-stagger-rise))` },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'rise-in': `rise-in ${motion.duration.base}ms ${motion.easing.decelerate} both`,
        'fade-in': `fade-in ${motion.duration.base}ms ${motion.easing.standard} both`,
        'scale-in': `scale-in ${motion.duration.micro}ms ${motion.easing.decelerate} both`,
        'slide-up': `slide-up ${motion.duration.base}ms ${motion.easing.decelerate} both`,
      },
    },
  },
};

export default preset;
