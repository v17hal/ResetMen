import { bookableStations } from './bookable-stations.js';
import { effectiveBufferMinutes, sessionDurationMinutes } from './compute-availability.js';
import { findContaining } from './interval.js';
import { isReservedForService } from './station-eligibility.js';
import { buildStationSchedules } from './station-schedule.js';
import type { StationSchedule } from './station-schedule.js';
import { minutesToMs } from './types.js';
import type {
  AvailabilityInput,
  Instant,
  Interval,
  ResolvedAllocationRule,
  ServiceId,
  StationAssignment,
} from './types.js';

/**
 * How much time this placement wastes inside the free gap it lands in.
 *
 * Lower is better. Best-fit packing fills small gaps first and preserves long contiguous
 * blocks — without it, a stream of 10-minute bookings scattered across empty stations
 * fragments the whole day into 10-minute holes and no 30-minute Premium can ever be booked.
 * Keeping the high-value services sellable is the entire point.
 */
function fragmentationScore(schedule: StationSchedule, blocking: Interval): number {
  const gap = findContaining(schedule.freeGaps, blocking.start);
  if (gap === undefined) return Number.MAX_SAFE_INTEGER;

  const leading = blocking.start - gap.start;
  const trailing = Math.max(0, gap.end - blocking.end);
  return leading + trailing;
}

/**
 * How narrowly designated this station is. Lower sorts first, so a station that can only
 * host Head Massage takes the Head Massage and the general-purpose stations stay free.
 *
 * General-purpose stations get `MAX_SAFE_INTEGER` rather than `Infinity` deliberately:
 * `Infinity - Infinity` is `NaN`, and a comparator that returns `NaN` makes `Array.sort`
 * non-deterministic — which would break the engine's determinism guarantee in exactly the
 * common case where every station is general-purpose.
 */
function specialisation(schedule: StationSchedule): number {
  return schedule.station.allowsAllServices
    ? Number.MAX_SAFE_INTEGER
    : schedule.station.serviceIds.length;
}

interface Ranked {
  readonly schedule: StationSchedule;
  readonly reservedForThisService: boolean;
  readonly fragmentation: number;
  readonly specialisation: number;
}

function rank(
  schedules: readonly StationSchedule[],
  serviceId: ServiceId,
  session: Interval,
  blocking: Interval,
  rules: readonly ResolvedAllocationRule[],
): Ranked[] {
  const ranked = schedules.map<Ranked>((schedule) => ({
    schedule,
    reservedForThisService: isReservedForService(schedule.station, serviceId, session, rules),
    fragmentation: fragmentationScore(schedule, blocking),
    specialisation: specialisation(schedule),
  }));

  return ranked.sort(
    (a, b) =>
      // 1. Purpose — reserved capacity is consumed by the service it was reserved for first,
      //    leaving general stations for services that have nowhere else to go.
      Number(b.reservedForThisService) - Number(a.reservedForThisService) ||
      // 2. Tightest fit.
      a.fragmentation - b.fragmentation ||
      // 3. Most specialised station first.
      a.specialisation - b.specialisation ||
      // 4. Deterministic tie-breaks.
      a.schedule.station.sortOrder - b.schedule.station.sortOrder ||
      (a.schedule.station.id < b.schedule.station.id ? -1 : 1),
  );
}

/**
 * Pick the station for a booking the customer has already chosen a time for.
 *
 * Returns `null` when the time is not bookable at all — the caller turns that into
 * `409 SLOT_UNAVAILABLE` with a freshly computed slot list.
 *
 * The customer never sees the result of this function; the proposal's guarantee is that
 * they pick a time and the system silently assigns the optimal station.
 */
export function assignStation(
  input: AvailabilityInput,
  startsAt: Instant,
): StationAssignment | null {
  const sessionMs = minutesToMs(sessionDurationMinutes(input));
  const bufferMs = minutesToMs(effectiveBufferMinutes(input));

  const session = { start: startsAt, end: startsAt + sessionMs };
  const blocking = { start: startsAt, end: startsAt + sessionMs + bufferMs };

  const schedules = buildStationSchedules(input);
  const candidates = bookableStations(
    schedules,
    input.service.id,
    session,
    blocking,
    input.allocationRules,
  );

  const best = rank(candidates, input.service.id, session, blocking, input.allocationRules)[0];
  if (best === undefined) return null;

  return {
    stationId: best.schedule.station.id,
    startsAt: session.start,
    endsAt: session.end,
    blockedUntil: blocking.end,
  };
}
