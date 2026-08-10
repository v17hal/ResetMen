'use client';

import {
  Badge,
  BookingStatusBadge,
  Card,
  ErrorState,
  SkeletonList,
  StatTile,
  formatMoney,
  formatPercent,
  formatTime,
  todayLocal,
} from '@reset/ui';
import Link from 'next/link';

import { errorMessage } from '@/lib/auth.js';
import { useDashboard, useTimeline } from '@/lib/queries.js';

/**
 * Today.
 *
 * The first screen of the shift. It answers one question — what is happening right now —
 * so it leads with the next few arrivals rather than with the revenue figure. Money is
 * further down because nobody at a counter needs it to serve the person in front of them.
 */
export default function TodayPage() {
  const today = todayLocal();
  const dashboard = useDashboard();
  const timeline = useTimeline(today);

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-h1">Today</h1>
        <p className="text-body-sm text-text-muted">
          Live. Refreshes on its own every 30 seconds.
        </p>
      </header>

      {dashboard.isError ? (
        <ErrorState
          description={errorMessage(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      ) : dashboard.isPending ? (
        <SkeletonList rows={2} />
      ) : (
        <section
          aria-label="Summary"
          className="grid grid-cols-2 gap-sm lg:grid-cols-4"
        >
          <StatTile label="Sessions today" value={dashboard.data.sessionsToday} />
          <StatTile
            label="Revenue today"
            value={formatMoney(dashboard.data.revenueTodayPaise)}
          />
          <StatTile
            label="Utilisation"
            value={formatPercent(dashboard.data.utilisationPercent)}
            hint="Booked time against open time"
          />
          <StatTile
            label="Unscratched cards"
            value={dashboard.data.unscratchedCards}
            tone="accent"
            hint="Waiting to be revealed"
          />
        </section>
      )}

      <UpNext date={today} timeline={timeline} />
    </div>
  );
}

function UpNext({
  date,
  timeline,
}: {
  date: string;
  timeline: ReturnType<typeof useTimeline>;
}) {
  if (timeline.isError) {
    return (
      <ErrorState
        title="Could not load today’s bookings"
        description={errorMessage(timeline.error)}
        onRetry={() => void timeline.refetch()}
      />
    );
  }

  if (timeline.isPending) return <SkeletonList rows={4} />;

  const now = Date.now();
  const zone = timeline.data.timezone;

  /**
   * Everything still ahead, plus anything already in the room.
   *
   * A session that started ten minutes ago is the most relevant row on the screen — the
   * person is here — so "upcoming" is measured against the *end* of the session, not
   * the start.
   */
  const upcoming = timeline.data.stations
    .flatMap((station) =>
      station.bookings.map((booking) => ({ ...booking, stationName: station.name })),
    )
    .filter(
      (booking) =>
        new Date(booking.endsAt).getTime() >= now &&
        !['CANCELLED', 'EXPIRED', 'NO_SHOW'].includes(booking.status),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 8);

  return (
    <section aria-label="Up next" className="flex flex-col gap-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-h2">Up next</h2>
        <Link
          href="/timeline"
          className="text-body-sm text-primary underline underline-offset-4"
        >
          Full timeline
        </Link>
      </div>

      {upcoming.length === 0 ? (
        <Card className="text-body-sm text-text-muted">
          Nothing left today. {date === todayLocal() ? 'The rest of the day is free.' : null}
        </Card>
      ) : (
        <ul className="flex flex-col gap-sm">
          {upcoming.map((booking) => (
            <li key={booking.id}>
              <Card className="flex flex-wrap items-center gap-sm">
                <span className="font-mono text-body tabular-nums">
                  {formatTime(booking.startsAt, zone)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{booking.customerName}</p>
                  <p className="truncate text-body-sm text-text-muted">
                    {booking.serviceName} · {booking.stationName}
                  </p>
                </div>
                {booking.source === 'ADMIN_WALKIN' && <Badge tone="info">Walk-in</Badge>}
                <BookingStatusBadge status={booking.status} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
