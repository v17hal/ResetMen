'use client';

import { useEffect, useState } from 'react';
import { motion } from '@reset/design-tokens';

/** Beyond this many items the per-item delay stops growing. */
const STAGGER_CAP = motion.staggerMaxItems;

/**
 * Gap between consecutive items.
 *
 * `base / staggerMaxItems` — the whole cascade finishes in roughly one base duration, so a
 * list of eight never takes longer to appear than the screen transition that revealed it.
 */
const STAGGER_STEP_MS = Math.round(motion.duration.base / motion.staggerMaxItems);

/**
 * Tracks `prefers-reduced-motion`.
 *
 * Starts false and corrects after mount rather than reading during render: `matchMedia` does
 * not exist on the server, and a value that differs between the server render and the first
 * client render is a hydration mismatch. One frame of animation for someone who asked for
 * none is a smaller failure than React discarding the tree.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Per-item delay for the staggered fade-and-rise.
 *
 * Two departures from the Best-Flutter-UI-Templates reference this motion is taken from:
 *
 *  1. **Capped at `staggerMaxItems`.** The reference computes each item's interval as
 *     `(1 / count) * index`, so a 40-item list gives every item a 2.5% slice of the
 *     timeline — imperceptible individually, and the last items land well after the user has
 *     started scrolling. Past the cap the delay stops growing and the tail simply fades in.
 *  2. **Never used for slot chips.** The slot picker is the one screen where someone is
 *     scanning for a specific time under mild time pressure; animating sixty chips in
 *     sequence delays the only information they came for.
 *
 * Returns a style object rather than a class, because the delay varies per index and
 * Tailwind cannot generate an unbounded set of delay utilities at build time.
 */
export function staggerStyle(index: number, reduced = false): React.CSSProperties {
  if (reduced) return {};
  return { animationDelay: `${Math.min(index, STAGGER_CAP) * STAGGER_STEP_MS}ms` };
}

/**
 * Class plus per-item delay for a staggered list.
 *
 * ```tsx
 * const reduced = useReducedMotion();
 * {services.map((service, i) => (
 *   <ServiceCard key={service.id} {...stagger(i, reduced)} service={service} />
 * ))}
 * ```
 */
export function stagger(
  index: number,
  reduced = false,
): { className: string; style: React.CSSProperties } {
  return {
    className: reduced ? '' : 'animate-rise-in',
    style: staggerStyle(index, reduced),
  };
}
