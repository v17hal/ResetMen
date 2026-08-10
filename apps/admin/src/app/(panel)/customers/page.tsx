'use client';

import type { CustomerSummary } from '@reset/api-client';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  Textarea,
  formatDate,
  formatMoney,
  formatPhone,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import { useDebounced } from '@/lib/use-debounced';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);

  // Typing "9404" issues one request, not four.
  const query = useDebounced(search, 300);

  const params = {
    ...(query.trim() === '' ? {} : { q: query.trim() }),
    ...(blockedOnly ? { blocked: true } : {}),
    limit: 50,
  };

  const customers = useQuery({
    queryKey: keys.customers(params),
    queryFn: () => adminClient().customers.list(params),
  });

  return (
    <div className="flex flex-col gap-base">
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div>
          <h1 className="font-display text-h1">Customers</h1>
          <p className="text-body-sm text-text-muted">Search by name or phone number.</p>
        </div>
        <Button
          variant={blockedOnly ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setBlockedOnly((on) => !on)}
        >
          {blockedOnly ? 'Showing blocked' : 'Show blocked only'}
        </Button>
      </header>

      <Input
        label="Search"
        placeholder="Name or phone"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        autoComplete="off"
        containerClassName="max-w-sm"
      />

      {customers.isError ? (
        <ErrorState
          description={errorMessage(customers.error)}
          onRetry={() => void customers.refetch()}
        />
      ) : (
        <DataTable
          loading={customers.isPending}
          rows={customers.data?.data ?? []}
          rowKey={(row) => row.id}
          onRowClick={setSelected}
          empty={{
            title: query === '' ? 'No customers yet' : 'Nobody matches that',
            description:
              query === ''
                ? 'Customers appear here after their first booking.'
                : 'Try a partial phone number, or just the first few letters of a name.',
          }}
          columns={[
            {
              key: 'name',
              header: 'Customer',
              cell: (row) => (
                <div className="flex flex-col">
                  <span className="font-medium">{row.name ?? 'Guest'}</span>
                  <span className="text-caption text-text-muted">{formatPhone(row.phone)}</span>
                </div>
              ),
            },
            {
              key: 'visits',
              header: 'Visits',
              align: 'right',
              cell: (row) => row.completedVisits,
            },
            {
              key: 'streak',
              header: 'Streak',
              align: 'right',
              hideOnMobile: true,
              cell: (row) =>
                row.currentStreak > 0 ? (
                  <Badge tone="accent">{row.currentStreak}</Badge>
                ) : (
                  <span className="text-text-muted">—</span>
                ),
            },
            {
              key: 'ltv',
              header: 'Lifetime',
              align: 'right',
              hideOnMobile: true,
              cell: (row) => formatMoney(row.lifetimeValuePaise),
            },
            {
              key: 'last',
              header: 'Last visit',
              hideOnMobile: true,
              cell: (row) =>
                row.lastVisitAt === null ? (
                  <span className="text-text-muted">Never</span>
                ) : (
                  formatDate(row.lastVisitAt)
                ),
            },
            {
              key: 'status',
              header: '',
              align: 'right',
              cell: (row) => (row.isBlocked ? <Badge tone="danger">Blocked</Badge> : null),
            },
          ]}
        />
      )}

      <CustomerDialog
        customer={selected}
        onClose={() => setSelected(null)}
        listKey={keys.customers(params)}
      />
    </div>
  );
}

function CustomerDialog({
  customer,
  onClose,
  listKey,
}: {
  customer: CustomerSummary | null;
  onClose: () => void;
  listKey: readonly unknown[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [customer]);

  const setBlocked = useMutation({
    mutationFn: (blocked: boolean) =>
      adminClient().customers.setBlocked(customer!.id, {
        blocked,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      }),
    onSuccess: (_, blocked) => {
      toast.success(blocked ? 'Customer blocked.' : 'Customer unblocked.');
      void queryClient.invalidateQueries({ queryKey: listKey });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (customer === null) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={customer.name ?? 'Guest'}
      description={formatPhone(customer.phone)}
    >
      <div className="flex flex-col gap-lg">
        <dl className="grid grid-cols-2 gap-base text-body-sm">
          <div>
            <dt className="text-text-muted">Completed visits</dt>
            <dd className="font-medium">{customer.completedVisits}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Total bookings</dt>
            <dd className="font-medium">{customer.totalBookings}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Lifetime value</dt>
            <dd className="font-medium">{formatMoney(customer.lifetimeValuePaise)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Current streak</dt>
            <dd className="font-medium">{customer.currentStreak}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Customer since</dt>
            <dd className="font-medium">{formatDate(customer.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Last visit</dt>
            <dd className="font-medium">
              {customer.lastVisitAt === null ? 'Never' : formatDate(customer.lastVisitAt)}
            </dd>
          </div>
        </dl>

        <section className="flex flex-col gap-sm border-t border-border pt-base">
          <h3 className="text-body-sm font-medium">
            {customer.isBlocked ? 'Unblock' : 'Block'} this customer
          </h3>
          <p className="text-caption text-text-muted">
            {customer.isBlocked
              ? 'They will be able to book again immediately.'
              : 'They keep their existing bookings but cannot make new ones. Reversible.'}
          </p>

          <Textarea
            label="Reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error}
            // An unexplained block is a support call the counter cannot answer.
            hint="Recorded in the audit log and shown to whoever asks why."
          />

          <Button
            variant={customer.isBlocked ? 'secondary' : 'danger'}
            loading={setBlocked.isPending}
            onClick={() => setBlocked.mutate(!customer.isBlocked)}
          >
            {customer.isBlocked ? 'Unblock' : 'Block'}
          </Button>
        </section>
      </div>
    </Dialog>
  );
}
