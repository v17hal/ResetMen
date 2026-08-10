import type {
  AvailabilityInput,
  BlackoutInterval,
  BusyInterval,
  Instant,
  ResolvedAllocationRule,
  ServiceInput,
  StationInput,
} from '../src/index.js';

/**
 * Test fixtures use a fixed date — Saturday 8 August 2026 — in Asia/Kolkata (UTC+05:30).
 * The engine itself is timezone-free; this helper exists purely so tests read in the same
 * wall-clock times the proposal and the menu use.
 */
const IST_OFFSET_MS = 330 * 60_000;

/** `at('09:15')` → the instant of 09:15 IST on the fixture date. */
export function at(hhmm: string): Instant {
  const parts = hhmm.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1] ?? '0');
  return Date.UTC(2026, 7, 8, hours, minutes) - IST_OFFSET_MS;
}

/** Inverse of `at`, for readable assertion failures. */
export function hhmm(t: Instant): string {
  const d = new Date(t + IST_OFFSET_MS);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function times(slots: readonly { startsAt: Instant }[]): string[] {
  return slots.map((s) => hhmm(s.startsAt));
}

/** The MEN menu from the client's photos. */
export const SERVICES = {
  head: { id: 'svc_head', durationMinutes: 10, bufferOverrideMinutes: null },
  headNeckShoulder: { id: 'svc_hns', durationMinutes: 15, bufferOverrideMinutes: null },
  headNeckShoulderBack: { id: 'svc_hnsb', durationMinutes: 20, bufferOverrideMinutes: null },
  basic: { id: 'svc_basic', durationMinutes: 20, bufferOverrideMinutes: null },
  premium: { id: 'svc_premium', durationMinutes: 30, bufferOverrideMinutes: null },
  /** The proposal's example uses a 30-minute "Full Body". */
  fullBody: { id: 'svc_fullbody', durationMinutes: 30, bufferOverrideMinutes: null },
} as const satisfies Record<string, ServiceInput>;

export function station(
  id: string,
  sortOrder: number,
  serviceIds?: readonly string[],
): StationInput {
  return serviceIds === undefined
    ? { id, sortOrder, allowsAllServices: true, serviceIds: [] }
    : { id, sortOrder, allowsAllServices: false, serviceIds };
}

export const THREE_STATIONS: StationInput[] = [
  station('stn_1', 1),
  station('stn_2', 2),
  station('stn_3', 3),
];

/** A booking, expressed the way the engine receives it: buffer already folded in. */
export function busy(
  stationId: string,
  start: string,
  durationMinutes: number,
  bufferMinutes = 5,
): BusyInterval {
  return {
    stationId,
    start: at(start),
    blockedUntil: at(start) + (durationMinutes + bufferMinutes) * 60_000,
  };
}

export function blackout(
  stationId: string | null,
  start: string,
  end: string,
): BlackoutInterval {
  return { stationId, start: at(start), end: at(end) };
}

export function rule(
  overrides: Partial<ResolvedAllocationRule> & Pick<ResolvedAllocationRule, 'mode'>,
): ResolvedAllocationRule {
  return {
    id: 'rule_1',
    priority: 100,
    window: { start: at('09:00'), end: at('12:00') },
    stationIds: [],
    serviceIds: [],
    ...overrides,
  };
}

export interface InputOverrides {
  now?: string;
  service?: ServiceInput;
  addons?: readonly { durationDeltaMinutes: number }[];
  stations?: readonly StationInput[];
  openWindows?: readonly { start: string; end: string }[];
  blackouts?: readonly BlackoutInterval[];
  busy?: readonly BusyInterval[];
  allocationRules?: readonly ResolvedAllocationRule[];
  bufferMinutes?: number;
  slotGranularityMinutes?: number;
  minLeadMinutes?: number;
}

/** Store defaults: open 09:00–21:00, 5-minute buffer, 5-minute grid, no lead time. */
export function makeInput(overrides: InputOverrides = {}): AvailabilityInput {
  const windows = overrides.openWindows ?? [{ start: '09:00', end: '21:00' }];

  return {
    now: at(overrides.now ?? '09:00'),
    service: overrides.service ?? SERVICES.head,
    addons: overrides.addons ?? [],
    stations: overrides.stations ?? THREE_STATIONS,
    openWindows: windows.map((w) => ({ start: at(w.start), end: at(w.end) })),
    blackouts: overrides.blackouts ?? [],
    busy: overrides.busy ?? [],
    allocationRules: overrides.allocationRules ?? [],
    settings: {
      bufferMinutes: overrides.bufferMinutes ?? 5,
      slotGranularityMinutes: overrides.slotGranularityMinutes ?? 5,
      minLeadMinutes: overrides.minLeadMinutes ?? 0,
    },
  };
}
