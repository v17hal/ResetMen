'use client';

import type { HoldResponse, WalletEntry } from '@reset/api-client';
import { isResetApiError } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Skeleton,
  cn,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatMoney,
  secondsUntil,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { PhoneRequired } from '@/components/phone-required';
import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';
import { PaymentCancelled, openRazorpayCheckout } from '@/lib/razorpay';

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="p-base" aria-busy><Skeleton className="h-72 w-full" /></div>}>
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const { user, hasToken } = useAuth();

  const serviceId = search.get('serviceId') ?? '';
  const startsAt = search.get('startsAt') ?? '';
  const addonOptionIds = useMemo(() => search.getAll('addon'), [search]);

  const [rewardId, setRewardId] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * One key for the whole checkout, generated when the screen mounts.
   *
   * A key regenerated per click would protect nothing: the value of an idempotency key is
   * that a *retry* carries the same one. A double-tap on a slow connection must not produce
   * two holds and two charges.
   */
  const holdKey = useRef(`hold-${crypto.randomUUID()}`);
  const orderKey = useRef(`order-${crypto.randomUUID()}`);

  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });

  const quote = useQuery({
    queryKey: ['quote', serviceId, addonOptionIds, rewardId],
    queryFn: () => api().bookings.quote({ serviceId, addonOptionIds, rewardId }),
    enabled: serviceId !== '',
  });

  /** Priced against this exact basket, so each row knows what it is worth here. */
  const wallet = useQuery({
    queryKey: ['wallet', serviceId, addonOptionIds],
    queryFn: () => api().rewards.wallet({ serviceId, addonOptionIds }),
    enabled: hasToken && serviceId !== '',
  });

  const createHold = useMutation({
    mutationFn: () =>
      api().bookings.hold(
        { serviceId, startsAt, addonOptionIds, rewardId },
        holdKey.current,
      ),
    onSuccess: (created) => {
      setHold(created);
      // The "sign in to book" refusal from before they signed in was still sitting above
      // the form, in red, after the thing it complained about had been dealt with.
      setError(null);
    },
    onError: (caught) => {
      setError(errorMessage(caught));
      if (isResetApiError(caught) && caught.isSlotGone) {
        // The slot went while they were deciding. Send them back with the basket intact.
        const query = new URLSearchParams({ serviceId });
        for (const id of addonOptionIds) query.append('addon', id);
        setTimeout(() => router.replace(`/slots?${query.toString()}`), 2500);
      }
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      // Made here, not on mount. `holdKey` is stable for the life of the screen, so a
      // double-tap replays the same booking rather than making a second one.
      const booked = hold ?? (await createHold.mutateAsync());
      setHold(booked);

      // Nothing to charge: the store takes money at the counter, so the hold came back
      // already CONFIRMED. Asking for a payment order here is what produced "this booking
      // is already paid for" on a booking that had just been made successfully.
      if (booked.paymentRequired === false) return booked;

      const order = await api().payments.createOrder(
        { bookingId: booked.bookingId },
        orderKey.current,
      );

      if (order.simulated) {
        // Local development: no gateway exists, so the server completes the charge itself.
        await api().payments.simulateSuccess(order.paymentId);
        return;
      }

      const result = await openRazorpayCheckout({
        order,
        name: store.data?.name ?? 'RESET',
        description: quote.data?.serviceName ?? 'Booking',
      });

      // Advisory only — the webhook is authoritative. A failure here is not a failed
      // booking, so it is swallowed rather than shown.
      await api()
        .payments.verify(result)
        .catch(() => undefined);

      return booked;
    },
    onSuccess: (booked) => {
      router.replace(`/confirmation/${booked?.bookingId ?? hold?.bookingId ?? ''}`);
    },
    onError: (caught) => {
      // Closing the sheet is a decision, not a failure. The hold survives; saying "payment
      // failed" to someone who simply changed their mind is both wrong and alarming.
      if (caught instanceof PaymentCancelled) return;

      const message = errorMessage(caught, 'The payment did not go through.');
      setError(message);
      toast.error(message);
    },
  });

  /**
   * Nothing is booked by arriving here.
   *
   * The slot used to be held the moment this screen opened, so that deciding about a reward
   * could not cost someone their time. That reasoning belonged to a checkout with a payment
   * step to wait for. With payment taken at the counter the hold is confirmed immediately,
   * which meant *opening* this page booked the slot: browsing to checkout and changing your
   * mind left a real booking on the counter's list for a customer who never pressed Book.
   *
   * The booking is now made by the button, which is where the customer thinks it happens.
   */

  if (serviceId === '' || startsAt === '') {
    return (
      <div className="p-base">
        <ErrorState title="Nothing to check out" description="Choose a service and a time first." />
      </div>
    );
  }

  const zone = store.data?.timezone;
  const applied = quote.data?.appliedReward ?? null;

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-h1">Confirm and pay</h1>
        {hold !== null && <HoldCountdown expiresAt={hold.holdExpiresAt} />}
      </header>

      {quote.isPending || store.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : quote.isError ? (
        <ErrorState description={errorMessage(quote.error)} onRetry={() => void quote.refetch()} />
      ) : (
        <Card className="flex flex-col gap-sm">
          <div className="flex items-baseline justify-between gap-sm">
            <span className="font-display text-h2">{quote.data.serviceName}</span>
            <span className="font-mono">{formatMoney(quote.data.basePricePaise)}</span>
          </div>

          <p className="text-body-sm text-text-muted">
            {formatDateTime(startsAt, zone)} · {formatDuration(quote.data.durationMinutes)}
          </p>

          {quote.data.addons.map((addon) => (
            <div key={addon.id} className="flex items-baseline justify-between gap-sm text-body-sm">
              <span className="text-text-muted">{addon.name}</span>
              <span className="font-mono">{formatMoney(addon.pricePaise)}</span>
            </div>
          ))}

          {quote.data.discountPaise > 0 && (
            <div className="flex items-baseline justify-between gap-sm text-body-sm text-primary">
              <span>{applied?.label ?? 'Reward'}</span>
              <span className="font-mono">−{formatMoney(quote.data.discountPaise)}</span>
            </div>
          )}

          <div className="mt-xs flex items-baseline justify-between gap-sm border-t border-border pt-sm">
            <span className="font-display text-h2">Total</span>
            <span className="font-mono text-h1">{formatMoney(quote.data.payablePaise)}</span>
          </div>

          {/* Cashback discounts nothing now, so it is stated separately rather than
              appearing as a reward that did nothing. */}
          {applied !== null && applied.postVisitCreditPaise > 0 && (
            <Badge tone="accent">
              {formatMoney(applied.postVisitCreditPaise)} back after your visit
            </Badge>
          )}
        </Card>
      )}

      {hasToken && wallet.data !== undefined && wallet.data.length > 0 && (
        <RewardPicker
          entries={wallet.data}
          selected={rewardId}
          onSelect={(id) => {
            setRewardId(id);
            setError(null);
          }}
        />
      )}

      {error !== null && (
        <Card className="border-danger/40 bg-danger/5">
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        </Card>
      )}

      {!hasToken || user === null ? (
        <Card className="flex flex-col gap-base">
          <h2 className="font-display text-h2">
            {store.data?.paymentsEnabled === false ? 'Sign in to book' : 'Sign in to pay'}
          </h2>
          <SignIn reason="Your slot is held while you do this." />
        </Card>
      ) : (user.phone ?? '').trim() === '' ? (
        // Asked here rather than by sending them to /account, which would lose the slot they
        // just picked. It saves the number and nothing else: holding the slot on save was
        // right when the hold was made as the page opened, and became a way to book without
        // pressing Book once the booking moved to the button.
        <PhoneRequired />
      ) : (
        <div className="sticky bottom-base z-20">
          <Button
            size="lg"
            fullWidth
            loading={createHold.isPending || pay.isPending}
            // Ready as soon as there is a price to show. It used to wait for a hold that
            // was made on mount, which is why it stayed dead after signing in until the
            // page was reloaded.
            disabled={quote.data === undefined}
            onClick={() => pay.mutate()}
          >
            {/* "Pay" is a promise the screen cannot keep while payment happens at the
                counter — the button confirms a booking and takes no money. */}
            {/* Payments are off, so this button books and takes no money. */}
            {store.data?.paymentsEnabled === false
              ? 'Book'
              : quote.data === undefined
                ? 'Pay'
                : `Pay ${formatMoney(quote.data.payablePaise)}`}
          </Button>
        </div>
      )}

      <p className="text-caption text-text-muted">
        {/* Said before booking, not after. Someone expecting to pay online should learn
            otherwise while they can still change their mind. */}
        {store.data?.paymentsEnabled === false && 'Pay at the counter. '}
        Free cancellation up to {Math.round((store.data?.cancellationWindowMinutes ?? 120) / 60)}{' '}
        hours before your slot.
      </p>
    </div>
  );
}

