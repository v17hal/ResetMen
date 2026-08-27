'use client';

import type { TimelineBooking } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Select,
  SkeletonList,
  formatMoney,
  formatPhone,
  formatTime,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

type Method = 'CASH' | 'UPI' | 'CARD' | 'OTHER';

const METHODS: readonly Method[] = ['CASH', 'UPI', 'CARD', 'OTHER'];

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

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
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [method, setMethod] = useState<Method>('CASH');

  const timeline = useQuery({
    queryKey: keys.timeline(date),
    queryFn: () => adminClient().bookings.timeline(date),
  });

  const markPaid = useMutation({
    mutationFn: (booking: TimelineBooking) =>
      adminClient().bookings.markPaid(booking.id, { method }),
    onSuccess: (result, booking) => {
      if (result.alreadyRecorded) {
        toast.show(`${booking.publicId} was already marked paid.`);
      } else {
        toast.success(`${booking.publicId} — ${formatMoney(result.amountPaise)} recorded.`);
      }
      void queryClient.invalidateQueries({ queryKey: keys.timeline(date) });
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  // Cancelled and expired bookings are not money anybody is owed.
  const collectable = (timeline.data?.stations ?? [])
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
          customer, take payment, then mark it here.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-sm">
        <label className="flex flex-col gap-xs text-body-sm">
          <span className="text-text-muted">Day</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-text"
          />
        </label>

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
          title={onlyUnpaid ? 'Nothing outstanding' : 'No bookings on this day'}
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
            { key: 'time', header: 'Time', cell: (row) => formatTime(row.startsAt) },
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
                  <Button
                    size="sm"
                    loading={markPaid.isPending && markPaid.variables?.id === row.id}
                    onClick={() => markPaid.mutate(row)}
                  >
                    Mark paid
                  </Button>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
