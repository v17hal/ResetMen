import { minutesToMs } from './types.js';
import type { AvailabilityInput, Instant } from './types.js';
import type { StationSchedule } from './station-schedule.js';

/**
 * Every start time worth testing, sorted ascending and de-duplicated.
 *
 * The set is the union of two sources:
 *
 * 1. **The grid** — every `slotGranularityMinutes` step from each open window's start.
 *    This is what customers expect to see: round, predictable times.
 *
 * 2. **Exact free-from moments** — the start of every free gap on every station.
 *    With 5-minute granularity and durations that are multiples of 5, these always land on
 *    the grid, so today this source is redundant. The moment someone creates a 12-minute
 *    service, or staff enter a walk-in at an off-grid time, a pure-grid engine silently
 *    hides genuinely bookable time. Including them costs nothing and makes the engine
 *    correct for inputs the admin panel does not yet forbid.
 *
 * Filtered to `t >= now + minLeadMinutes` and to times where the session could still fit
 * inside its open window.
 */
export function candidateStartTimes(
  input: AvailabilityInput,
  schedules: readonly StationSchedule[],
  sessionDurationMs: number,
): Instant[] {
  const granularityMs = minutesToMs(Math.max(1, input.settings.slotGranularityMinutes));
  const earliest = input.now + minutesToMs(input.settings.minLeadMinutes);

  const candidates = new Set<Instant>();

  for (const window of input.openWindows) {
    const latestStart = window.end - sessionDurationMs;
    for (let t = window.start; t <= latestStart; t += granularityMs) {
      if (t >= earliest) candidates.add(t);
    }
  }

  for (const schedule of schedules) {
    for (const gap of schedule.freeGaps) {
      if (gap.start >= earliest && gap.start + sessionDurationMs <= gap.end) {
        candidates.add(gap.start);
      }
    }
  }

  return [...candidates].sort((a, b) => a - b);
}
