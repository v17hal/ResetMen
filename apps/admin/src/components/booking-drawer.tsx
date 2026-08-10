'use client';

import type { TimelineBooking } from '@reset/api-client';
import {
  Badge,
  BookingStatusBadge,
  Button,
  Dialog,
  Input,
  Select,
  formatBookingCode,
  formatMoney,
  formatPhone,
  formatTimeRange,
  useToast,
} from '@reset/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth.js';
import { adminClient } from '@/lib/client.js';
import { keys, useStations } from '@/lib/queries.js';
import { isoToLocalInput, localInputToIso } from '@/lib/time.js';

export interface BookingDrawerProps {
  booking: (TimelineBooking & { stationId: string }) | null;
  date: string;
  timeZone: string;
  onClose: () => void;
}

/**
 * Everything staff can do to one booking.
 *
 * Works entirely from the row the timeline already returned — there is no
 * `GET /admin/bookings/:id`, and adding a fetch would mean a spinner over data that is
 * already on screen.
 *
 * Status changes are a deliberate subset. HELD, EXPIRED and CONFIRMED are reached through
 * the booking and payment flows and are never set by hand; offering them here would let the
 * counter mark something paid that nobody paid for.
 */
export function BookingDrawer({ booking, date, timeZone, onClose }: BookingDrawerProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stations = useStations();

  const [rescheduleAt, setRescheduleAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRescheduleAt(booking?.startsAt ?? '');
    setError(null);
  }, [booking]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.timeline(date) });
    void queryClient.invalidateQueries({ queryKey: keys.dashboard });
  };

  const onError = (caught: unknown): void => setError(errorMessage(caught));

  const setStatus = useMutation({
    mutationFn: (status: 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED') =>
      adminClient().bookings.setStatus(booking!.id, { status }),
    onSuccess: () => {
      toast.success('Booking updated.');
      refresh();
      onClose();
    },
    onError,
  });

  const reassign = useMutation({
    mutationFn: (stationId: string) =>
      adminClient().bookings.reassignStation(booking!.id, stationId),
    onSuccess: () => {
      toast.success('Moved to another station.');
      refresh();
    },
    onError,
  });

  const reschedule = useMutation({
    mutationFn: () => adminClient().bookings.reschedule(booking!.id, rescheduleAt),
    onSuccess: () => {
      toast.success('Moved. The payment and the QR are unchanged.');
      refresh();
      onClose();
    },
    onError,
  });

  if (booking === null) return null;

  const busy = setStatus.isPending || reassign.isPending || reschedule.isPending;
  const closed = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(booking.status);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={booking.customerName}
      description={
        <>
          {booking.serviceName} · {formatTimeRange(booking.startsAt, booking.endsAt, timeZone)}
        </>
      }
    >
      <div className="flex flex-col gap-lg">
        <div className="flex flex-wrap items-center gap-sm">
          <BookingStatusBadge status={booking.status} />
          {booking.source === 'ADMIN_WALKIN' && <Badge tone="info">Walk-in</Badge>}
          <span className="font-mono text-body-sm">{formatBookingCode(booking.publicId)}</span>
          <span className="text-body-sm text-text-muted">
            {formatMoney(booking.payablePaise)}
          </span>
        </div>

        {booking.customerPhone !== null && (
          <a
            href={`tel:${booking.customerPhone}`}
            className="text-body text-primary underline underline-offset-4"
          >
            {formatPhone(booking.customerPhone)}
          </a>
        )}

        {error !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}

        {closed ? (
          <p className="text-body-sm text-text-muted">
            This booking is {booking.status.toLowerCase().replace('_', ' ')} and can no longer
            be changed.
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-sm">
              <h3 className="text-body-sm font-medium">Status</h3>
              <div className="flex flex-wrap gap-sm">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStatus.mutate('CHECKED_IN')}
                >
                  Checked in
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStatus.mutate('IN_PROGRESS')}
                >
                  In progress
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStatus.mutate('COMPLETED')}
                >
                  Completed
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStatus.mutate('NO_SHOW')}
                >
                  No-show
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setStatus.mutate('CANCELLED')}
                >
                  Cancel
                </Button>
              </div>
            </section>

            <section className="flex flex-col gap-sm">
              <h3 className="text-body-sm font-medium">Move to another station</h3>
              <Select
                value={booking.stationId}
                disabled={busy}
                onChange={(event) => reassign.mutate(event.target.value)}
                hint="Same time, different station. Refused if that station is not free or cannot perform the service."
              >
                {(stations.data ?? []).map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </Select>
            </section>

            <section className="flex flex-col gap-sm">
              <h3 className="text-body-sm font-medium">Move to another time</h3>
              <Input
                type="datetime-local"
                value={isoToLocalInput(rescheduleAt, timeZone)}
                disabled={busy}
                onChange={(event) =>
                  setRescheduleAt(localInputToIso(event.target.value, timeZone))
                }
                hint="The price, the payment and the QR all survive. The old slot is released only once the new one is secured."
              />
              <Button
                variant="secondary"
                disabled={busy || rescheduleAt === booking.startsAt || rescheduleAt === ''}
                loading={reschedule.isPending}
                onClick={() => reschedule.mutate()}
              >
                Reschedule
              </Button>
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