/**
 * The hold countdown.
 *
 * Ticks locally against the server's expiry instant rather than counting down from a
 * duration, so a backgrounded tab does not come back showing time that has already gone.
 */
function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt));

  useEffect(() => {
    setRemaining(secondsUntil(expiresAt));
    const timer = setInterval(() => setRemaining(secondsUntil(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (remaining <= 0) {
    return (
      <p role="alert" className="text-body-sm text-danger">
        Your hold has expired. Choose a time again.
      </p>
    );
  }

  return (
    <p
      className={cn(
        'text-body-sm',
        remaining < 120 ? 'text-danger' : 'text-text-muted',
      )}
      // Announced once a minute rather than every second, which would be unusable.
      aria-live={remaining % 60 === 0 ? 'polite' : 'off'}
    >
      Slot held for {formatCountdown(remaining)}
    </p>
  );
}

function RewardPicker({
  entries,
  selected,
  onSelect,
}: {
  entries: WalletEntry[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <section className="flex flex-col gap-sm">
      <h2 className="font-display text-h2">Your rewards</h2>

      <ul className="flex flex-col gap-sm">
        {entries.map((entry) => {
          const active = selected === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                disabled={!entry.applicable}
                onClick={() => onSelect(active ? null : entry.id)}
                className={cn(
                  'flex min-h-touch w-full items-center gap-base rounded-md border p-base text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  active ? 'border-accent bg-accent/10' : 'border-border bg-surface',
                  !entry.applicable && 'opacity-50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{entry.label}</p>
                  {/* The server decides applicability; the app just prints its reason. */}
                  {entry.blockedReason !== null && (
                    <p className="text-caption text-text-muted">{entry.blockedReason}</p>
                  )}
                </div>

                <span className="shrink-0 font-mono text-body-sm">
                  {entry.discountPaise > 0
                    ? `−${formatMoney(entry.discountPaise)}`
                    : entry.postVisitCreditPaise > 0
                      ? `${formatMoney(entry.postVisitCreditPaise)} back`
                      : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
