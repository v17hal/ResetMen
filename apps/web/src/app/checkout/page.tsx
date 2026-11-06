'use client';

import type { HoldResponse, QuoteResponse, WalletEntry } from '@reset/api-client';
import { isResetApiError } from '@reset/api-client';
import { TERMS } from '@reset/types';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Skeleton,
  cn,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatMoney,
  secondsUntil,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
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
  const queryClient = useQueryClient();
  const { user, hasToken } = useAuth();

  const serviceId = search.get('serviceId') ?? '';
  const startsAt = search.get('startsAt') ?? '';
  const addonOptionIds = useMemo(() => search.getAll('addon'), [search]);

  const [rewardId, setRewardId] = useState<string | null>(null);
  /**
   * A coupon code — client request 06/11/2026. Only ever set from the server's answer, so it
   * is the stored form ("RESET20"), not whatever was typed. One discount per booking: this
   * and `rewardId` are never both set.
   */
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The Terms checkbox — client requirement 11/09/2026. Unticked on every visit. */
  const [agreed, setAgreed] = useState(false);
  /**
   * Online or at the counter — client request 28/10/2026, their choice. The counter is
   * preselected: it is the way this shop has always worked and the path every regular
   * already knows. Only offered at all while the store has online payment switched on.
   */
  const [method, setMethod] = useState<'ONLINE' | 'COUNTER'>('COUNTER');

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
  /** Online payment is only offered while the store has a gateway switched on. */
  const onlineAvailable = store.data?.paymentsEnabled === true;
  const payingOnline = onlineAvailable && method === 'ONLINE';

  const quote = useQuery({
    queryKey: ['quote', serviceId, addonOptionIds, rewardId, couponCode],
    queryFn: () => api().bookings.quote({ serviceId, addonOptionIds, rewardId, couponCode }),
    enabled: serviceId !== '',
  });

  /**
   * A typed code is tried as a request of its own, not by putting it straight into the quote
   * above. A wrong code then costs nothing: the price stays where it was and the reason
   * appears under the box, instead of the whole checkout flashing to an error and back.
   */
  const applyCoupon = useMutation({
    mutationFn: (code: string) =>
      api().bookings.quote({ serviceId, addonOptionIds, rewardId: null, couponCode: code }),
    onSuccess: (priced) => {
      const code = priced.appliedCoupon?.code ?? null;
      // This is the quote the page is about to ask for, so it is not asked for twice.
      queryClient.setQueryData(['quote', serviceId, addonOptionIds, null, code], priced);
      setRewardId(null);
      setCouponCode(code);
      setError(null);
    },
    onError: (caught) => setCouponError(errorMessage(caught)),
  });

  /**
   * A code that was accepted can stop being acceptable: the basket fell below its minimum,
   * or its last use went to someone else. It is dropped and the reason shown under the box,
   * and the quote runs again without it. Left in place, the price card would sit on an
   * error with nothing to press but Retry, which fails the same way every time.
   */
  const couponRefused = couponCode !== null && quote.isError && isCouponError(quote.error);
  useEffect(() => {
    if (!couponRefused) return;
    setCouponError(errorMessage(quote.error));
    setCouponCode(null);
  }, [couponRefused, quote.error]);

  /** Priced against this exact basket, so each row knows what it is worth here. */
  const wallet = useQuery({
    queryKey: ['wallet', serviceId, addonOptionIds],
    queryFn: () => api().rewards.wallet({ serviceId, addonOptionIds }),
    enabled: hasToken && serviceId !== '',
  });

  const createHold = useMutation({
    mutationFn: () =>
      api().bookings.hold(
        // The version goes with the booking, so the record says which wording was agreed to.
        {
          serviceId,
          startsAt,
          addonOptionIds,
          rewardId,
          couponCode,
          termsVersion: TERMS.version,
          paymentMethod: onlineAvailable ? method : 'COUNTER',
        },
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
      // The code passed the quote and not the booking: its last use went while they were
      // deciding. Dropped, so the price on screen is the one the next tap books at.
      if (isCouponError(caught)) setCouponCode(null);
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

      // Paying at the counter: the booking came back already CONFIRMED and there is nothing
      // to charge. Asking for a payment order here is what produced "this booking is already
      // paid for" on a booking that had just been made successfully.
      if (booked.paymentRequired === false) return booked;

      // They chose online, the payment did not go through, and they switched to the counter.
      // The held booking is converted rather than a second one made beside it.
      if (method === 'COUNTER') {
        await api().bookings.payAtCounter(booked.bookingId);
        return booked;
      }

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
  const appliedCoupon = quote.data?.appliedCoupon ?? null;
  const postVisitCreditPaise =
    applied?.postVisitCreditPaise ?? appliedCoupon?.postVisitCreditPaise ?? 0;

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-h1">Confirm and pay</h1>
        {hold !== null && <HoldCountdown expiresAt={hold.holdExpiresAt} />}
      </header>

      {/* A refused code is about to be dropped and the quote asked for again without it;
          the error belongs under the code box, not in place of the price. */}
      {quote.isPending || store.isPending || couponRefused ? (
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
              <span>
                {appliedCoupon !== null
                  ? `${appliedCoupon.code} · ${appliedCoupon.label}`
                  : (applied?.label ?? 'Reward')}
              </span>
              <span className="font-mono">−{formatMoney(quote.data.discountPaise)}</span>
            </div>
          )}

          <div className="mt-xs flex items-baseline justify-between gap-sm border-t border-border pt-sm">
            <span className="font-display text-h2">Total</span>
            <span className="font-mono text-h1">{formatMoney(quote.data.payablePaise)}</span>
          </div>

          {/* Cashback discounts nothing now, so it is stated separately rather than
              appearing as a reward that did nothing. A cashback code reads the same. */}
          {postVisitCreditPaise > 0 && (
            <Badge tone="accent">
              {formatMoney(postVisitCreditPaise)} back after your visit
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
            // One discount per booking: a reward replaces a code, as a code replaces a reward.
            setCouponCode(null);
            setCouponError(null);
            setError(null);
          }}
        />
      )}

      {/* Offered signed out too. The server answers with "Sign in, then enter the code
          again.", which says more than a missing box would. */}
      <CouponCode
        applied={appliedCoupon}
        applying={applyCoupon.isPending}
        error={couponError}
        onApply={(code) => {
          setCouponError(null);
          applyCoupon.mutate(code);
        }}
        onRemove={() => {
          setCouponCode(null);
          setCouponError(null);
          setError(null);
        }}
      />

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
            Sign in to book
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
        <>
        {onlineAvailable && (
          <Card className="flex flex-col gap-sm">
            <span className="text-body-sm font-medium">How would you like to pay?</span>
            {(
              [
                {
                  value: 'ONLINE',
                  title: 'Pay online now',
                  detail: 'UPI, card or netbanking. Your entry QR is ready straight away.',
                },
                {
                  value: 'COUNTER',
                  title: 'Pay at the counter',
                  detail: 'Pay when you arrive. Your entry QR is issued once you have paid.',
                },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={
                  'flex cursor-pointer items-start gap-sm rounded-md border p-sm text-body-sm ' +
                  (method === option.value ? 'border-primary bg-primary/5' : 'border-border')
                }
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={() => {
                    setMethod(option.value);
                    setError(null);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{option.title}</span>
                  <span className="text-caption text-text-muted">{option.detail}</span>
                </span>
              </label>
            ))}
          </Card>
        )}
        <Card>
          <label className="flex cursor-pointer items-start gap-sm text-body-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
            />
            <span>
              {/* The client's sentence, with its own words made the link. Opens in a new
                  tab so reading the terms cannot cost anyone the slot on this page. */}
              {TERMS.agreement.split('Terms & Conditions')[0]}
              <Link
                href="/terms"
                target="_blank"
                rel="noopener"
                className="text-primary underline underline-offset-2"
              >
                Terms &amp; Conditions
              </Link>
              {TERMS.agreement.split('Terms & Conditions')[1]}
            </span>
          </label>
        </Card>
        <div className="sticky bottom-base z-20">
          <Button
            size="lg"
            fullWidth
            loading={createHold.isPending || pay.isPending}
            // Ready as soon as there is a price to show and the terms are ticked. It used
            // to wait for a hold that was made on mount, which is why it stayed dead after
            // signing in until the page was reloaded.
            disabled={quote.data === undefined || !agreed}
            onClick={() => pay.mutate()}
          >
            {/* "Pay" only when money is actually taken here. Paying at the counter, this
                button books and charges nothing — promising otherwise is how people end up
                paying twice. */}
            {!payingOnline
              ? 'Book'
              : quote.data === undefined
                ? 'Pay'
                : `Pay ${formatMoney(quote.data.payablePaise)}`}
          </Button>
          {/* A disabled button with no reason reads as a broken one — which is how the
              allocation-rule Save button got reported. Say what it is waiting for. */}
          {!agreed && quote.data !== undefined && (
            <p className="mt-xs text-center text-caption text-text-muted">
              Tick the box above to book.
            </p>
          )}
        </div>
        </>
      )}

      <p className="text-caption text-text-muted">
        {/* Said before booking, not after. Someone expecting to pay online should learn
            otherwise while they can still change their mind. */}
        {payingOnline ? 'Paid securely through Razorpay. ' : 'Pay at the counter. '}
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

/**
 * "Have a coupon code?" — client request 06/11/2026: codes the shop creates and hands out.
 *
 * Folded away until asked for. Most bookings have no code, and an open box at checkout sends
 * people off to search for one. What was typed survives a refusal, so a misspelling is
 * corrected rather than typed again.
 */
function CouponCode({
  applied,
  applying,
  error,
  onApply,
  onRemove,
}: {
  applied: QuoteResponse['appliedCoupon'];
  applying: boolean;
  error: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // Focused when they open it, and only then. The box also comes back on its own — a reward
  // chosen, a code refused — and a keyboard springing up unasked hides half a phone screen.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <section className="flex flex-col">
      {/* Always in the page, so the applied code is read out when it appears. */}
      <div aria-live="polite">
        {applied !== null && (
          <div className="flex min-h-touch items-center gap-base rounded-md border border-accent bg-accent/10 p-base">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold">{applied.code}</p>
              <p className="text-body-sm text-text-muted">
                {applied.label} ·{' '}
                <span className="font-mono">
                  {applied.discountPaise > 0
                    ? `−${formatMoney(applied.discountPaise)}`
                    : `${formatMoney(applied.postVisitCreditPaise)} back after your visit`}
                </span>
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setOpen(false);
                setDraft('');
                onRemove();
              }}
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      {applied === null &&
        (open || error !== null ? (
          <form
            className="flex items-start gap-sm"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim() !== '' && !applying) onApply(draft.trim());
            }}
          >
            {/* The server drops spaces and ignores case, so the box only has to look like a
                code. Upper case is display only: rewriting the value on every keystroke
                throws the cursor to the end and fights the phone keyboard's suggestions. */}
            <Input
              ref={input}
              aria-label="Coupon code"
              placeholder="Enter code"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              error={error}
              containerClassName="min-w-0 flex-1"
              className="uppercase placeholder:normal-case"
            />
            <Button
              type="submit"
              variant="secondary"
              className="shrink-0"
              loading={applying}
              disabled={draft.trim() === ''}
            >
              Apply
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-touch self-start rounded-md text-body-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Have a coupon code?
          </button>
        ))}
    </section>
  );
}

/** The code itself was refused, as opposed to the quote failing for some other reason. */
function isCouponError(error: unknown): boolean {
  return (
    isResetApiError(error) &&
    // Every refusal of a code is COUPON_INVALID, the unknown-code 404 included. The
    // one-discount rule is a validation error that names the code as its field.
    (error.code === 'COUPON_INVALID' || error.meta?.field === 'couponCode')
  );
}
