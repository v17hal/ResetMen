'use client';

import {
  Badge,
  BookingStatusBadge,
  Card,
  ErrorState,
  Skeleton,
  formatBookingCode,
  formatDateTime,
  formatDuration,
  formatMoney,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { QrTicket } from '@/components/qr-ticket';
import { errorMessage } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * The screen someone holds up at the counter.
 *
 * It polls briefly after arrival because the booking is confirmed by the payment *webhook*,
 * not by the browser — the customer can land here a second before the server has heard from
 * Razorpay. Rather than showing "pending" and leaving them to refresh, it waits.
 */
export default function ConfirmationPage() {
  const params = useParams<{ id: string }>();

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });

  const booking = useQuery({
    queryKey: ['booking', params.id],
    queryFn: () => api().bookings.detail(params.id),
    // Stops as soon as the webhook lands and a QR exists.
    refetchInterval: (query) =>
      query.state.data?.status === 'HELD' ? 2000 : false,
  });

  if (booking.isError) {
    return (
      <div className="p-base">
        <ErrorState
          title="Could not find that booking"
          description={errorMessage(booking.error)}
          onRetry={() => void booking.refetch()}
        />
      </div>
    );
  }

  if (booking.isPending) {
    return (
      <div className="flex flex-col items-center gap-base p-base" aria-busy>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-square w-full max-w-[280px]" />
      </div>
    );
  }

  const zone = store.data?.timezone;
  const pending = booking.data.status === 'HELD';

  return (
    <div className="flex flex-col items-center gap-lg p-base text-center">
      <header className="flex flex-col items-center gap-xs pt-lg">
        {pending ? (
          <>
            <h1 className="font-display text-h1">Confirming your payment…</h1>
            <p className="text-body text-text-muted">
              This usually takes a second or two. You can stay on this screen.
            </p>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h1 className="font-display text-display">You&rsquo;re booked</h1>
            <p className="text-body text-text-muted">
              Show this at the counter when you arrive.
            </p>
          </>
        )}
      </header>

      {booking.data.checkinPayload !== null && <QrTicket payload={booking.data.checkinPayload} />}

      <Card elevated className="flex w-full flex-col gap-sm text-left">
        <div className="flex items-center justify-between gap-sm">
          <span className="font-display text-h2">{booking.data.serviceName}</span>
          <BookingStatusBadge status={booking.data.status} />
        </div>

        <p className="text-body">{formatDateTime(booking.data.startsAt, zone)}</p>
        <p className="text-body-sm text-text-muted">
          {formatDuration(booking.data.durationMinutes)} ·{' '}
          {formatMoney(booking.data.payablePaise)} paid
        </p>

        {booking.data.addons.length > 0 && (
          <div className="flex flex-wrap gap-xs">
            {booking.data.addons.map((addon) => (
              <Badge key={addon.name}>{addon.name}</Badge>
            ))}
          </div>
        )}

        <div className="mt-xs border-t border-border pt-sm">
          <p className="text-caption text-text-muted">Booking code</p>
          <p className="font-mono text-h2">{formatBookingCode(booking.data.publicId)}</p>
          <p className="mt-xs text-caption text-text-muted">
            If the camera will not read the code, read this out instead.
          </p>
        </div>
      </Card>

      {store.data !== undefined && store.data.address !== null && (
        <Card className="w-full text-left">
          <p className="text-caption text-text-muted">Where</p>
          <p className="text-body">{store.data.address}</p>
          {store.data.phone !== null && (
            <a
              href={`tel:${store.data.phone}`}
              className="text-body-sm text-primary underline underline-offset-4"
            >
              {store.data.phone}
            </a>
          )}
        </Card>
      )}

      <div className="flex w-full flex-col items-center gap-sm">
        {/* A styled link, not a Button wrapping one — a <button> around an <a> is invalid
            and breaks keyboard navigation in exactly the way that is hard to notice. */}
        <Link
          href="/bookings"
          className="flex min-h-touch w-full items-center justify-center rounded-md border border-border bg-surface px-base text-body font-medium hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          All my visits
        </Link>
        <Link href="/" className="text-body-sm text-primary underline underline-offset-4">
          Book something else
        </Link>
      </div>
    </div>
  );
}
