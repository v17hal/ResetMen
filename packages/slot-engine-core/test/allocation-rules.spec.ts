import { describe, expect, it } from 'vitest';

import { assignStation, computeAvailability } from '../src/index.js';
import { SERVICES, at, busy, hhmm, makeInput, rule } from './helpers.js';

/**
 * Client requirement, 02/08/2026:
 *
 *   "in the morning, I can push for ₹199 service. The system should allow me to allocate
 *    only a predefined number of beds exclusively for that service during that time. Those
 *    reserved beds should not be available for any other service until the allocated time
 *    slot ends."
 *
 * Setup for all of these: 3 stations, with Stations 2 and 3 reserved EXCLUSIVE_TO the ₹199
 * Basic service between 09:00 and 12:00.
 */
describe('allocation rules — the morning ₹199 push', () => {
  const morningPush = rule({
    id: 'rule_morning_199',
    mode: 'EXCLUSIVE_TO',
    window: { start: at('09:00'), end: at('12:00') },
    stationIds: ['stn_2', 'stn_3'],
    serviceIds: [SERVICES.basic.id],
  });

  const stationsAt = (service: typeof SERVICES.basic, time: string, now = '09:00') => {
    const result = computeAvailability(
      makeInput({ now, service, allocationRules: [morningPush] }),
    );
    return result.slots.find((s) => hhmm(s.startsAt) === time)?.stationsAvailable ?? 0;
  };

  it('gives the reserved service all three stations', () => {
    expect(stationsAt(SERVICES.basic, '10:00')).toBe(3);
  });

  it('leaves other services only the unreserved station during the window', () => {
    expect(stationsAt(SERVICES.head, '10:00')).toBe(1);
    expect(stationsAt(SERVICES.premium, '10:00')).toBe(1);
  });

  it('restores full capacity to every service after the window closes', () => {
    expect(stationsAt(SERVICES.head, '12:00')).toBe(3);
    expect(stationsAt(SERVICES.premium, '12:00')).toBe(3);
  });

  it('hides the slot entirely once the unreserved station is taken', () => {
    const result = computeAvailability(
      makeInput({
        service: SERVICES.head,
        allocationRules: [morningPush],
        busy: [busy('stn_1', '10:00', 30)],
      }),
    );

    const slot = result.slots.find((s) => hhmm(s.startsAt) === '10:00');
    expect(slot).toBeUndefined();

    // …while the reserved service still has both of its stations.
    expect(stationsAt(SERVICES.basic, '10:00')).toBe(3);
  });

  it('consumes reserved capacity first, keeping the general station free', () => {
    const input = makeInput({ service: SERVICES.basic, allocationRules: [morningPush] });
    const assignment = assignStation(input, at('10:00'));

    expect(assignment).not.toBeNull();
    expect(['stn_2', 'stn_3']).toContain(assignment!.stationId);
  });

  describe('spillover across the window edge', () => {
    it('still reserves a station for a session that runs past 12:00', () => {
      // Basic at 11:50 ends 12:10 — overlaps the window, so the rule applies.
      const input = makeInput({ service: SERVICES.basic, allocationRules: [morningPush] });
      const assignment = assignStation(input, at('11:50'));

      expect(['stn_2', 'stn_3']).toContain(assignment!.stationId);
    });

    it('refuses a non-reserved service that spills into the window', () => {
      // A 10-minute Head Massage at 11:55 overlaps the reserved window, so Stations 2 and 3
      // remain off-limits and only Station 1 is available.
      expect(stationsAt(SERVICES.head, '11:55')).toBe(1);
    });
  });

  describe('EXCLUDE_FROM mode', () => {
    const noPremiumOnStationOne = rule({
      id: 'rule_no_premium_stn1',
      mode: 'EXCLUDE_FROM',
      window: { start: at('09:00'), end: at('21:00') },
      stationIds: ['stn_1'],
      serviceIds: [SERVICES.premium.id],
    });

    it('blocks only the listed service on the listed station', () => {
      const premium = computeAvailability(
        makeInput({ service: SERVICES.premium, allocationRules: [noPremiumOnStationOne] }),
      );
      const head = computeAvailability(
        makeInput({ service: SERVICES.head, allocationRules: [noPremiumOnStationOne] }),
      );

      expect(premium.slots[0]?.stationsAvailable).toBe(2);
      expect(head.slots[0]?.stationsAvailable).toBe(3);
    });
  });

  describe('conflicting rules', () => {
    it('lets the higher-priority rule decide', () => {
      const broadBlock = rule({
        id: 'rule_a_block',
        mode: 'EXCLUDE_FROM',
        priority: 10,
        window: { start: at('09:00'), end: at('12:00') },
        stationIds: ['stn_2'],
        serviceIds: [SERVICES.head.id],
      });

      const narrowAllow = rule({
        id: 'rule_b_allow',
        mode: 'EXCLUSIVE_TO',
        priority: 500,
        window: { start: at('10:00'), end: at('11:00') },
        stationIds: ['stn_2'],
        serviceIds: [SERVICES.head.id],
      });

      const result = computeAvailability(
        makeInput({ service: SERVICES.head, allocationRules: [broadBlock, narrowAllow] }),
      );

      const at0930 = result.slots.find((s) => hhmm(s.startsAt) === '09:30');
      const at1030 = result.slots.find((s) => hhmm(s.startsAt) === '10:30');

      expect(at0930?.stationsAvailable).toBe(2); // stn_2 blocked by the low-priority rule
      expect(at1030?.stationsAvailable).toBe(3); // high-priority rule wins it back
    });
  });
});
