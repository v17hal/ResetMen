'use client';

import type { SupportThreadSummary } from '@reset/api-client';
import { Button, Card, ErrorState, Input, Skeleton, Textarea, cn, formatDateTime } from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * Help — client request 11/09/2026: "remove the mobile number, add a help / chat option".
 *
 * Questions go to the admin panel's help desk; replies come back here and in the app. A
 * customer can see every question they have asked and whether it has been answered.
 */
export default function HelpPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasToken } = useAuth();
  /**
   * The server cannot see the token in localStorage, so it rendered "sign in" while the
   * browser's first render said "signed in" — a hydration mismatch, measured in the
   * browser. Nothing account-shaped is decided until the page has mounted.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [asking, setAsking] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });
  const threads = useQuery({
    queryKey: ['support-threads'],
    queryFn: () => api().support.list(),
    enabled: mounted && hasToken,
    refetchInterval: 30_000,
  });

  const ask = useMutation({
    mutationFn: () => api().support.create({ subject: subject.trim(), body: body.trim() }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['support-threads'] });
      router.push(`/help/${created.id}`);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const zone = store.data?.timezone;

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs pt-sm">
        <h1 className="font-display text-h1">Help</h1>
        <p className="text-body-sm text-text-muted">
          Ask about a booking, a treatment or the shop. We reply here and in the app.
        </p>
      </header>

      {!mounted ? (
        <Skeleton className="h-24 w-full" />
      ) : !hasToken ? (
        <Card className="flex flex-col gap-base">
          <h2 className="font-display text-h2">Sign in to ask us</h2>
          <SignIn reason="So our reply reaches you." />
        </Card>
      ) : (
        <>
          {asking ? (
            <Card className="flex flex-col gap-base">
              <Input
                label="Subject"
                required
                value={subject}
                maxLength={120}
                placeholder="Can I bring a friend?"
                onChange={(event) => setSubject(event.target.value)}
              />
              <Textarea
                label="Your question"
                required
                rows={4}
                value={body}
                maxLength={2000}
                onChange={(event) => setBody(event.target.value)}
                error={error}
              />
              <div className="flex justify-end gap-sm">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAsking(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  loading={ask.isPending}
                  disabled={subject.trim().length < 3 || body.trim() === ''}
                  onClick={() => ask.mutate()}
                >
                  Send
                </Button>
              </div>
              {subject.trim().length > 0 && subject.trim().length < 3 && (
                <p className="text-caption text-text-muted">The subject needs three letters or more.</p>
              )}
            </Card>
          ) : (
            <Button size="lg" fullWidth onClick={() => setAsking(true)}>
              Ask a question
            </Button>
          )}

          <section className="flex flex-col gap-sm">
            <h2 className="font-display text-h2">Your questions</h2>

            {threads.isError ? (
              <ErrorState description={errorMessage(threads.error)} onRetry={() => void threads.refetch()} />
            ) : threads.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : threads.data.length === 0 ? (
              <p className="text-body-sm text-text-muted">
                Nothing yet. Questions you send appear here, with our replies.
              </p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {threads.data.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      href={`/help/${thread.id}`}
                      className="block rounded-md border border-border bg-surface p-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-start justify-between gap-sm">
                        <span className={cn('flex items-center gap-xs', thread.unread && 'font-semibold')}>
                          {thread.unread && (
                            <span aria-label="New reply" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                          {thread.subject}
                        </span>
                        <Status thread={thread} />
                      </div>
                      <p className="mt-xs line-clamp-2 text-body-sm text-text-muted">{thread.preview}</p>
                      <p className="mt-xs text-caption text-text-muted">
                        {formatDateTime(thread.lastMessageAt, zone)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Status({ thread }: { thread: SupportThreadSummary }) {
  const [label, tone] =
    thread.status === 'CLOSED'
      ? ['Closed', 'text-text-muted']
      : thread.lastMessageBy === 'STAFF'
        ? ['Replied', 'text-primary']
        : ['Waiting for reply', 'text-text-muted'];
  return <span className={cn('shrink-0 text-caption font-medium', tone)}>{label}</span>;
}
