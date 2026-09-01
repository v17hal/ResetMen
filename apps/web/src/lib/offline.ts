'use client';

import { useEffect, useState } from 'react';

import type { BookingDetail } from '@reset/api-client';

/**
 * Whether the browser thinks it has a connection.
 *
 * `navigator.onLine` is the honest signal here rather than inferring it from a failed
 * query: React Query keeps the last good data and reports `status: 'success'` while a
 * background refetch fails, so losing signal looked exactly like everything working.
 *
 * It is not a promise that the API is reachable — a captive portal is "online" — so it
 * decides whether to *say* something, never whether to trust what is on screen.
 */
export function useOnline(): boolean {
  // Starts true so the server render and the first client render agree; a genuinely
  // offline browser corrects it on mount, before paint.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

const KEY = 'reset.bookings.saved';

/**
 * The last copy of each booking this browser saw.
 *
 * The QR is the whole reason the confirmation page exists, and it was fetched from the API
 * every time — so with no signal the page showed an error and the code was invisible at the
 * counter. The app has had a cache for this from the start; the website simply never got
 * one. Deliberately mirrors `apps/mobile/lib/src/services/booking_cache.dart`.
 *
 * Every operation swallows its own failure. Private mode, a full quota and a disabled
 * storage setting all throw, and none of them should break a page that is working online.
 */
export const bookingCache = {
  save(booking: BookingDetail): void {
    try {
      const all = bookingCache.readAll();
      all[booking.id] = booking;
      window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // No storage available. The online path is unaffected.
    }
  },

  readAll(): Record<string, BookingDetail> {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw === null) return {};

      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, BookingDetail>)
        : {};
    } catch {
      // Written by an older build with a different shape. Treat as empty rather than
      // breaking the one page that has to work when everything else has failed.
      return {};
    }
  },

  read(bookingId: string): BookingDetail | null {
    return bookingCache.readAll()[bookingId] ?? null;
  },

  clear(): void {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing to do; the cache is a convenience, not a record.
    }
  },
};
