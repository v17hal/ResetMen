'use client';

import { Button, Card, ErrorState, Skeleton, Textarea, cn, formatDateTime, useToast } from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * One conversation with the store.
 *
 * Checks for a reply every twenty seconds while it is open, so someone waiting for an
 * answer sees it arrive without reloading. Opening it clears the "new reply" dot.
 */
export default function HelpThreadPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasToken } = useAuth();
  // Decided after mount, not during it: the server cannot read the stored token, so
  // branching on it straight away rendered different HTML on each side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });
  const thread = useQuery({
    queryKey: ['support-thread', id],
    queryFn: () => api().support.get(id),
    enabled: mounted && hasToken,
    refetchInterval: 20_000,
  });

  // The list's unread dot is stale the moment this loads.
  useEffect(() => {
    if (thread.data !== undefined) void queryClient.invalidateQueries({ queryKey: ['support-threads'] });
  }, [thread.dataUpdatedAt, thread.data, queryClient]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread.data?.messages.length]);

  const reply = useMutation({
    mutationFn: () => api().support.reply(id, draft.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(['support-thread', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['support-threads'] });
      setDraft('');
    },
    // The draft is kept. Losing a paragraph to a dropped connection is the fastest way to
    // make someone give up and ring instead.
    onError: (caught) => toast.error(errorMessage(caught, 'Your message did not send.')),
  });

  const close = useMutation({
    mutationFn: () => api().support.close(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['support-thread', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['support-threads'] });
      toast.success('Marked as solved.');
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const zone = store.data?.timezone;

  return (
    <div className="flex flex-col gap-base p-base">
      <Link href="/help" className="pt-sm text-body-sm text-primary underline underline-offset-4">
        ← All questions
      </Link>

      {!mounted ? (
        <Skeleton className="h-64 w-full" />
      ) : !hasToken ? (
        <Card className="flex flex-col gap-base">
          <h1 className="font-display text-h2">Sign in to see this conversation</h1>
          <SignIn reason="Your questions belong to your account." />
        </Card>
      ) : thread.isError ? (
        <ErrorState description={errorMessage(thread.error)} onRetry={() => void thread.refetch()} />
      ) : thread.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <header className="flex flex-col gap-xs">
            <h1 className="font-display text-h1">{thread.data.subject}</h1>
            <p className="font-mono text-caption text-text-muted">{thread.data.publicId}</p>
            {thread.data.booking !== null && (
              <p className="text-body-sm text-text-muted">
                About {thread.data.booking.publicId} · {thread.data.booking.serviceName} ·{' '}
                {formatDateTime(thread.data.booking.startsAt, zone)}
              </p>
            )}
          </header>

          <ol aria-label="Conversation" className="flex flex-col gap-sm">
            {thread.data.messages.map((message) => {
              const mine = message.author === 'CUSTOMER';
              return (
                <li key={message.id} className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap rounded-lg px-md py-sm text-body',
                      mine ? 'bg-primary/10' : 'border border-border bg-surface',
                    )}
                  >
                    {message.body}
                  </div>
                  <span className="text-caption text-text-muted">
                    {mine ? 'You' : 'RESET team'} · {formatDateTime(message.createdAt, zone)}
                  </span>
                </li>
              );
            })}
          </ol>
          <div ref={bottom} />

          {thread.data.status === 'CLOSED' ? (
            <p className="text-body-sm text-text-muted">
              This question is closed. Writing again will reopen it.
            </p>
          ) : (
            thread.data.lastMessageBy === 'CUSTOMER' && (
              <p className="text-body-sm text-text-muted">
                We have your message and will reply here. You do not need to keep this page open.
              </p>
            )
          )}

          <Card className="flex flex-col gap-sm">
            <Textarea
              label="Reply"
              rows={3}
              value={draft}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-sm">
              {thread.data.status === 'OPEN' && (
                <Button variant="secondary" loading={close.isPending} onClick={() => close.mutate()}>
                  Mark as solved
                </Button>
              )}
              <Button loading={reply.isPending} disabled={draft.trim() === ''} onClick={() => reply.mutate()}>
                Send
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
