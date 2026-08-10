'use client';

import { Badge, Button, Card, DataTable, ErrorState, Input, formatDateTime } from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import { useDebounced } from '@/lib/use-debounced';

/**
 * The audit trail. OWNER only.
 *
 * Read-only by design — an audit log an administrator can edit is not an audit log. It
 * exists to answer "who changed this, and when", which is a question that only ever gets
 * asked after something has already gone wrong.
 */
export default function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filter = useDebounced(entityType, 300);
  const params = {
    ...(filter.trim() === '' ? {} : { entityType: filter.trim() }),
    ...(cursor === undefined ? {} : { cursor }),
    limit: 50,
  };

  const audit = useQuery({
    queryKey: keys.audit(params),
    queryFn: () => adminClient().audit.list(params),
  });

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Audit log</h1>
        <p className="text-body-sm text-text-muted">
          Every change to money, capacity, catalog and customer records.
        </p>
      </header>

      <Input
        label="Filter by entity type"
        placeholder="Booking, Payment, Service, Station…"
        value={entityType}
        onChange={(event) => {
          setEntityType(event.target.value);
          setCursor(undefined);
        }}
        containerClassName="max-w-sm"
        autoComplete="off"
      />

      {audit.isError ? (
        <ErrorState description={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <DataTable
            loading={audit.isPending}
            rows={audit.data?.data ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => setExpanded(expanded === row.id ? null : row.id)}
            empty={{
              title: 'Nothing recorded yet',
              description: 'Entries appear as staff make changes.',
            }}
            columns={[
              {
                key: 'action',
                header: 'Action',
                cell: (row) => (
                  <div className="flex flex-col">
                    <span className="font-mono text-body-sm">{row.action}</span>
                    <span className="text-caption text-text-muted">
                      {row.entityType}
                      {row.entityId !== null && ` · ${row.entityId.slice(0, 8)}`}
                    </span>
                  </div>
                ),
              },
              {
                key: 'actor',
                header: 'By',
                cell: (row) =>
                  row.actor === 'system' ? (
                    <Badge>system</Badge>
                  ) : (
                    <div className="flex flex-col">
                      <span>{row.actor}</span>
                      {row.actorEmail !== null && (
                        <span className="text-caption text-text-muted">{row.actorEmail}</span>
                      )}
                    </div>
                  ),
              },
              {
                key: 'when',
                header: 'When',
                hideOnMobile: true,
                cell: (row) => formatDateTime(row.createdAt),
              },
              {
                key: 'ip',
                header: 'IP',
                hideOnMobile: true,
                cell: (row) => (
                  <span className="font-mono text-caption text-text-muted">{row.ip ?? '—'}</span>
                ),
              },
            ]}
          />

          {/* The before/after payload, shown only for the row that was tapped. */}
          {expanded !== null && (
            <AuditDetail
              entry={audit.data?.data.find((row) => row.id === expanded) ?? null}
              onClose={() => setExpanded(null)}
            />
          )}

          <div className="flex justify-between">
            <Button
              variant="secondary"
              size="sm"
              disabled={cursor === undefined}
              onClick={() => setCursor(undefined)}
            >
              ← Back to newest
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={audit.data?.nextCursor == null}
              onClick={() => setCursor(audit.data?.nextCursor ?? undefined)}
            >
              Older →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function AuditDetail({
  entry,
  onClose,
}: {
  entry: { action: string; before: unknown; after: unknown } | null;
  onClose: () => void;
}) {
  if (entry === null) return null;

  return (
    <Card className="flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-body-sm">{entry.action}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="grid gap-base sm:grid-cols-2">
        <Payload label="Before" value={entry.before} />
        <Payload label="After" value={entry.after} />
      </div>
    </Card>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <span className="text-caption uppercase tracking-wide text-text-muted">{label}</span>
      {value === null || value === undefined ? (
        <span className="text-body-sm text-text-muted">—</span>
      ) : (
        // Scrolls inside its own box. A long payload must not widen the page.
        <pre className="max-h-64 overflow-auto rounded-md bg-surface2 p-sm text-caption">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
