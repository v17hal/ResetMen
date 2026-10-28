'use client';

import type { BookingSummary } from '@reset/api-client';
import {
  Badge,
  BookingStatusBadge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SkeletonList,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatRelativeDay,
  formatTime,
  stagger,
  useReducedMotion,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { ServiceImage } from '@/components/service-look';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

type Filter = 'upcoming' | 'completed' | 'cancelled';

export default function BookingsPage() {
  const { hasToken } = useAuth();
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [cancelling, setCancelling] = useState<BookingSummary | null>(null);
  const reduced = useReducedMotion();
  const toast = useToast();
  const queryClient = useQueryClient();

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });

  const bookings = useQuery({
    queryKey: ['bookings', filter],
    queryFn: () => api().bookings.list({ status: filter }),
    enabled: hasToken,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api().bookings.cancel(id),
    onSuccess: (result) => {
      // Paid online: say what is coming back, and when. A refund the gateway refused is
      // not hidden behind "Cancelled" — the shop has it on its list and will deal with it.
      const refunded = result.refund?.refundedPaise ?? 0;
      if (result.refund?.failed === true) {
        toast.success(
          'Cancelled. Your refund could not be started automatically — the shop will send it.',
        );
      } else if (refunded > 0) {
        toast.success(
          `Cancelled. ${formatMoney(refunded)} is on its way back to your card or UPI — ` +
            'usually within 5–7 working days.',
        );
      } else {
        toast.success('Cancelled. The slot is free again.');
      }
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setCancelling(null);
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (!hasToken) {
    return (
      <div className="flex flex-col gap-base p-base">
        <h1 className="font-display text-h1">Your visits</h1>
        <Card>
          <SignIn reason="Sign in to see your bookings and your QR codes." />
        </Card>
      </div>
    );
  }

  const zone = store.data?.timezone;

  return (
    <div className="flex flex-col gap-base p-base">
      <h1 className="font-display text-h1">Your visits</h1>

      <div role="tablist" className="flex gap-xs">
        {(['upcoming', 'completed', 'cancelled'] as const).map((id) => (
          <Button
            key={id}
            role="tab"
            aria-selected={filter === id}
            variant={filter === id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(id)}
          >
            {id[0]!.toUpperCase() + id.slice(1)}
          </Button>
        ))}
      </div>

      {bookings.isError ? (
        <ErrorState
          description={errorMessage(bookings.error)}
          onRetry={() => void bookings.refetch()}
        />
      ) : bookings.isPending ? (
        <SkeletonList rows={3} />
      ) : bookings.data.data.length === 0 ? (
        <EmptyState
          title={
            filter === 'upcoming'
              ? 'Nothing booked yet'
              : filter === 'completed'
                ? 'No past visits'
                : 'Nothing cancelled'
          }
          description={
            filter === 'upcoming' ? 'Pick a service and we will hold you a time.' : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-sm">
          {bookings.data.data.map((booking, index) => (
            <li key={booking.id} {...stagger(index, reduced)}>
              <Card elevated className="flex flex-col gap-sm">
                <div className="flex items-start gap-base">
                  {/* Same tile as the catalogue, so a visit is recognisably the thing that
                      was booked. */}
                  <ServiceImage
                    name={booking.serviceName}
                    className="h-16 w-16 shrink-0"
                    rounded="rounded-md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-sm">
                      <p className="truncate font-display text-h2 text-[17px]">
                        {booking.serviceName}
                      </p>
                      {/* An unpaid booking is not one to turn up for, whatever the
                          underlying status says. */}
                      {booking.isPaid ? (
                        <BookingStatusBadge status={booking.status} />
                      ) : booking.status === 'CANCELLED' ? (
                        <BookingStatusBadge status={booking.status} />
                      ) : (
                        <Badge tone="warning">Awaiting confirmation</Badge>
                      )}
                    </div>

                    <p className="text-body-sm text-text-muted">
                      {formatRelativeDay(booking.startsAt, zone)} ·{' '}
                      {formatTime(booking.startsAt, zone)}
                    </p>

                    <p className="mt-xs flex flex-wrap items-center gap-sm">
                      <span className="font-display text-[17px]">
                        {formatMoney(booking.payablePaise)}
                      </span>
                      <span className="text-caption text-text-muted">
                        {formatDuration(booking.durationMinutes)}
                      </span>
                      {booking.addons.map((addon) => (
                        <Badge key={addon.name}>{addon.name}</Badge>
                      ))}
                    </p>
                  </div>
                </div>

                {filter === 'upcoming' && (
                  <div className="flex flex-wrap gap-sm">
                    <Link
                      href={`/confirmation/${booking.id}`}
                      className="flex min-h-touch flex-1 items-center justify-center rounded-md bg-primary px-base text-body-sm font-medium text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Show QR
                    </Link>

                    {booking.canCancel && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setCancelling(booking)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                )}

                {/* `canCancel` is decided server-side against the store's window, so the
                    reason it is missing is worth saying rather than just hiding a button. */}
                {filter === 'upcoming' && !booking.canCancel && (
                  <p className="text-caption text-text-muted">
                    Too close to your slot to cancel online — call the store if you need to.
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title="Cancel this booking?"
        description={
          cancelling === null
            ? undefined
            : // Paid online, the money goes back to the same card or UPI automatically. Paid
              // at the counter — or not yet paid — there is nothing online to refund.
              `${cancelling.serviceName}, ${formatDateTime(cancelling.startsAt, zone)}. The slot goes back for someone else to book.` +
              (cancelling.isPaid
                ? ' If you paid online, it is refunded to the same card or UPI.'
                : '')
        }
        confirmLabel="Yes, cancel"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancelling !== null && cancel.mutate(cancelling.id)}
      />
    </div>
  );
}
