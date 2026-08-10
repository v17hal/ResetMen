import { describe, expect, it } from 'vitest';

import { assignStation, computeAvailability } from '../src/index.js';
import { SERVICES, at, makeInput, station } from './helpers.js';

/**
 * Client requirement, 02/08/2026:
 *
 *   "there should be an option to add beds to specific services. For instance, certain beds
 *    may be designated only for head massage based on space constraints or operational
 *    requirements"
 *
 * Station 3 is a corner chair: it can host Head Massage and Head+Neck+Shoulder, nothing else.
 */
describe('station → service designation', () => {
  const cornerChairSetup = {
    stations: [
      station('stn_1', 1),
      station('stn_2', 2),
      station('stn_3', 3, [SERVICES.head.id, SERVICES.headNeckShoulder.id]),
    ],
  };

  it('offers the corner chair to the services it is designated for', () => {
    const result = computeAvailability(
      makeInput({ ...cornerChairSetup, service: SERVICES.head }),
    );

    expect(result.slots[0]?.stationsAvailable).toBe(3);
  });

  it('hides the corner chair from every other service', () => {
    const fullBody = computeAvailability(
      makeInput({ ...cornerChairSetup, service: SERVICES.premium }),
    );
    const basic = computeAvailability(
      makeInput({ ...cornerChairSetup, service: SERVICES.basic }),
    );

    expect(fullBody.slots[0]?.stationsAvailable).toBe(2);
    expect(basic.slots[0]?.stationsAvailable).toBe(2);
  });

  it('sends Head Massage to the specialised station, keeping the big ones free', () => {
    const input = makeInput({ ...cornerChairSetup, service: SERVICES.head });
    const assignment = assignStation(input, at('10:00'));

    expect(assignment!.stationId).toBe('stn_3');
  });

  it('leaves a service with no eligible station unbookable rather than mis-assigned', () => {
    const result = computeAvailability(
      makeInput({
        stations: [station('stn_3', 3, [SERVICES.head.id])],
        service: SERVICES.premium,
      }),
    );

    expect(result.slots).toHaveLength(0);
    expect(
      assignStation(
        makeInput({
          stations: [station('stn_3', 3, [SERVICES.head.id])],
          service: SERVICES.premium,
        }),
        at('10:00'),
      ),
    ).toBeNull();
  });
});
