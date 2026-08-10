'use client';

import { Button, ErrorState, LoadingState, Skeleton, addDays, formatDate, todayLocal } from '@reset/ui';
import { useState } from 'react';

import { BookingDrawer } from '@/components/booking-drawer.js';
import { StationTimeline } from '@/components/station-timeline.js';
import { WalkInDialog } from '@/components/walk-in-dialog.js';
import { errorMessage } from '@/lib/auth.js';
import { useTimeline } from '@/lib/queries.js';

export default function TimelinePage() {
  const [date, setDate] = useState(todayLocal());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState<{ open: boolean; startsAt?: string }>({ open: false });

  const timeline = useTimeline(date);

  /**
   * Resolved from the current query data rather than held in state, so a booking that is
   * cancelled or moved by the 30-second poll updates the open drawer instead of leaving
   * stale details on screen while staff act on them.
   */
  const selected =
    selectedId === null
      ? null
      : (timeline.data?.stations.flatMap((station) =>
          station.bookings
            .filter((booking) => booking.id === selectedId)
            .map((booking) => ({ ...booking, stationId: station.id })),
        )[0] ?? null);

  return (
    <div className="flex flex-col gap-base">
      <header className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <h1 className="font-display text-h1">Timeline</h1>
          <p className="text-body-sm text-text-muted">
            {formatDate(`${date}T12:00:00Z`)} · every station, all day
          </p>
        </div>

        <div className="flex items-center gap-xs">
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, -1))}>
            ← Prev
          </Button>
          <Button
            variant={date === todayLocal() ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setDate(todayLocal())}
          >
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, 1))}>
            Next →
          </Button>
          <Button size="sm" onClick={() => setWalkIn({ open: true })}>
            + Walk-in
          </Button>
        </div>
      </header>

      {timeline.isError ? (
        <ErrorState
          title="Could not load the timeline"
          description={errorMessage(timeline.error)}
          onRetry={() => void timeline.refetch()}
        />
      ) : timeline.isPending ? (
        <>
          <LoadingState label="Loading the day" />
          <Skeleton className="h-96 w-full" />
        </>
      ) : timeline.data.stations.length === 0 ? (
        <ErrorState
          title="No stations configured"
          description="Add at least one station under Capacity before anything can be booked."
        />
      ) : (
        <>
          <StationTimeline
            data={timeline.data}
            onSelectBooking={setSelectedId}
            onSelectSlot={({ startsAt }) => setWalkIn({ open: true, startsAt })}
          />

          <p className="text-caption text-text-muted">
            Hatched bands are cleaning time — occupied, but not part of the session. Tap an
            empty area on a station to add a walk-in at that time.
          </p>
        </>
      )}

      <WalkInDialog
        open={walkIn.open}
        onOpenChange={(open) => setWalkIn({ open })}
        defaultStartsAt={walkIn.startsAt}
        date={date}
        timeZone={timeline.data?.timezone ?? 'Asia/Kolkata'}
      />

      <BookingDrawer
        booking={selected}
        date={date}
        timeZone={timeline.data?.timezone ?? 'Asia/Kolkata'}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
