'use client';

import { Card } from '@reset/ui';
import Link from 'next/link';

import { useAuth } from '@/lib/auth';

/**
 * Nudges a signed-in customer to fill in what the counter needs.
 *
 * Google sign-in gives a name and an email and nothing else. Two things at the counter
 * need more: linking a walk-in to an existing customer, and ringing someone who is late.
 *
 * A banner rather than a required step at sign-up. A mandatory form between "I want to
 * book" and "I have booked" costs bookings, and the store would rather have a customer
 * with a missing phone number than no customer at all. It reappears until filled, which is
 * pressure enough without ever blocking anyone.
 */
export function CompleteProfileBanner() {
  const { user } = useAuth();

  if (user === null) return null;

  const missing = [
    (user.name ?? '').trim() === '' ? 'your name' : null,
    (user.phone ?? '').trim() === '' ? 'a mobile number' : null,
  ].filter((item): item is string => item !== null);

  if (missing.length === 0) return null;

  return (
    <Link href="/account" className="block">
      <Card className="flex items-center gap-base border-accent/40 bg-accent/[0.08]">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium">Finish your profile</p>
          <p className="text-caption text-text-muted">
            We still need {missing.join(' and ')} so the store can reach you about your
            booking.
          </p>
        </div>
        <span aria-hidden className="shrink-0 text-text-muted">
          →
        </span>
      </Card>
    </Link>
  );
}
