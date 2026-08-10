import { describe, expect, it } from 'vitest';

import { assignStation } from '../src/index.js';
import { SERVICES, at, busy, makeInput, station } from './helpers.js';

describe('station assignment', () => {
  it('packs into the tightest gap, preserving long contiguous blocks', () => {
    // Station 1 has a 20-minute hole between bookings; Station 2 is wide open all day.
    // A 10-minute service should fill the hole rather than fragment the open station.
    const input = makeInput({
      service: SERVICES.head,
      stations: [station('stn_1', 1), station('stn_2', 2)],
      busy: [
        busy('stn_1', '09:00', 10), // blocks to 09:15
        busy('stn_1', '09:35', 20), // blocks from 09:35
      ],
    });

    expect(assignStation(input, at('09:15'))!.stationId).toBe('stn_1');
  });

  it('keeps a 30-minute service bookable by not fragmenting the open station', () => {
    // Same setup: after the Head Massage lands on Station 1, Station 2 is still clear
    // enough for a Premium.
    const afterHeadMassage = makeInput({
      service: SERVICES.premium,
      stations: [station('stn_1', 1), station('stn_2', 2)],
      busy: [
        busy('stn_1', '09:00', 10),
        busy('stn_1', '09:35', 20),
        busy('stn_1', '09:15', 10), // the head massage we just placed
      ],
    });

    const assignment = assignStation(afterHeadMassage, at('09:15'));
    expect(assignment).not.toBeNull();
    expect(assignment!.stationId).toBe('stn_2');
  });

  it('breaks ties by sort order so the outcome is reproducible', () => {
    const input = makeInput({
      service: SERVICES.head,
      stations: [station('stn_c', 3), station('stn_a', 1), station('stn_b', 2)],
    });

    expect(assignStation(input, at('10:00'))!.stationId).toBe('stn_a');
    expect(assignStation(input, at('10:00'))!.stationId).toBe('stn_a');
  });

  it('returns the exact window the booking row will store', () => {
    const input = makeInput({ service: SERVICES.headNeckShoulder }); // 15 min, 5 min buffer
    const assignment = assignStation(input, at('10:00'))!;

    expect(assignment.startsAt).toBe(at('10:00'));
    expect(assignment.endsAt).toBe(at('10:15'));
    expect(assignment.blockedUntil).toBe(at('10:20'));
  });

  it('returns null for a time that is not bookable', () => {
    const input = makeInput({
      service: SERVICES.head,
      stations: [station('stn_1', 1)],
      busy: [busy('stn_1', '10:00', 30)],
    });

    expect(assignStation(input, at('10:15'))).toBeNull();
    expect(assignStation(input, at('22:00'))).toBeNull();
  });
});
