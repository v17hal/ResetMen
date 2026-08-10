'use client';

import type { ScratchCardDto } from '@reset/api-client';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  SkeletonList,
  cn,
  formatDate,
  formatMoney,
  useReducedMotion,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

export default function RewardsPage() {
  const { hasToken } = useAuth();

  const streak = useQuery({
    queryKey: ['streak'],
    queryFn: () => api().rewards.streak(),
    enabled: hasToken,
  });

  const wallet = useQuery({
    queryKey: ['wallet', 'all'],
    queryFn: () => api().rewards.wallet(),
    enabled: hasToken,
  });

  const cards = useQuery({
    queryKey: ['scratch-cards'],
    queryFn: () => api().rewards.scratchCards(),
    enabled: hasToken,
  });

  if (!hasToken) {
    return (
      <div className="flex flex-col gap-base p-base">
        <h1 className="font-display text-h1">Rewards</h1>
        <Card>
          <SignIn reason="Sign in to see your streak, your rewards and your scratch cards." />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg p-base">
      <h1 className="font-display text-h1">Rewards</h1>

      {streak.isError ? (
        <ErrorState description={errorMessage(streak.error)} onRetry={() => void streak.refetch()} />
      ) : streak.isPending ? (
        <SkeletonList rows={1} />
      ) : (
        <StreakCard streak={streak.data} />
      )}

      <section className="flex flex-col gap-sm">
        <h2 className="font-display text-h2">Scratch cards</h2>
        {cards.isPending ? (
          <SkeletonList rows={1} />
        ) : cards.data === undefined || cards.data.length === 0 ? (
          <Card className="text-body-sm text-text-muted">
            You earn these by turning up. Your next visit might bring one.
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-sm sm:grid-cols-3">
            {cards.data.map((card) => (
              <li key={card.id}>
                <ScratchCard card={card} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-sm">
        <h2 className="font-display text-h2">Your wallet</h2>
        {wallet.isPending ? (
          <SkeletonList rows={2} />
        ) : wallet.data === undefined || wallet.data.length === 0 ? (
          <EmptyState
            title="No rewards yet"
            description="Complete a streak or scratch a card and they will appear here."
          />
        ) : (
          <ul className="flex flex-col gap-sm">
            {wallet.data.map((entry) => (
              <li key={entry.id}>
                <Card className="flex items-center gap-base">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{entry.label}</p>
                    <p className="text-caption text-text-muted">
                      Valid until {formatDate(entry.validTill)}
                      {entry.minOrderPaise > 0 &&
                        ` · on orders over ${formatMoney(entry.minOrderPaise)}`}
                    </p>
                  </div>
                  {entry.status === 'ACTIVE' ? (
                    <Badge tone="accent">Ready</Badge>
                  ) : (
                    <Badge>{entry.status.toLowerCase()}</Badge>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The streak ring.
 *
 * Drawn as an SVG arc rather than a progress bar because the milestone is the point, and a
 * ring that visibly closes reads as "nearly there" in a way a bar does not.
 */
function StreakCard({ streak }: { streak: { currentCount: number; bestCount: number; totalVisits: number; goal: { name: string; requiredVisits: number; rewardLabel: string; remaining: number } | null } }) {
  const reduced = useReducedMotion();
  const required = streak.goal?.requiredVisits ?? 0;
  const progress = required === 0 ? 0 : Math.min(1, streak.currentCount / required);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <Card elevated className="flex items-center gap-lg">
      <div className="relative shrink-0">
        <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden>
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="var(--reset-color-surface2)"
            strokeWidth="10"
          />
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="var(--reset-color-accent)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 64 64)"
            style={
              reduced
                ? undefined
                : {
                    transition: `stroke-dashoffset var(--reset-duration-slow) var(--reset-easing-standard)`,
                  }
            }
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-display">{streak.currentCount}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-xs">
        {streak.goal === null ? (
          <>
            <p className="font-display text-h2">{streak.totalVisits} visits</p>
            <p className="text-body-sm text-text-muted">
              Keep coming back — rewards for regulars are on the way.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-h2">{streak.goal.name}</p>
            <p className="text-body-sm text-text-muted">
              {streak.goal.remaining === 0
                ? 'Your next visit completes it.'
                : `${streak.goal.remaining} more visit${streak.goal.remaining === 1 ? '' : 's'} to go.`}
            </p>
            <Badge tone="accent">{streak.goal.rewardLabel}</Badge>
          </>
        )}
        <p className="text-caption text-text-muted">
          Best streak {streak.bestCount} · {streak.totalVisits} visits all time
        </p>
      </div>
    </Card>
  );
}

function ScratchCard({ card }: { card: ScratchCardDto }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const [revealing, setRevealing] = useState(false);

  const scratch = useMutation({
    mutationFn: () => api().rewards.scratch(card.id),
    onSuccess: (result) => {
      setRevealing(true);
      void queryClient.invalidateQueries({ queryKey: ['scratch-cards'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      if (result.reward !== null) toast.success(`You won ${result.reward.label}!`);
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const revealed = card.status === 'SCRATCHED' && card.reward !== null;

  return (
    <button
      type="button"
      disabled={card.status !== 'ISSUED' || scratch.isPending}
      onClick={() => scratch.mutate()}
      className={cn(
        'flex aspect-[3/4] w-full flex-col items-center justify-center gap-xs rounded-lg border p-sm text-center',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        revealed
          ? 'border-accent/40 bg-accent/10'
          : card.status === 'ISSUED'
            ? 'border-accent bg-gradient-to-br from-accent/20 to-accent/5'
            : 'border-border bg-surface2 opacity-60',
        revealing && !reduced && 'animate-scale-in',
      )}
    >
      {revealed ? (
        <>
          <span className="font-display text-h2 text-accent">{card.reward!.label}</span>
          <span className="text-caption text-text-muted">In your wallet</span>
        </>
      ) : card.status === 'ISSUED' ? (
        <>
          <span aria-hidden className="text-h1">
            🎁
          </span>
          <span className="text-body-sm font-medium">Tap to scratch</span>
          <span className="text-caption text-text-muted">{card.campaignName}</span>
        </>
      ) : (
        <span className="text-body-sm text-text-muted">Expired</span>
      )}
    </button>
  );
}
