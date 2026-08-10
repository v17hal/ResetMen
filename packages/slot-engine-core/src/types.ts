/**
 * Core types for the RESET slot & station engine.
 *
 * Design notes that matter:
 *
 * - `Instant` is epoch **milliseconds**, always UTC. The engine performs no timezone
 *   arithmetic at all: store hours, blackouts and allocation-rule windows are resolved to
 *   absolute instants by the caller (`AvailabilityService`) before they reach here. That is
 *   what keeps this package free of any date library and trivially testable.
 *
 * - Every interval is half-open `[start, end)`. A booking that ends at 09:15 and one that
 *   starts at 09:15 do not overlap.
 *
 * - "Station" is the internal name for a bed/table. It is never exposed to customers.
 */

/** Epoch milliseconds, UTC. */
export type Instant = number;

/** A whole number of minutes. */
export type Minutes = number;

export type StationId = string;
export type ServiceId = string;

/** Half-open interval `[start, end)`. */
export interface Interval {
  readonly start: Instant;
  readonly end: Instant;
}

export interface StationInput {
  readonly id: StationId;
  /** Deterministic tie-breaker in assignment. Lower wins. */
  readonly sortOrder: number;
  /** When true, `serviceIds` is ignored and the station can host anything. */
  readonly allowsAllServices: boolean;
  /** Services this station is designated for. Only consulted when `allowsAllServices` is false. */
  readonly serviceIds: readonly ServiceId[];
}

export type AllocationMode = 'EXCLUSIVE_TO' | 'EXCLUDE_FROM';

/**
 * An allocation rule already resolved to absolute instants for the requested date.
 *
 * `EXCLUSIVE_TO` — the listed stations may serve **only** the listed services in the window.
 * `EXCLUDE_FROM` — the listed stations may **not** serve the listed services in the window.
 */
export interface ResolvedAllocationRule {
  readonly id: string;
  readonly mode: AllocationMode;
  /** Higher wins when two rules both apply to the same station and interval. */
  readonly priority: number;
  readonly window: Interval;
  readonly stationIds: readonly StationId[];
  readonly serviceIds: readonly ServiceId[];
}

/**
 * A booking that occupies a station. `blockedUntil` already includes that booking's own
 * trailing buffer, so the engine never has to know which buffer produced it.
 */
export interface BusyInterval {
  readonly stationId: StationId;
  readonly start: Instant;
  readonly blockedUntil: Instant;
}

/** `stationId: null` blacks out the whole store (holiday); otherwise one station. */
export interface BlackoutInterval {
  readonly stationId: StationId | null;
  readonly start: Instant;
  readonly end: Instant;
}

export interface EngineSettings {
  readonly bufferMinutes: Minutes;
  readonly slotGranularityMinutes: Minutes;
  readonly minLeadMinutes: Minutes;
}

export interface ServiceInput {
  readonly id: ServiceId;
  readonly durationMinutes: Minutes;
  /** Falls back to `settings.bufferMinutes` when null. */
  readonly bufferOverrideMinutes: Minutes | null;
}

export interface AddonInput {
  readonly durationDeltaMinutes: Minutes;
}

export interface AvailabilityInput {
  readonly now: Instant;
  readonly service: ServiceInput;
  readonly addons: readonly AddonInput[];
  readonly stations: readonly StationInput[];
  /** That date's store hours, resolved to instants. May be split (e.g. a lunch break). */
  readonly openWindows: readonly Interval[];
  readonly blackouts: readonly BlackoutInterval[];
  /** Active bookings only: HELD (unexpired), CONFIRMED, CHECKED_IN, IN_PROGRESS. */
  readonly busy: readonly BusyInterval[];
  readonly allocationRules: readonly ResolvedAllocationRule[];
  readonly settings: EngineSettings;
}

export interface Slot {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
  /** How many stations could take this slot. Drives the "only 1 left" cue. */
  readonly stationsAvailable: number;
}

export interface AvailabilityResult {
  /** Service duration plus every selected add-on's duration delta. */
  readonly sessionDurationMinutes: Minutes;
  readonly bufferMinutes: Minutes;
  readonly slots: readonly Slot[];
}

export interface StationAssignment {
  readonly stationId: StationId;
  readonly startsAt: Instant;
  /** `startsAt + sessionDuration`. */
  readonly endsAt: Instant;
  /** `endsAt + buffer` — the value written to `bookings.blocked_until`. */
  readonly blockedUntil: Instant;
}

export const MINUTE_MS = 60_000;

export function minutesToMs(minutes: Minutes): number {
  return minutes * MINUTE_MS;
}
