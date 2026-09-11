'use client';

import type { AdminSupportRow } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  SkeletonList,
  Textarea,
  cn,
  formatDateTime,
  formatPhone,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import { STORE_TIMEZONE } from '@/lib/time';

type Filter = 'OPEN' | 'CLOSED' | 'ALL';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'ALL', label: 'All' },
];

/**
 * Help desk — client request 11/09/2026.
 *
 * The phone number came off the website; customers write in from the site or the app
 * instead, and whoever is on the desk answers here. A reply lands in the customer's app
 * with a notification, so there is nothing to ring back.
 *
 * Unanswered questions sort to the top. The list refreshes itself every thirty seconds,
 * because a question waiting on a screen nobody reloads is a question nobody answers.
 */
export default function HelpDeskPage() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: keys.supportList(filter),
    queryFn: () => adminClient().support.list(filter),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Help desk</h1>
        <p className="text-body-sm text-text-muted">
          Questions customers send from the website and the app. Your reply reaches them in
          the app, with a notification.
        </p>
      </header>

      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-xs">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            role="tab"
            aria-selected={filter === item.id}
            variant={filter === item.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {threads.isError ? (
        <ErrorState description={errorMessage(threads.error)} onRetry={() => void threads.refetch()} />
      ) : (
        <DataTable
          loading={threads.isPending}
          rows={threads.data ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => setOpenId(row.id)}
          empty={{
            title: filter === 'OPEN' ? 'Nothing waiting' : 'No questions here',
            description:
              filter === 'OPEN'
                ? 'New questions from customers appear here, newest unanswered first.'
                : undefined,
          }}
          columns={[
            {
              key: 'subject',
              header: 'Question',
              cell: (row) => (
                <div className="flex min-w-0 flex-col">
                  <span className={cn('flex items-center gap-xs', row.unread && 'font-semibold')}>
                    {row.unread && (
                      <span aria-label="New" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <span className="truncate">{row.subject}</span>
                  </span>
                  <span className="truncate text-caption text-text-muted">{row.preview}</span>
                </div>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              hideOnMobile: true,
              cell: (row) => <CustomerLine row={row} />,
            },
            { key: 'status', header: 'Status', cell: (row) => <StatusBadge row={row} /> },
            {
              key: 'when',
              header: 'Last message',
              align: 'right',
              hideOnMobile: true,
              cell: (row) => formatDateTime(row.lastMessageAt, STORE_TIMEZONE),
            },
          ]}
        />
      )}

      <ThreadDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CustomerLine({ row }: { row: Pick<AdminSupportRow, 'customer'> }) {
  return (
    <div className="flex flex-col">
      <span>{row.customer.name ?? 'Customer'}</span>
      <span className="text-caption text-text-muted">
        {row.customer.phone !== null ? formatPhone(row.customer.phone) : (row.customer.email ?? '')}
      </span>
    </div>
  );
}

function StatusBadge({ row }: { row: Pick<AdminSupportRow, 'status' | 'lastMessageBy' | 'unread'> }) {
  if (row.status === 'CLOSED') return <Badge>Closed</Badge>;
  if (row.unread) return <Badge tone="warning">New</Badge>;
  return row.lastMessageBy === 'STAFF' ? (
    <Badge tone="success">Replied</Badge>
  ) : (
    <Badge tone="warning">Waiting</Badge>
  );
}

function ThreadDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const thread = useQuery({
    queryKey: keys.supportThread(id ?? ''),
    queryFn: () => adminClient().support.get(id!),
    enabled: id !== null,
    refetchInterval: 20_000,
  });

  // Opening a question clears it from the unread count, so the list and the sidebar badge
  // are stale the moment it loads.
  useEffect(() => {
    if (thread.data === undefined) return;
    void queryClient.invalidateQueries({ queryKey: ['support-list'] });
    void queryClient.invalidateQueries({ queryKey: keys.supportUnread });
  }, [thread.dataUpdatedAt, thread.data, queryClient]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread.data?.messages.length]);

  useEffect(() => setDraft(''), [id]);

  const reply = useMutation({
    mutationFn: () => adminClient().support.reply(id!, draft.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.supportThread(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ['support-list'] });
      setDraft('');
      toast.success('Sent. The customer gets a notification.');
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const setStatus = useMutation({
    mutationFn: (status: 'OPEN' | 'CLOSED') => adminClient().support.setStatus(id!, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.supportThread(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ['support-list'] });
      void queryClient.invalidateQueries({ queryKey: keys.supportUnread });
      toast.success(updated.status === 'CLOSED' ? 'Closed.' : 'Reopened.');
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (id === null) return null;
  const data = thread.data;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={data?.subject ?? 'Question'}
      className="sm:max-w-lg"
      footer={
        data === undefined ? undefined : (
          <>
            <Button
              variant="secondary"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate(data.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}
            >
              {data.status === 'CLOSED' ? 'Reopen' : 'Close question'}
            </Button>
            <Button
              loading={reply.isPending}
              disabled={draft.trim() === ''}
              onClick={() => reply.mutate()}
            >
              Send reply
            </Button>
          </>
        )
      }
    >
      {thread.isError ? (
        <ErrorState description={errorMessage(thread.error)} onRetry={() => void thread.refetch()} />
      ) : data === undefined ? (
        <SkeletonList rows={3} />
      ) : (
        <div className="flex flex-col gap-base">
          <Card className="flex flex-col gap-xs text-body-sm">
            <div className="flex items-center justify-between gap-sm">
              <CustomerLine row={data} />
              <span className="font-mono text-caption text-text-muted">{data.publicId}</span>
            </div>
            {data.booking !== null && (
              <p className="text-caption text-text-muted">
                About {data.booking.publicId} · {data.booking.serviceName} ·{' '}
                {formatDateTime(data.booking.startsAt, STORE_TIMEZONE)}
              </p>
            )}
          </Card>

          <ol className="flex flex-col gap-sm" aria-label="Conversation">
            {data.messages.map((message) => {
              const staff = message.author === 'STAFF';
              return (
                <li
                  key={message.id}
                  className={cn('flex flex-col gap-0.5', staff ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap rounded-lg px-md py-sm text-body-sm',
                      staff ? 'bg-primary/10 text-text' : 'border border-border bg-surface',
                    )}
                  >
                    {message.body}
                  </div>
                  <span className="text-caption text-text-muted">
                    {staff ? (message.staffName ?? 'Staff') : (data.customer.name ?? 'Customer')} ·{' '}
                    {formatDateTime(message.createdAt, STORE_TIMEZONE)}
                  </span>
                </li>
              );
            })}
          </ol>
          <div ref={bottom} />

          {data.status === 'CLOSED' && (
            <p className="text-caption text-text-muted">
              Closed. Replying reopens it, and so does the customer writing again.
            </p>
          )}

          <Textarea
            label="Reply"
            rows={3}
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            hint="The customer sees this as from “RESET team”. Your name stays in the admin panel."
          />
        </div>
      )}
    </Dialog>
  );
}
