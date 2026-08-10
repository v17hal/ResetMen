import { describe, expect, it } from 'vitest';

import { computeAvailability } from '../src/index.js';
import { SERVICES, blackout, makeInput, station, times } from './helpers.js';

describe('store hours, blackouts and lead time', () => {
  const oneStation = [station('stn_1', 1)];

  it('lets the last session of the day end exactly at closing', () => {
    const result = computeAvailability(
      makeInput({ stations: oneStation, service: SERVICES.headNeckShoulderBack }), // 20 min
    );

    const last = times(result.slots).at(-1);
    expect(last).toBe('20:40'); // 20:40 + 20 = 21:00 exactly
  });

  it('allows the trailing buffer to run past closing', () => {
    // The 20:40 slot blocks until 21:05. Cleaning happens after the shutters come down —
    // refusing it would throw away the last bookable slot of every day.
    const result = computeAvailability(
      makeInput({ stations: oneStation, service: SERVICES.headNeckShoulderBack }),
    );

    expect(times(result.slots)).toContain('20:40');
    expect(times(result.slots)).not.toContain('20:45');
  });

  it('never lets a session straddle a lunch break', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.fullBody, // 30 min
        openWindows: [
          { start: '09:00', end: '13:00' },
          { start: '16:00', end: '21:00' },
        ],
      }),
    );

    const slots = times(result.slots);
    expect(slots).toContain('12:30'); // ends 13:00 exactly
    expect(slots).not.toContain('12:45'); // would end 13:15
    expect(slots).not.toContain('13:00');
    expect(slots).not.toContain('15:30');
    expect(slots).toContain('16:00');
  });

  it('removes a station for the length of its blackout', () => {
    const result = computeAvailability(
      makeInput({
        service: SERVICES.head,
        blackouts: [blackout('stn_3', '10:00', '12:00')],
      }),
    );

    const at = (t: string) => result.slots.find((s) => times([s])[0] === t);

    expect(at('09:30')?.stationsAvailable).toBe(3);
    expect(at('10:30')?.stationsAvailable).toBe(2);
    expect(at('12:00')?.stationsAvailable).toBe(3);
  });

  it('closes the whole store for a store-wide blackout', () => {
    const result = computeAvailability(
      makeInput({
        service: SERVICES.head,
        blackouts: [blackout(null, '09:00', '21:00')],
      }),
    );

    expect(result.slots).toHaveLength(0);
  });

  it('offers nothing on a closed day', () => {
    const result = computeAvailability(
      makeInput({ service: SERVICES.head, openWindows: [] }),
    );

    expect(result.slots).toHaveLength(0);
  });

  it('respects minimum lead time', () => {
    const result = computeAvailability(
      makeInput({ stations: oneStation, service: SERVICES.head, now: '10:00', minLeadMinutes: 30 }),
    );

    expect(times(result.slots)[0]).toBe('10:30');
  });

  it('never offers a time in the past', () => {
    const result = computeAvailability(
      makeInput({ stations: oneStation, service: SERVICES.head, now: '14:17' }),
    );

    expect(times(result.slots)[0]).toBe('14:20');
  });

  it('honours a coarser slot grid', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.head,
        slotGranularityMinutes: 30,
      }),
    );

    expect(times(result.slots).slice(0, 4)).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });
});
