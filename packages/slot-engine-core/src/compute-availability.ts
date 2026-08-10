import { bookableStations } from './bookable-stations.js';
import { candidateStartTimes } from './candidate-times.js';
import { buildStationSchedules } from './station-schedule.js';
import { minutesToMs } from './types.js';
import type { AvailabilityInput, AvailabilityResult, Minutes, Slot } from './types.js';

/** Service duration plus every selected add-on's duration delta. */
export function sessionDurationMinutes(input: AvailabilityInput): Minutes {
  return input.addons.reduce(
    (total, addon) => total + addon.durationDeltaMinutes,
    input.service.durationMinutes,
  );
}

/** Per-service buffer override, falling back to the store default. */
export function effectiveBufferMinutes(input: AvailabilityInput): Minutes {
  return input.service.bufferOverrideMinutes ?? input.settings.bufferMinutes;
}

/**
 * The engine's main entry point.
 *
 * Pure: no I/O, no clock access, no database. `input.now` is supplied by the caller (which
 * reads it from Postgres `now()`, never from an app server's clock). Same inputs always
 * produce the same output — slot lists that flicker between refreshes are undebuggable and
 * destroy trust.
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const durationMinutes = sessionDurationMinutes(input);
  const bufferMinutes = effectiveBufferMinutes(input);

  const sessionMs = minutesToMs(durationMinutes);
  const bufferMs = minutesToMs(bufferMinutes);

  if (durationMinutes <= 0) {
    throw new Error(
      `Service ${input.service.id} resolved to a session of ${durationMinutes} minutes. ` +
        'Every bookable service must have a positive duration.',
    );
  }

  const schedules = buildStationSchedules(input);
  const activeSchedules = schedules.filter((s) => s.sessionWindows.length > 0);

  const slots: Slot[] = [];

  for (const start of candidateStartTimes(input, activeSchedules, sessionMs)) {
    const session = { start, end: start + sessionMs };
    const blocking = { start, end: start + sessionMs + bufferMs };

    const available = bookableStations(
      activeSchedules,
      input.service.id,
      session,
      blocking,
      input.allocationRules,
    );

    if (available.length > 0) {
      slots.push({
        startsAt: session.start,
        endsAt: session.end,
        stationsAvailable: available.length,
      });
    }
  }

  return { sessionDurationMinutes: durationMinutes, bufferMinutes, slots };
}
