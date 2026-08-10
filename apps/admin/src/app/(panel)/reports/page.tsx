'use client';

import {
  Button,
  Card,
  DataTable,
  ErrorState,
  Input,
  SkeletonList,
  StatTile,
  addDays,
  formatMoney,
  formatPercent,
  formatPhone,
  todayLocal,
  useToast,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

type Tab = 'revenue' | 'utilisation' | 'no-show' | 'retention';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'utilisation', label: 'Utilisation' },
  { id: 'no-show', label: 'No-shows' },
  { id: 'retention', label: 'Retention' },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [from, setFrom] = useState(addDays(todayLocal(), -29));
  const [to, setTo] = useState(todayLocal());

  const range = { from, to };
  const invalid = from > to;

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Reports</h1>
        <p className="text-body-sm text-text-muted">
          Both dates are included — 1st to 7th is seven days.
        </p>
      </header>

      <Card className="flex flex-wrap items-end gap-base">
        <Input
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(event) => setFrom(event.target.value)}
          containerClassName="w-40"
        />
        <Input
          label="To"
          type="date"
          value={to}
          min={from}
          onChange={(event) => setTo(event.target.value)}
          containerClassName="w-40"
          error={invalid ? 'The start must not be after the end.' : null}
        />
        <div className="flex gap-xs">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFrom(todayLocal());
              setTo(todayLocal());
            }}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFrom(addDays(todayLocal(), -6));
              setTo(todayLocal());
            }}
          >
            7 days
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFrom(addDays(todayLocal(), -29));
              setTo(todayLocal());
            }}
          >
            30 days
          </Button>
        </div>

        <div className="ml-auto">
          <ExportButton report={tab} range={range} disabled={invalid} />
        </div>
      </Card>

      <div role="tablist" aria-label="Report" className="flex flex-wrap gap-xs">
        {TABS.map((item) => (
          <Button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            variant={tab === item.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {invalid ? null : tab === 'revenue' ? (
        <RevenueReport range={range} />
      ) : tab === 'utilisation' ? (
        <UtilisationReport range={range} />
      ) : tab === 'no-show' ? (
        <NoShowReport range={range} />
      ) : (
        <RetentionReport range={range} />
      )}
    </div>
  );
}

/**
 * CSV download.
 *
 * The export is audited server-side: it is customer names and phone numbers leaving the
 * system, and under the DPDP Act the store has to be able to say who took a copy and when.
 * The response is CSV text, so the blob and object URL are built here rather than pointing
 * an anchor at the endpoint — that would drop the Authorization header and 401.
 */
function ExportButton({
  report,
  range,
  disabled,
}: {
  report: Tab;
  range: { from: string; to: string };
  disabled: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download(): Promise<void> {
    setBusy(true);
    try {
      const csv = await adminClient().reports.exportCsv({ report, ...range });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reset-${report}-${range.from}-to-${range.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not export.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} disabled={disabled} onClick={() => void download()}>
      Export CSV
    </Button>
  );
}

function useReport<T>(kind: string, range: { from: string; to: string }, fn: () => Promise<T>) {
  return useQuery({ queryKey: keys.report(kind, range.from, range.to), queryFn: fn });
}

function RevenueReport({ range }: { range: { from: string; to: string } }) {
  const report = useReport('revenue', range, () => adminClient().reports.revenue(range));

  if (report.isError)
    return <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />;
  if (report.isPending) return <SkeletonList rows={3} />;

  const data = report.data;

  return (
    <div className="flex flex-col gap-base">
      <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
        <StatTile label="Net" value={formatMoney(data.netPaise)} hint="After discounts" />
        <StatTile label="Bookings" value={data.bookingCount} />
        <StatTile label="Average order" value={formatMoney(data.averageOrderPaise)} />
        <StatTile
          label="Refunded"
          value={formatMoney(data.refundedPaise)}
          tone={data.refundedPaise > 0 ? 'danger' : 'default'}
        />
      </div>

      <DataTable
        rows={data.byService}
        rowKey={(row) => row.serviceId ?? row.serviceName}
        empty={{ title: 'No bookings in this range' }}
        columns={[
          { key: 'service', header: 'Service', cell: (row) => row.serviceName },
          { key: 'count', header: 'Bookings', align: 'right', cell: (row) => row.bookingCount },
          { key: 'net', header: 'Net', align: 'right', cell: (row) => formatMoney(row.netPaise) },
        ]}
      />
    </div>
  );
}

function UtilisationReport({ range }: { range: { from: string; to: string } }) {
  const report = useReport('utilisation', range, () => adminClient().reports.utilisation(range));

  if (report.isError)
    return <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />;
  if (report.isPending) return <SkeletonList rows={3} />;

  const data = report.data;

  return (
    <div className="flex flex-col gap-base">
      <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
        <StatTile label="Utilisation" value={formatPercent(data.utilisationPercent)} />
        <StatTile label="Open hours" value={Math.round(data.openMinutes / 60)} />
        <StatTile label="Booked hours" value={Math.round(data.bookedMinutes / 60)} />
        {/* Reported separately because it is the number the owner will challenge. */}
        <StatTile
          label="Cleaning hours"
          value={Math.round(data.bufferMinutes / 60)}
          hint="Buffer between sessions"
        />
      </div>

      <DataTable
        rows={data.byStation}
        rowKey={(row) => row.stationId}
        empty={{ title: 'No stations' }}
        columns={[
          { key: 'station', header: 'Station', cell: (row) => row.stationName },
          { key: 'sessions', header: 'Sessions', align: 'right', cell: (row) => row.sessionCount },
          {
            key: 'booked',
            header: 'Booked hrs',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => Math.round(row.bookedMinutes / 60),
          },
          {
            key: 'util',
            header: 'Utilisation',
            align: 'right',
            cell: (row) => formatPercent(row.utilisationPercent),
          },
        ]}
      />
    </div>
  );
}

function NoShowReport({ range }: { range: { from: string; to: string } }) {
  const report = useReport('no-show', range, () => adminClient().reports.noShow(range));

  if (report.isError)
    return <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />;
  if (report.isPending) return <SkeletonList rows={3} />;

  const data = report.data;

  return (
    <div className="flex flex-col gap-base">
      <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
        <StatTile label="Confirmed" value={data.confirmedCount} />
        <StatTile
          label="No-shows"
          value={data.noShowCount}
          tone={data.noShowPercent > 10 ? 'danger' : 'default'}
          hint={formatPercent(data.noShowPercent)}
        />
        <StatTile label="Cancelled" value={data.cancelledCount} />
        <StatTile
          label="Forfeited"
          value={formatMoney(data.forfeitedRevenuePaise)}
          hint="Paid but not attended"
        />
      </div>

      <DataTable
        rows={data.repeatOffenders}
        rowKey={(row) => row.userId}
        empty={{
          title: 'Nobody has missed more than once',
          description: 'Repeat no-shows would be listed here.',
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
          { key: 'count', header: 'Missed', align: 'right', cell: (row) => row.noShowCount },
        ]}
      />
    </div>
  );
}

function RetentionReport({ range }: { range: { from: string; to: string } }) {
  const report = useReport('retention', range, () => adminClient().reports.retention(range));

  if (report.isError)
    return <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />;
  if (report.isPending) return <SkeletonList rows={2} />;

  const data = report.data;

  return (
    <div className="grid grid-cols-2 gap-sm lg:grid-cols-4">
      <StatTile label="New customers" value={data.newCustomers} />
      <StatTile
        label="Repeat customers"
        value={data.repeatCustomers}
        hint={`${formatPercent(data.repeatPercent)} of the total`}
      />
      <StatTile label="Visits per customer" value={data.averageVisitsPerCustomer.toFixed(1)} />
      <StatTile label="Active streaks" value={data.activeStreaks} tone="accent" />
      <StatTile label="Rewards issued" value={data.rewardsIssued} tone="accent" />
      <StatTile
        label="Rewards redeemed"
        value={data.rewardsRedeemed}
        tone="accent"
        hint={
          data.rewardsIssued === 0
            ? undefined
            : `${formatPercent((data.rewardsRedeemed / data.rewardsIssued) * 100)} of issued`
        }
      />
    </div>
  );
}
