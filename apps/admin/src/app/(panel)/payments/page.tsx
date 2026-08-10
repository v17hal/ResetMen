'use client';

import type { AdminPaymentRow, PaymentStatus } from '@reset/api-client';
import {
  Button,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  PaymentStatusBadge,
  Textarea,
  formatDateTime,
  formatMoney,
  paiseToRupees,
  rupeesToPaise,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

const STATUSES: ReadonlyArray<PaymentStatus | 'ALL'> = [
  'ALL',
  'CAPTURED',
  'CREATED',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

export default function PaymentsPage() {
  const [status, setStatus] = useState<PaymentStatus | 'ALL'>('ALL');
  const [refunding, setRefunding] = useState<AdminPaymentRow | null>(null);

  const filter = status === 'ALL' ? undefined : status;

  const payments = useQuery({
    queryKey: keys.payments(filter),
    queryFn: () =>
      adminClient().payments.list({ ...(filter === undefined ? {} : { status: filter }), limit: 100 }),
  });

  const failures = useQuery({
    queryKey: ['payments', 'webhook-failures'],
    queryFn: () => adminClient().payments.webhookFailures(),
  });

  const failureCount = Array.isArray(failures.data) ? failures.data.length : 0;

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Payments</h1>
        <p className="text-body-sm text-text-muted">
          Every charge and refund. Refunds go back to the original method.
        </p>
      </header>

      {/* Should normally be empty. When it is not, money and bookings have diverged. */}
      {failureCount > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <p className="text-body font-medium">
            {failureCount} webhook{failureCount === 1 ? '' : 's'} could not be processed.
          </p>
          <p className="text-body-sm text-text-muted">
            The reconciliation job retries these automatically. If the count is not falling,
            a payment may have been taken without its booking being confirmed.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-xs">
        {STATUSES.map((option) => (
          <Button
            key={option}
            variant={status === option ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setStatus(option)}
          >
            {option === 'ALL' ? 'All' : option.toLowerCase().replace('_', ' ')}
          </Button>
        ))}
      </div>

      {payments.isError ? (
        <ErrorState
          description={errorMessage(payments.error)}
          onRetry={() => void payments.refetch()}
        />
      ) : (
        <DataTable
          loading={payments.isPending}
          rows={payments.data?.data ?? []}
          rowKey={(row) => row.id}
          empty={{ title: 'No payments in this view' }}
          columns={[
            {
              key: 'reference',
              header: 'Reference',
              cell: (row) => (
                <div className="flex flex-col">
                  <span className="font-mono text-body-sm">{row.reference ?? '—'}</span>
                  <span className="text-caption text-text-muted">{row.description}</span>
                </div>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              cell: (row) => (
                <div className="flex flex-col items-end">
                  <span className="font-medium">{formatMoney(row.amountPaise)}</span>
                  {row.refundedPaise > 0 && (
                    <span className="text-caption text-danger">
                      −{formatMoney(row.refundedPaise)}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (row) => (
                <div className="flex flex-col items-start gap-0.5">
                  <PaymentStatusBadge status={row.status} />
                  {row.failureReason !== null && (
                    <span className="text-caption text-danger">{row.failureReason}</span>
                  )}
                </div>
              ),
            },
            {
              key: 'method',
              header: 'Method',
              hideOnMobile: true,
              cell: (row) => row.method ?? <span className="text-text-muted">—</span>,
            },
            {
              key: 'created',
              header: 'When',
              hideOnMobile: true,
              cell: (row) => formatDateTime(row.createdAt),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (row) =>
                row.refundedPaise >= row.amountPaise ||
                !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(row.status) ? null : (
                  <Button variant="ghost" size="sm" onClick={() => setRefunding(row)}>
                    Refund
                  </Button>
                ),
            },
          ]}
        />
      )}

      <RefundDialog
        payment={refunding}
        onClose={() => setRefunding(null)}
        listKey={keys.payments(filter)}
      />
    </div>
  );
}

function RefundDialog({
  payment,
  onClose,
  listKey,
}: {
  payment: AdminPaymentRow | null;
  onClose: () => void;
  listKey: readonly unknown[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remainingPaise = payment === null ? 0 : payment.amountPaise - payment.refundedPaise;

  /**
   * Generated once per dialog opening, and reused across retries.
   *
   * This is the route that needs idempotency most: a manager whose browser times out
   * mid-refund will click again, and the second click must not send the money twice. A key
   * regenerated per click would protect nothing.
   */
  const idempotencyKey = useMemo(
    () => (payment === null ? '' : `refund-${payment.id}-${crypto.randomUUID()}`),
    [payment],
  );

  useEffect(() => {
    setAmount(payment === null ? '' : String(paiseToRupees(remainingPaise)));
    setReason('');
    setError(null);
  }, [payment, remainingPaise]);

  const refund = useMutation({
    mutationFn: () => {
      const paise = rupeesToPaise(Number(amount));
      return adminClient().payments.refund(
        payment!.id,
        {
          // Omitted entirely for a full refund, which is what the API expects.
          ...(paise >= remainingPaise ? {} : { amountPaise: paise }),
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        },
        idempotencyKey,
      );
    },
    onSuccess: () => {
      toast.success('Refund sent.');
      void queryClient.invalidateQueries({ queryKey: listKey });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught, 'The refund was not sent.')),
  });

  if (payment === null) return null;

  const paise = rupeesToPaise(Number(amount) || 0);
  const tooMuch = paise > remainingPaise;
  const tooLittle = paise <= 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Refund"
      description={`${payment.description} · ${payment.reference ?? 'no reference'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={refund.isPending}
            disabled={tooMuch || tooLittle}
            onClick={() => refund.mutate()}
          >
            Refund {formatMoney(paise)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <dl className="grid grid-cols-2 gap-sm text-body-sm">
          <div>
            <dt className="text-text-muted">Charged</dt>
            <dd className="font-medium">{formatMoney(payment.amountPaise)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Already refunded</dt>
            <dd className="font-medium">{formatMoney(payment.refundedPaise)}</dd>
          </div>
        </dl>

        <Input
          label="Amount to refund"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          max={paiseToRupees(remainingPaise)}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          hint={`Up to ${formatMoney(remainingPaise)} remaining. Leave at the full amount for a complete refund.`}
          error={tooMuch ? 'More than is left on this payment.' : null}
        />

        <Textarea
          label="Reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error}
          hint="Recorded in the audit log."
        />
      </div>
    </Dialog>
  );
}
