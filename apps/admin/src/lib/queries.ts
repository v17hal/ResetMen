'use client';

import type { PaymentStatus, ProductOrderStatus } from '@reset/api-client';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { adminClient } from './client.js';

/**
 * Query keys, in one place.
 *
 * Mutations invalidate by prefix — `['timeline']` clears every date at once — so the keys
 * have to be built consistently. Scattering `['timeline', date]` literals across screens is
 * how a booking gets created and the timeline behind it keeps showing the old picture.
 */
export const keys = {
  dashboard: ['dashboard'] as const,
  timeline: (date: string) => ['timeline', date] as const,
  bookings: ['bookings'] as const,
  customers: (params: unknown) => ['customers', params] as const,
  customer: (id: string) => ['customer', id] as const,
  staff: ['staff'] as const,
  stations: ['stations'] as const,
  coverage: ['stations', 'coverage'] as const,
  allocationRules: ['allocation-rules'] as const,
  storeHours: ['store-hours'] as const,
  blackouts: ['blackouts'] as const,
  settings: ['settings'] as const,
  segments: ['catalog', 'segments'] as const,
  categories: ['catalog', 'categories'] as const,
  services: ['catalog', 'services'] as const,
  addonGroups: ['catalog', 'addon-groups'] as const,
  streakRules: ['rewards', 'streak-rules'] as const,
  campaigns: ['rewards', 'campaigns'] as const,
  products: ['products'] as const,
  productOrders: (status?: ProductOrderStatus) => ['products', 'orders', status] as const,
  payments: (status?: PaymentStatus) => ['payments', status] as const,
  report: (kind: string, from: string, to: string) => ['report', kind, from, to] as const,
  audit: (params: unknown) => ['audit', params] as const,
  media: ['media'] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => adminClient().reports.dashboard(),
  });
}

/**
 * The station timeline for one day.
 *
 * Polls every 30 seconds while the tab is visible. The counter leaves this screen open all
 * day, and a booking made on a phone in the doorway should appear before the customer does.
 * `refetchIntervalInBackground` stays off — a tablet left on the counter overnight should
 * not spend the night polling.
 */
export function useTimeline(date: string) {
  return useQuery({
    queryKey: keys.timeline(date),
    queryFn: () => adminClient().bookings.timeline(date),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useStations() {
  return useQuery({
    queryKey: keys.stations,
    queryFn: () => adminClient().capacity.stations(),
    // Stations change a few times a year. Re-fetching them every ten seconds is pure noise.
    staleTime: 5 * 60_000,
  });
}

export function useServices() {
  return useQuery({
    queryKey: keys.services,
    queryFn: () => adminClient().catalog.services(),
    staleTime: 5 * 60_000,
  });
}

export function useStoreSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => adminClient().capacity.settings(),
    staleTime: 5 * 60_000,
  });
}

/** Narrows a react-query result to "has data", so screens can render without a null check. */
export function isReady<T>(
  result: UseQueryResult<T>,
): result is UseQueryResult<T> & { data: T } {
  return result.data !== undefined;
}
