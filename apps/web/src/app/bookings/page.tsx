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
    onSuccess: () => {
      toast.success('Cancelled. The slot is free again.');
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
                      <BookingStatusBadge status={booking.status} />
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
            : // No card was charged — the store takes payment at the counter — so promising
              // a refund to one is telling the customer something that cannot happen.
              `${cancelling.serviceName}, ${formatDateTime(cancelling.startsAt, zone)}. The slot goes back for someone else to book.`
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
