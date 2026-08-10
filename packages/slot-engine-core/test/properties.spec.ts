import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assignStation,
  computeAvailability,
  overlaps,
  stationAllows,
} from '../src/index.js';
import type {
  AvailabilityInput,
  BusyInterval,
  ResolvedAllocationRule,
  ServiceInput,
  StationInput,
} from '../src/index.js';
import { SERVICES, at, makeInput, station } from './helpers.js';

/**
 * Property-based tests.
 *
 * The worked examples prove the engine handles the cases we thought of. These prove the
 * invariants hold for cases nobody thought of — which is the class of bug that produces a
 * double-booked station six months after launch.
 *
 * Each run simulates a whole trading day: repeatedly ask the engine what's free, book one of
 * the slots it offers, feed that back in as busy time, repeat. Then assert the invariants
 * over the resulting schedule.
 */

const ALL_SERVICES: ServiceInput[] = Object.values(SERVICES);

const arbStations: fc.Arbitrary<StationInput[]> = fc
  .array(
    fc.record({
      restricted: fc.boolean(),
      serviceIds: fc.subarray(
        ALL_SERVICES.map((s) => s.id),
        { minLength: 1 },
      ),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((specs) =>
    specs.map((spec, index) =>
      spec.restricted
        ? station(`stn_${index}`, index, spec.serviceIds)
        : station(`stn_${index}`, index),
    ),
  );

const arbRules: fc.Arbitrary<ResolvedAllocationRule[]> = fc.array(
  fc.record({
    id: fc.constantFrom('rule_a', 'rule_b'),
    mode: fc.constantFrom<'EXCLUSIVE_TO' | 'EXCLUDE_FROM'>('EXCLUSIVE_TO', 'EXCLUDE_FROM'),
    priority: fc.integer({ min: 0, max: 500 }),
    startHour: fc.integer({ min: 9, max: 18 }),
    lengthHours: fc.integer({ min: 1, max: 4 }),
    stationIndexes: fc.subarray([0, 1, 2, 3], { minLength: 1 }),
    serviceIds: fc.subarray(
      ALL_SERVICES.map((s) => s.id),
      { minLength: 1 },
    ),
  }),
  { maxLength: 2 },
).map((specs) =>
  specs.map((spec) => ({
    id: spec.id,
    mode: spec.mode,
    priority: spec.priority,
    window: {
      start: at(`${String(spec.startHour).padStart(2, '0')}:00`),
      end: at(`${String(Math.min(21, spec.startHour + spec.lengthHours)).padStart(2, '0')}:00`),
    },
    stationIds: spec.stationIndexes.map((i) => `stn_${i}`),
    serviceIds: spec.serviceIds,
  })),
);

const arbScenario = fc.record({
  stations: arbStations,
  allocationRules: arbRules,
  bufferMinutes: fc.constantFrom(0, 5, 10, 15),
  slotGranularityMinutes: fc.constantFrom(5, 10, 15, 30),
  /** Each step: which service to book, and which of the offered slots to take. */
  steps: fc.array(
    fc.record({
      serviceIndex: fc.integer({ min: 0, max: ALL_SERVICES.length - 1 }),
      slotPick: fc.double({ min: 0, max: 0.999, noNaN: true }),
    }),
    { maxLength: 25 },
  ),
});

interface Placed extends BusyInterval {
  readonly serviceId: string;
  readonly sessionEnd: number;
}

interface Scenario {
  readonly stations: StationInput[];
  readonly allocationRules: ResolvedAllocationRule[];
  readonly bufferMinutes: number;
  readonly slotGranularityMinutes: number;
  readonly steps: readonly { serviceIndex: number; slotPick: number }[];
}

interface DayResult {
  readonly placed: Placed[];
  readonly inputFor: (service: ServiceInput, busy: Placed[]) => AvailabilityInput;
}

function runDay(scenario: Scenario): DayResult {
  const inputFor = (service: ServiceInput, busy: Placed[]): AvailabilityInput =>
    makeInput({
      service,
      stations: scenario.stations,
      allocationRules: scenario.allocationRules,
      bufferMinutes: scenario.bufferMinutes,
      slotGranularityMinutes: scenario.slotGranularityMinutes,
      busy,
    });

  const placed: Placed[] = [];

  for (const step of scenario.steps) {
    const service = ALL_SERVICES[step.serviceIndex]!;
    const input = inputFor(service, placed);
    const { slots } = computeAvailability(input);
    if (slots.length === 0) continue;

    const slot = slots[Math.floor(step.slotPick * slots.length)]!;
    const assignment = assignStation(input, slot.startsAt);

    // INVARIANT 1 — anything the engine offers must be assignable.
    expect(assignment, `slot ${slot.startsAt} was offered but not assignable`).not.toBeNull();

    placed.push({
      stationId: assignment!.stationId,
      start: assignment!.startsAt,
      blockedUntil: assignment!.blockedUntil,
      sessionEnd: assignment!.endsAt,
      serviceId: service.id,
    });
  }

  return { placed, inputFor };
}

describe('engine invariants (property-based)', () => {
  it('never double-books a station, whatever the schedule', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { placed } = runDay(scenario);

        for (let a = 0; a < placed.length; a += 1) {
          for (let b = a + 1; b < placed.length; b += 1) {
            const first = placed[a]!;
            const second = placed[b]!;
            if (first.stationId !== second.stationId) continue;

            expect(
              overlaps(
                { start: first.start, end: first.blockedUntil },
                { start: second.start, end: second.blockedUntil },
              ),
              `overlap on ${first.stationId}`,
            ).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('never assigns a station that is not allowed to host the service', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { placed } = runDay(scenario);

        for (const booking of placed) {
          const stationInput = scenario.stations.find((s) => s.id === booking.stationId)!;

          expect(
            stationAllows(
              stationInput,
              booking.serviceId,
              { start: booking.start, end: booking.sessionEnd },
              scenario.allocationRules,
            ),
            `${booking.stationId} is not allowed to host ${booking.serviceId}`,
          ).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps every session inside store hours', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { placed } = runDay(scenario);

        for (const booking of placed) {
          expect(booking.start).toBeGreaterThanOrEqual(at('09:00'));
          expect(booking.sessionEnd).toBeLessThanOrEqual(at('21:00'));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic — identical inputs give identical results', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const first = runDay(scenario).placed;
        const second = runDay(scenario).placed;
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });

  it('offers a slot whenever at least one station could genuinely take it', () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const { placed, inputFor } = runDay(scenario);
        const service = ALL_SERVICES[0]!;
        const { slots } = computeAvailability(inputFor(service, placed));

        // Everything offered must still be assignable after the whole day is placed.
        for (const slot of slots) {
          expect(assignStation(inputFor(service, placed), slot.startsAt)).not.toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });
});
