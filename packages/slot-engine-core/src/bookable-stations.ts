import { fitsWithinAny, overlapsAny } from './interval.js';
import { stationAllows } from './station-eligibility.js';
import type { StationSchedule } from './station-schedule.js';
import type { Interval, ResolvedAllocationRule, ServiceId } from './types.js';

/**
 * Can this station take a session `[start, end)` whose trailing buffer runs to
 * `blocking.end`?
 *
 * Three checks, and two deliberate asymmetries between them:
 *
 * 1. **The session must fit inside an open window** (store hours minus blackouts).
 *    The *buffer* is allowed to run past closing — cleaning happens after the shutters come
 *    down, and requiring otherwise would throw away the last bookable slot of every day.
 *
 * 2. **`[start, end + buffer)` must not overlap anything already booked.**
 *    Existing bookings carry their own trailing buffer in `blockedUntil`, so the gap is
 *    respected in both directions with no special casing.
 *
 * 3. **The station must be allowed to host this service** — static designation plus any
 *    allocation rule in force over the session.
 */
export function stationCanTake(
  schedule: StationSchedule,
  serviceId: ServiceId,
  session: Interval,
  blocking: Interval,
  rules: readonly ResolvedAllocationRule[],
): boolean {
  return (
    fitsWithinAny(schedule.sessionWindows, session) &&
    !overlapsAny(schedule.blocked, blocking) &&
    stationAllows(schedule.station, serviceId, session, rules)
  );
}

/** Every station that could take this session, in input order. */
export function bookableStations(
  schedules: readonly StationSchedule[],
  serviceId: ServiceId,
  session: Interval,
  blocking: Interval,
  rules: readonly ResolvedAllocationRule[],
): StationSchedule[] {
  return schedules.filter((schedule) =>
    stationCanTake(schedule, serviceId, session, blocking, rules),
  );
}
