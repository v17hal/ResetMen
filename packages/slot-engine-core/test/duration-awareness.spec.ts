import { describe, expect, it } from 'vitest';

import { computeAvailability } from '../src/index.js';
import { SERVICES, busy, makeInput, station, times } from './helpers.js';

/**
 * Proposal §4.3: "the engine checks whether the full requested duration fits in the gap
 * before the next booking on that station. A 30-min Full Body will not be offered in a
 * 20-min gap, even though a 10-min Head Massage would be."
 */
describe('duration awareness', () => {
  /**
   * One station, free only between 09:15 and 09:40 — a 25-minute gap.
   *
   *   Head Massage  10 + 5 buffer = 15 min → fits
   *   Full Body     30 + 5 buffer = 35 min → does not
   */
  const singleStationWithA25MinuteGap = {
    stations: [station('stn_1', 1)],
    busy: [
      busy('stn_1', '09:00', 10), // blocks until 09:15
      busy('stn_1', '09:40', 20), // blocks 09:40 → 10:05
    ],
  };

  it('offers the 10-minute service inside the gap', () => {
    const result = computeAvailability(
      makeInput({ ...singleStationWithA25MinuteGap, service: SERVICES.head }),
    );

    expect(times(result.slots)).toContain('09:15');
  });

  it('refuses the 30-minute service in the same gap', () => {
    const result = computeAvailability(
      makeInput({ ...singleStationWithA25MinuteGap, service: SERVICES.fullBody }),
    );

    expect(times(result.slots)).not.toContain('09:15');
    expect(times(result.slots)).not.toContain('09:20');
    expect(times(result.slots)).not.toContain('09:25');
  });

  it('offers the 30-minute service only once the station is clear again', () => {
    const result = computeAvailability(
      makeInput({ ...singleStationWithA25MinuteGap, service: SERVICES.fullBody }),
    );

    // The second booking blocks until 10:05, so 10:05 is the first Full Body slot.
    expect(times(result.slots)[0]).toBe('10:05');
  });

  it('offers the last slot that still fits — 09:20 for a 15-minute service', () => {
    // 09:20 + 15 + 5 = 09:40 exactly, which touches but does not overlap the next booking.
    const result = computeAvailability(
      makeInput({
        ...singleStationWithA25MinuteGap,
        service: SERVICES.headNeckShoulder,
      }),
    );

    expect(times(result.slots)).toContain('09:20');
    expect(times(result.slots)).not.toContain('09:25');
  });

  it('add-on duration deltas lengthen the required window', () => {
    const withoutAddon = computeAvailability(
      makeInput({
        ...singleStationWithA25MinuteGap,
        service: SERVICES.headNeckShoulderBack, // 20 min → 25 with buffer, fits exactly
      }),
    );
    expect(times(withoutAddon.slots)).toContain('09:15');

    const withAddon = computeAvailability(
      makeInput({
        ...singleStationWithA25MinuteGap,
        service: SERVICES.headNeckShoulderBack,
        addons: [{ durationDeltaMinutes: 10 }],
      }),
    );
    expect(times(withAddon.slots)).not.toContain('09:15');
    expect(withAddon.sessionDurationMinutes).toBe(30);
  });

  it('rejects a service with no usable duration rather than returning nonsense', () => {
    expect(() =>
      computeAvailability(
        makeInput({
          service: { id: 'svc_unpriced_glow', durationMinutes: 0, bufferOverrideMinutes: null },
        }),
      ),
    ).toThrow(/positive duration/i);
  });
});
