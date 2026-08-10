import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional classes, with later Tailwind utilities beating earlier ones.
 *
 * Plain `clsx` would emit `px-4 px-6` and leave the winner to CSS source order, which for a
 * component that accepts a `className` prop means the caller's override loses at random.
 * `twMerge` resolves conflicts by group, so `cn('px-4', props.className)` behaves the way
 * everyone assumes it already does.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
