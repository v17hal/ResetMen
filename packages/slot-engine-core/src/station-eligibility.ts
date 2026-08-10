import { overlaps } from './interval.js';
import type {
  Interval,
  ResolvedAllocationRule,
  ServiceId,
  StationInput,
} from './types.js';

/**
 * Static designation — client requirement 02/08/2026:
 * "certain beds may be designated only for head massage based on space constraints".
 */
export function stationSupportsService(
  station: StationInput,
  serviceId: ServiceId,
): boolean {
  return station.allowsAllServices || station.serviceIds.includes(serviceId);
}

/**
 * Rules that apply to this station over this session.
 *
 * A rule counts as applying if its window **overlaps the session at all**, even partially.
 * A 30-minute session that spills five minutes into a window reserved for the ₹199 push
 * would otherwise quietly consume reserved capacity — which is exactly what the reservation
 * exists to prevent.
 *
 * Sorted by priority descending, then by id ascending so the outcome is deterministic when
 * two rules share a priority.
 */
function applicableRules(
  station: StationInput,
  session: Interval,
  rules: readonly ResolvedAllocationRule[],
): ResolvedAllocationRule[] {
  return rules
    .filter((rule) => rule.stationIds.includes(station.id) && overlaps(rule.window, session))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Allocation-rule verdict. The first applicable rule decides:
 *
 * | mode           | service listed? | verdict |
 * |----------------|-----------------|---------|
 * | EXCLUSIVE_TO   | yes             | allow   |
 * | EXCLUSIVE_TO   | no              | deny    |
 * | EXCLUDE_FROM   | yes             | deny    |
 * | EXCLUDE_FROM   | no              | allow   |
 *
 * No applicable rule → allow.
 */
export function allocationRulesAllow(
  station: StationInput,
  serviceId: ServiceId,
  session: Interval,
  rules: readonly ResolvedAllocationRule[],
): boolean {
  const decisive = applicableRules(station, session, rules)[0];
  if (decisive === undefined) return true;

  const serviceListed = decisive.serviceIds.includes(serviceId);
  return decisive.mode === 'EXCLUSIVE_TO' ? serviceListed : !serviceListed;
}

/** Static designation and allocation rules combined. */
export function stationAllows(
  station: StationInput,
  serviceId: ServiceId,
  session: Interval,
  rules: readonly ResolvedAllocationRule[],
): boolean {
  return (
    stationSupportsService(station, serviceId) &&
    allocationRulesAllow(station, serviceId, session, rules)
  );
}

/**
 * True when this station is reserved *for this very service* over this session.
 *
 * Used only by assignment ranking: reserved capacity should be consumed by the service it
 * was reserved for before it spills onto general-purpose stations.
 */
export function isReservedForService(
  station: StationInput,
  serviceId: ServiceId,
  session: Interval,
  rules: readonly ResolvedAllocationRule[],
): boolean {
  return rules.some(
    (rule) =>
      rule.mode === 'EXCLUSIVE_TO' &&
      rule.stationIds.includes(station.id) &&
      rule.serviceIds.includes(serviceId) &&
      overlaps(rule.window, session),
  );
}
