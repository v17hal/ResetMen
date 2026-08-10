import type { Instant, Interval } from './types.js';

/** True when the interval covers a positive amount of time. */
export function isNonEmpty(i: Interval): boolean {
  return i.end > i.start;
}

/**
 * Half-open overlap: `[a.start, a.end)` ∩ `[b.start, b.end)` ≠ ∅.
 *
 * A zero-length interval intersects nothing — checked explicitly, because the naive
 * `a.start < b.end && b.start < a.end` reports `[5,5)` as overlapping `[0,10)`. That would
 * let a zero-length allocation-rule window silently apply to every session inside it.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return isNonEmpty(a) && isNonEmpty(b) && a.start < b.end && b.start < a.end;
}

/** True when `inner` sits entirely inside `outer`. */
export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function containsInstant(i: Interval, t: Instant): boolean {
  return i.start <= t && t < i.end;
}

/** Sort ascending by start, then end. Does not mutate the input. */
export function sortIntervals(intervals: readonly Interval[]): Interval[] {
  return [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Merge overlapping and touching intervals into a minimal disjoint set. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = sortIntervals(intervals.filter(isNonEmpty));
  const merged: Interval[] = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && current.start <= last.end) {
      if (current.end > last.end) {
        merged[merged.length - 1] = { start: last.start, end: current.end };
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

/**
 * Remove `cuts` from `base`, returning a sorted, disjoint set of what is left.
 *
 * This is the workhorse of the engine: store hours minus blackouts, and open time minus
 * bookings, are both expressed with it.
 */
export function subtract(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const mergedCuts = mergeIntervals(cuts);
  const result: Interval[] = [];

  for (const window of mergeIntervals(base)) {
    let cursor = window.start;

    for (const cut of mergedCuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= window.end) break;

      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start, window.end) });
      }
      cursor = Math.max(cursor, cut.end);
      if (cursor >= window.end) break;
    }

    if (cursor < window.end) {
      result.push({ start: cursor, end: window.end });
    }
  }

  return result.filter(isNonEmpty);
}

/** The first interval in `intervals` that contains instant `t`, or undefined. */
export function findContaining(
  intervals: readonly Interval[],
  t: Instant,
): Interval | undefined {
  return intervals.find((i) => containsInstant(i, t));
}

/** True when any interval in the set overlaps `probe`. */
export function overlapsAny(intervals: readonly Interval[], probe: Interval): boolean {
  return intervals.some((i) => overlaps(i, probe));
}

/** True when `probe` fits entirely inside at least one interval of the set. */
export function fitsWithinAny(intervals: readonly Interval[], probe: Interval): boolean {
  return intervals.some((i) => contains(i, probe));
}
