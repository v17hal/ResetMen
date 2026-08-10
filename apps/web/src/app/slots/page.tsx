'use client';

import {
  Badge,
  Card,
  ErrorState,
  Skeleton,
  addDays,
  cn,
  formatDate,
  formatDuration,
  formatMoney,
  formatTime,
  todayLocal,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { api } from '@/lib/client';

export default function SlotsPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<div className="p-base" aria-busy><Skeleton className="h-64 w-full" /></div>}>
      <Slots />
    </Suspense>
  );
}

function Slots() {
  const router = useRouter();
  const search = useSearchParams();

  const serviceId = search.get('serviceId') ?? '';
  const addonOptionIds = search.getAll('addon');

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });
  const zone = store.data?.timezone;

  const today = todayLocal(zone);
  const [date, setDate] = useState(today);

  const horizon = store.data?.bookingHorizonDays ?? 7;
  const days = Array.from({ length: horizon }, (_, i) => addDays(today, i));

  /**
   * Which days have anything at all — drives the dots under the date strip so nobody taps
   * through five closed days one at a time.
   */
  const dayAvailability = useQuery({
    queryKey: ['days', serviceId, addonOptionIds, today, horizon],
    queryFn: () =>
      api().availability.days({
        serviceId,
        from: today,
        to: addDays(today, horizon - 1),
        addonOptionIds,
      }),
    enabled: serviceId !== '',
  });

  /**
   * Never cached, client-side either.
   *
   * A stale slot list means the customer picks a time that has already gone and finds out
   * during payment — the worst possible moment. It refetches every 60 seconds and on focus,
   * and the screen says when it last did.
   */
  const slots = useQuery({
    queryKey: ['slots', serviceId, addonOptionIds, date],
    queryFn: () => api().availability.slots({ serviceId, date, addonOptionIds }),
    enabled: serviceId !== '',
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (serviceId === '') {
    return (
      <div className="p-base">
        <ErrorState
          title="No service chosen"
          description="Pick a service first and we will show you when it is free."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs">
        <Link href="/" className="text-body-sm text-primary underline underline-offset-4">
          ← Back
        </Link>
        <h1 className="font-display text-h1">Choose a time</h1>
        {slots.data !== undefined && (
          <p className="text-body-sm text-text-muted">
            {formatDuration(slots.data.totalDurationMinutes)} ·{' '}
            {formatMoney(slots.data.payablePaise)}
          </p>
        )}
      </header>

      {/* Date strip. Scrolls horizontally inside itself; the page never does. */}
      <div className="-mx-base overflow-x-auto px-base">
        <ul className="flex gap-xs">
          {days.map((day) => {
            const info = dayAvailability.data?.find((entry) => entry.date === day);
            const closed = info !== undefined && !info.isOpen;
            const empty = info !== undefined && info.isOpen && info.slotCount === 0;
            const active = day === date;

            return (
              <li key={day}>
                <button
                  type="button"
                  onClick={() => setDate(day)}
                  disabled={closed}
                  aria-current={active ? 'date' : undefined}
                  className={cn(
                    'flex min-h-touch w-16 flex-col items-center justify-center gap-0.5 rounded-md border px-xs py-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    active
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-surface text-text',
                    closed && 'opacity-40',
                  )}
                >
                  <span className="text-caption">
                    {formatDate(`${day}T12:00:00Z`).split(' ')[0]}
                  </span>
                  <span className="font-display text-body">{Number(day.slice(8, 10))}</span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-1 w-1 rounded-full',
                      closed || empty
                        ? 'bg-transparent'
                        : active
                          ? 'bg-primary-fg'
                          : 'bg-primary',
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {slots.isError ? (
        <ErrorState description={errorMessage(slots.error)} onRetry={() => void slots.refetch()} />
      ) : slots.isPending ? (
        <div className="grid grid-cols-3 gap-sm sm:grid-cols-4" aria-busy>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : slots.data.slots.length === 0 ? (
        <Card className="flex flex-col gap-sm text-center">
          <p className="font-display text-h2">Nothing free on this day</p>
          <p className="text-body-sm text-text-muted">
            Try another date — the dots above show which days have times.
          </p>
        </Card>
      ) : (
        <>
          {/*
            Slot chips never stagger. This is the one screen where someone is scanning for a
            specific time under mild time pressure, and animating sixty chips in sequence
            delays the only information they came for. docs/08 §2.4.
          */}
          <ul className="grid grid-cols-3 gap-sm sm:grid-cols-4">
            {slots.data.slots.map((slot) => (
              <li key={slot.startsAt}>
                <button
                  type="button"
                  onClick={() => {
                    const query = new URLSearchParams({ serviceId, startsAt: slot.startsAt });
                    for (const id of addonOptionIds) query.append('addon', id);
                    router.push(`/checkout?${query.toString()}`);
                  }}
                  className={cn(
                    'flex min-h-touch w-full flex-col items-center justify-center rounded-md border border-border bg-surface',
                    'text-body transition-colors duration-micro ease-standard',
                    'hover:border-primary hover:bg-primary/5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  )}
                >
                  <span className="font-mono tabular-nums">
                    {formatTime(slot.startsAt, slots.data.timezone)}
                  </span>
                  {slot.stationsAvailable === 1 && (
                    <span className="text-caption text-warning">only 1 left</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <p className="text-caption text-text-muted">
            Times update automatically. Last checked{' '}
            {formatTime(slots.data.computedAt, slots.data.timezone)}.
          </p>
        </>
      )}

      {store.data !== undefined && (
        <Badge tone="neutral">
          All times are {store.data.name}&rsquo;s local time.
        </Badge>
      )}
    </div>
  );
}
