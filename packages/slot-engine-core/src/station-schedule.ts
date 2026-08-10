import { mergeIntervals, subtract } from './interval.js';
import type {
  AvailabilityInput,
  BlackoutInterval,
  Interval,
  StationId,
  StationInput,
} from './types.js';

/**
 * The derived per-station picture the rest of the engine works from.
 *
 * Two separate structures, because two different checks apply:
 *
 * - `sessionWindows` — where a **session** is allowed to sit: store hours minus blackouts.
 *   The session must fit entirely inside one of these. Its trailing buffer may not.
 *
 * - `blocked` — intervals already taken by bookings, each already including that booking's
 *   own trailing buffer. The new booking's `[start, end + buffer)` must not overlap these.
 *
 * - `freeGaps` — `sessionWindows` minus `blocked`. Used only for best-fit ranking during
 *   station assignment.
 */
export interface StationSchedule {
  readonly station: StationInput;
  readonly sessionWindows: readonly Interval[];
  readonly blocked: readonly Interval[];
  readonly freeGaps: readonly Interval[];
}

function blackoutsFor(
  stationId: StationId,
  blackouts: readonly BlackoutInterval[],
): Interval[] {
  return blackouts
    .filter((b) => b.stationId === null || b.stationId === stationId)
    .map((b) => ({ start: b.start, end: b.end }));
}

export function buildStationSchedules(input: AvailabilityInput): StationSchedule[] {
  const openWindows = mergeIntervals(input.openWindows);

  return input.stations.map((station) => {
    const sessionWindows = subtract(openWindows, blackoutsFor(station.id, input.blackouts));

    const blocked = mergeIntervals(
      input.busy
        .filter((b) => b.stationId === station.id)
        .map((b) => ({ start: b.start, end: b.blockedUntil })),
    );

    return {
      station,
      sessionWindows,
      blocked,
      freeGaps: subtract(sessionWindows, blocked),
    };
  });
}
