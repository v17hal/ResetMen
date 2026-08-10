import { describe, expect, it } from 'vitest';

import { computeAvailability } from '../src/index.js';
import { SERVICES, busy, makeInput, station, times } from './helpers.js';

/**
 * Proposal §4.3: "Buffer always respected — no back-to-back booking without the configured
 * gap."
 *
 * The buffer has to hold in both directions: after an existing booking (its own trailing
 * buffer) and before the next one (the new booking's trailing buffer).
 */
describe('buffer', () => {
  const oneStation = [station('stn_1', 1)];

  it('blocks the buffer window after an existing booking', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.head,
        busy: [busy('stn_1', '09:00', 10)], // ends 09:10, blocks to 09:15
      }),
    );

    expect(times(result.slots)).not.toContain('09:10');
    expect(times(result.slots)[0]).toBe('09:15');
  });

  it("respects the new booking's own trailing buffer before a later booking", () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.head,
        busy: [busy('stn_1', '09:30', 20)],
      }),
    );

    // A 10-minute session at 09:20 would end 09:30 and block until 09:35 — overlapping the
    // 09:30 booking. 09:15 is the last start that leaves the gap intact.
    expect(times(result.slots)).toContain('09:15');
    expect(times(result.slots)).not.toContain('09:20');
    expect(times(result.slots)).not.toContain('09:25');
  });

  it('honours a longer store-wide buffer', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.head,
        busy: [busy('stn_1', '09:00', 10, 15)], // 15-minute buffer → blocks to 09:25
        bufferMinutes: 15,
      }),
    );

    expect(times(result.slots)[0]).toBe('09:25');
    expect(result.bufferMinutes).toBe(15);
  });

  it('honours a per-service buffer override', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: { ...SERVICES.head, bufferOverrideMinutes: 20 },
        busy: [busy('stn_1', '10:00', 30)],
      }),
    );

    // 10-minute session + 20-minute override = 30 minutes of blocking. Starting at 09:30
    // would run to 10:00 exactly — allowed. 09:35 would overrun.
    expect(result.bufferMinutes).toBe(20);
    expect(times(result.slots)).toContain('09:30');
    expect(times(result.slots)).not.toContain('09:35');
  });

  it('allows a zero buffer to book truly back-to-back', () => {
    const result = computeAvailability(
      makeInput({
        stations: oneStation,
        service: SERVICES.head,
        busy: [busy('stn_1', '09:00', 10, 0)],
        bufferMinutes: 0,
      }),
    );

    expect(times(result.slots)[0]).toBe('09:10');
  });
});
