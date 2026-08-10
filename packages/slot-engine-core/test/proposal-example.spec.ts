import { describe, expect, it } from 'vitest';

import { assignStation, computeAvailability } from '../src/index.js';
import { SERVICES, at, busy, hhmm, makeInput, times } from './helpers.js';

/**
 * The worked example from the signed proposal, §4.2.
 *
 * 3 stations · 5-minute buffer · everything booked at 9:00 AM:
 *
 * | Station | Service   | Duration | Ends  | Buffer ends | Free from |
 * |---------|-----------|----------|-------|-------------|-----------|
 * | 1       | Head      | 10 min   | 9:10  | 9:15        | 9:15      |
 * | 2       | Full Body | 30 min   | 9:30  | 9:35        | 9:35      |
 * | 3       | Full Body | 30 min   | 9:30  | 9:35        | 9:35      |
 *
 * "So when the next customer opens the app at 9:05 AM, the system shows 9:15 AM as the
 *  earliest available slot, because Bed 1 is the first to free up."
 *
 * This is the contract test for the whole product. If it ever fails, nothing else matters.
 */
describe('proposal §4.2 — the worked example', () => {
  const nineAmBookings = [
    busy('stn_1', '09:00', 10),
    busy('stn_2', '09:00', 30),
    busy('stn_3', '09:00', 30),
  ];

  it('shows 9:15 AM as the earliest slot for a customer arriving at 9:05', () => {
    const result = computeAvailability(
      makeInput({ now: '09:05', service: SERVICES.head, busy: nineAmBookings }),
    );

    expect(result.slots.length).toBeGreaterThan(0);
    expect(hhmm(result.slots[0]!.startsAt)).toBe('09:15');
  });

  it('offers nothing before 9:15 — 9:05 and 9:10 fall inside the buffer', () => {
    const result = computeAvailability(
      makeInput({ now: '09:05', service: SERVICES.head, busy: nineAmBookings }),
    );

    expect(times(result.slots)).not.toContain('09:05');
    expect(times(result.slots)).not.toContain('09:10');
  });

  it('reports exactly one station at 9:15 and all three from 9:35', () => {
    const result = computeAvailability(
      makeInput({ now: '09:05', service: SERVICES.head, busy: nineAmBookings }),
    );

    const slotAt = (t: string) => result.slots.find((s) => hhmm(s.startsAt) === t);

    expect(slotAt('09:15')?.stationsAvailable).toBe(1);
    expect(slotAt('09:20')?.stationsAvailable).toBe(1);
    expect(slotAt('09:35')?.stationsAvailable).toBe(3);
  });

  it('assigns Station 1 at 9:15 — the first station to free up', () => {
    const input = makeInput({
      now: '09:05',
      service: SERVICES.head,
      busy: nineAmBookings,
    });

    const assignment = assignStation(input, at('09:15'));

    expect(assignment).not.toBeNull();
    expect(assignment!.stationId).toBe('stn_1');
    expect(hhmm(assignment!.endsAt)).toBe('09:25');
    expect(hhmm(assignment!.blockedUntil)).toBe('09:30');
  });

  it('never exposes a station in the availability result', () => {
    const result = computeAvailability(
      makeInput({ now: '09:05', service: SERVICES.head, busy: nineAmBookings }),
    );

    for (const slot of result.slots) {
      expect(Object.keys(slot).sort()).toEqual(['endsAt', 'startsAt', 'stationsAvailable']);
    }
  });
});
