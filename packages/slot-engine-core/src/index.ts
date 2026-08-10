/**
 * `@reset/slot-engine-core`
 *
 * The availability and station-assignment engine for RESET.
 *
 * Everything in this package is a pure function over plain data. It never reads a clock,
 * a database, a cache or an environment variable. That is what makes it exhaustively
 * testable, and what lets it move to a cache or an edge worker later without changing.
 *
 * The engine decides *which* station is optimal. It does not decide whether a booking is
 * legal — that guarantee lives in Postgres, as a GiST exclusion constraint on
 * `bookings (station_id, [starts_at, blocked_until))`. Application logic can have a bug;
 * the constraint cannot be bypassed.
 */

export * from './types.js';
export * from './interval.js';
export * from './station-schedule.js';
export * from './station-eligibility.js';
export * from './bookable-stations.js';
export * from './candidate-times.js';
export * from './compute-availability.js';
export * from './assign-station.js';
