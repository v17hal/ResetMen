import type { ReactNode } from 'react';

import { cn } from '../cn.js';
import { Button } from './button.js';
import { Spinner } from './spinner.js';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Nothing here — and that is not an error.
 *
 * Always says what to do next. "No bookings yet" alone leaves someone staring at a blank
 * panel wondering whether the page failed to load.
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-sm rounded-lg border border-dashed border-border px-lg py-3xl text-center',
        className,
      )}
    >
      {icon != null && <div className="text-text-muted">{icon}</div>}
      <p className="font-display text-h2 text-text">{title}</p>
      {description != null && (
        <p className="max-w-sm text-body-sm text-text-muted">{description}</p>
      )}
      {action != null && (
        <Button variant="secondary" size="sm" onClick={action.onClick} className="mt-sm">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

/**
 * Something failed.
 *
 * Retry is offered only when a caller passes `onRetry`, because most API errors are not
 * retryable — a button that fails identically every time teaches people to distrust it.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-sm rounded-lg border border-danger/30 bg-danger/5 px-lg py-2xl text-center',
        className,
      )}
    >
      <p className="font-display text-h2 text-text">{title}</p>
      {description != null && (
        <p className="max-w-sm text-body-sm text-text-muted">{description}</p>
      )}
      {onRetry != null && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-sm">
          Try again
        </Button>
      )}
    </div>
  );
}

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = 'Loading', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-sm py-2xl', className)}>
      <Spinner className="h-6 w-6 text-primary" label={null} />
      {/* Polite rather than assertive: a loading message must not interrupt what is being read. */}
      <p aria-live="polite" className="text-body-sm text-text-muted">
        {label}
      </p>
    </div>
  );
}

export interface SkeletonProps {
  className?: string;
}

/**
 * A loading placeholder shaped like the content that will replace it.
 *
 * `aria-hidden` throughout: a screen reader announcing six grey rectangles is worse than
 * silence, and the region they sit in should carry the `aria-busy`.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-surface2', className)}
    />
  );
}

/** A stack of skeleton rows sized like list items. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-sm', className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
