import type { ReactNode } from 'react';

import { cn } from '../cn.js';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface2 text-text-muted',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  accent: 'bg-accent/12 text-accent',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-sm py-0.5 text-caption font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Booking status as a badge.
 *
 * The tone mapping lives here rather than in each screen so a booking never reads as green
 * on one page and grey on another. Colour is paired with the word, never used alone —
 * "cancelled" and "completed" must be distinguishable without seeing colour at all.
 */
const BOOKING_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  HELD: { tone: 'warning', label: 'Holding' },
  CONFIRMED: { tone: 'success', label: 'Confirmed' },
  CHECKED_IN: { tone: 'info', label: 'Checked in' },
  IN_PROGRESS: { tone: 'info', label: 'In progress' },
  COMPLETED: { tone: 'neutral', label: 'Completed' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  NO_SHOW: { tone: 'danger', label: 'No-show' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
};

export function BookingStatusBadge({ status }: { status: string }) {
  const mapped = BOOKING_TONES[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={mapped.tone}>{mapped.label}</Badge>;
}

const PAYMENT_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  CREATED: { tone: 'warning', label: 'Pending' },
  AUTHORIZED: { tone: 'info', label: 'Authorized' },
  CAPTURED: { tone: 'success', label: 'Paid' },
  FAILED: { tone: 'danger', label: 'Failed' },
  REFUNDED: { tone: 'neutral', label: 'Refunded' },
  PARTIALLY_REFUNDED: { tone: 'warning', label: 'Part refunded' },
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const mapped = PAYMENT_TONES[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={mapped.tone}>{mapped.label}</Badge>;
}
