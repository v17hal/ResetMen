'use client';

import type { TimelineBooking } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Select,
  SkeletonList,
  formatDate,
  formatMoney,
  formatPhone,
  formatTime,
  useToast,
} from '@reset/ui';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

type Method = 'CASH' | 'UPI' | 'CARD' | 'OTHER';

const METHODS: readonly Method[] = ['CASH', 'UPI', 'CARD', 'OTHER'];

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(from: string, days: number): string {
  const d = new Date(`${from}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

/** Matches the store's booking horizon: nothing can be booked further out than this. */
const HORIZON_DAYS = 8;

/**
 * Money still to collect.
 *
 * There is no payment gateway — the store takes cash at the counter — so every booking
 * arrives unpaid and someone has to chase it. This is that list: who owes, how much, and
 * the number to ring, with one button to record the money once it is in the till.
 *
 * Built on the timeline rather than a bookings list because the API exposes the day by
 * station and no cross-customer query. That also matches how the counter thinks: today's
 * takings, not an unbounded ledger.
 */
export default function PaymentsDuePage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState(today);
  const [wholeHorizon, setWholeHorizon] = useState(true);
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [method, setMethod] = useState<Method>('CASH');
  const [confirming, setConfirming] = useState<TimelineBooking | null>(null);

  /**
   * Every day someone might still be rung about, not just today.
   *
   * This screen opened on today and nothing else, which hid the bookings it exists for:
   * a customer books tomorrow, the store has to call them today, and the row was a day
   * away on a date picker nobody thought to move. Somebody would have been chased only
   * after their slot had passed.
   *
   * The API exposes the day by station and has no range query, so this is one request per
   * day across the booking horizon. Eight small reads on a screen the counter keeps open —
   * cheaper than the endpoint that does not exist yet.
   */
  const days = wholeHorizon
    ? Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today(), i))
    : [date];

  const results = useQueries({
    queries: days.map((day) => ({
      queryKey: keys.timeline(day),
      queryFn: () => adminClient().bookings.timeline(day),
    })),
  });

  const timeline = {
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    isSuccess: results.every((r) => r.isSuccess),
    error: results.find((r) => r.isError)?.error,
    refetch: () => results.forEach((r) => void r.refetch()),
    data: results.flatMap((r) => r.data?.stations ?? []),
  };

  const markPaid = useMutation({
    mutationFn: (booking: TimelineBooking) =>
      adminClient().bookings.markPaid(booking.id, { method }),
    onSuccess: (result, booking) => {
      if (result.alreadyRecorded) {
        toast.show(`${booking.publicId} was already marked paid.`);
      } else {
        toast.success(`${booking.publicId} — ${formatMoney(result.amountPaise)} recorded.`);
      }
      days.forEach((d) => void queryClient.invalidateQueries({ queryKey: keys.timeline(d) }));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  /**
   * The other half of chasing payment.
   *
   * Some of these calls end in "I don't want it any more", and without a way to act on that
   * the slot stays held and the row stays on this list for ever. Cancelling frees the time
   * for someone else and takes it off the chase.
   */
  const cancel = useMutation({
    mutationFn: (booking: TimelineBooking) =>
      adminClient().bookings.setStatus(booking.id, {
        status: 'CANCELLED',
        reason: 'Cancelled by the store — payment not made',
      }),
    onSuccess: (_result, booking) => {
      toast.success(`${booking.publicId} cancelled. The slot is free again.`);
      days.forEach((d) => void queryClient.invalidateQueries({ queryKey: keys.timeline(d) }));
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  // Cancelled and expired bookings are not money anybody is owed.
  const collectable = timeline.data
    .flatMap((station) => station.bookings)
    .filter((b) => b.status !== 'CANCELLED' && b.status !== 'EXPIRED')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const rows = onlyUnpaid ? collectable.filter((b) => !b.isPaid) : collectable;

  const outstanding = collectable
    .filter((b) => !b.isPaid)
    .reduce((sum, b) => sum + b.payablePaise, 0);
  const taken = collectable
    .filter((b) => b.isPaid)
    .reduce((sum, b) => sum + b.payablePaise, 0);

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Payments due</h1>
        <p className="text-body-sm text-text-muted">
          Bookings taken in the app are unpaid until the money is in the till. Ring the
          customer, take payment, then mark it here. Showing everything still to collect
          across the next week — a booking usually needs chasing before the day it is for.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-sm">
        <label className="flex flex-col gap-xs text-body-sm">
          <span className="text-text-muted">Day</span>
          <input
            type="date"
            value={date}
            disabled={wholeHorizon}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-text disabled:opacity-40"
          />
        </label>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWholeHorizon((value) => !value)}
        >
          {wholeHorizon ? 'Pick one day' : 'All upcoming'}
        </Button>

        <label className="flex flex-col gap-xs text-body-sm">
          <span className="text-text-muted">Record as</span>
          <Select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOnlyUnpaid((value) => !value)}
        >
          {onlyUnpaid ? 'Show all' : 'Show unpaid only'}
        </Button>
      </div>

      <div className="flex gap-sm">
        <Card className="flex-1">
          <p className="text-body-sm text-text-muted">Outstanding</p>
          <p className="font-display text-h1 text-danger">{formatMoney(outstanding)}</p>
        </Card>
        <Card className="flex-1">
          <p className="text-body-sm text-text-muted">Collected</p>
          <p className="font-display text-h1 text-success">{formatMoney(taken)}</p>
        </Card>
      </div>

      {timeline.isLoading && <SkeletonList rows={4} />}

      {timeline.isError && (
        <ErrorState
          description={errorMessage(timeline.error)}
          onRetry={() => void timeline.refetch()}
        />
      )}

      {timeline.isSuccess && rows.length === 0 && (
        <EmptyState
          title={onlyUnpaid ? 'Nothing outstanding' : 'No bookings in this period'}
          description={
            onlyUnpaid
              ? 'Every booking on this day has been paid for.'
              : 'Pick another date to see its bookings.'
          }
        />
      )}

      {timeline.isSuccess && rows.length > 0 && (
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'when',
              header: 'When',
              // Rows span several days now, so the time alone is ambiguous.
              cell: (row) =>
                wholeHorizon
                  ? `${formatDate(row.startsAt)}, ${formatTime(row.startsAt)}`
                  : formatTime(row.startsAt),
            },
            { key: 'code', header: 'Booking', cell: (row) => row.publicId },
            { key: 'customer', header: 'Customer', cell: (row) => row.customerName },
            {
              key: 'phone',
              header: 'Phone',
              cell: (row) =>
                row.customerPhone === null ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  // Tap-to-call: the whole point of the screen is ringing these people.
                  <a className="underline" href={`tel:${row.customerPhone}`}>
                    {formatPhone(row.customerPhone)}
                  </a>
                ),
            },
            {
              key: 'service',
              header: 'Service',
              cell: (row) => row.serviceName,
              hideOnMobile: true,
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              cell: (row) => formatMoney(row.payablePaise),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (row) =>
                row.isPaid ? (
                  <Badge tone="success">
                    Paid{row.paidMethod === null ? '' : ` · ${row.paidMethod}`}
                  </Badge>
                ) : (
                  <Badge tone="warning">Unpaid</Badge>
                ),
            },
            {
              key: 'action',
              header: '',
              align: 'right',
              cell: (row) =>
                row.isPaid ? null : (
                  <div className="flex justify-end gap-xs">
                    <Button
                      size="sm"
                      loading={markPaid.isPending && markPaid.variables?.id === row.id}
                      onClick={() => markPaid.mutate(row)}
                    >
                      Mark paid
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={cancel.isPending && cancel.variables?.id === row.id}
                      // Asked for first: this frees a slot someone else could have, and a
                      // mis-tap beside "Mark paid" would cancel a booking that was about to
                      // be settled.
                      onClick={() => setConfirming(row)}
                    >
                      Cancel
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Cancel this booking?"
        description={
          confirming === null
            ? undefined
            : `${confirming.customerName} — ${confirming.serviceName} at ${formatTime(
                confirming.startsAt,
              )}. The slot goes back for someone else, and they are not told automatically.`
        }
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => {
          if (confirming !== null) cancel.mutate(confirming);
          setConfirming(null);
        }}
      />
    </div>
  );
}
