import { typography } from '@reset/design-tokens';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The type scale's class names — `text-h1`, `text-body-sm` and so on — exactly as the
 * Tailwind preset names them (`bodySm` becomes `body-sm`).
 */
const FONT_SIZES = Object.keys(typography).map((key) => (key === 'bodySm' ? 'body-sm' : key));

/**
 * tailwind-merge, taught this design system's type scale.
 *
 * Out of the box it only knows Tailwind's own sizes (`text-sm`, `text-lg`). Anything else
 * after `text-` it assumes is a colour — so `text-body-sm` was filed as a colour, conflicted
 * with `text-primary-fg`, and deleted it because it came later. Every primary button in
 * both apps shipped with near-black text on green instead of white, and on the owner's
 * laptop the selected tab and "+ Add rule" read as blank dark blocks. Danger buttons lost
 * `text-white` the same way, and a ghost button given `text-danger` lost its font size.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
    },
  },
});

/**
 * Conditional classes, with later Tailwind utilities beating earlier ones.
 *
 * Plain `clsx` would emit `px-4 px-6` and leave the winner to CSS source order, which for a
 * component that accepts a `className` prop means the caller's override loses at random.
 * `twMerge` resolves conflicts by group, so `cn('px-4', props.className)` behaves the way
 * everyone assumes it already does.
 */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
