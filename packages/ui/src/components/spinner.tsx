import { cn } from '../cn.js';

export interface SpinnerProps {
  className?: string;
  /** Announced to screen readers. Set to null inside a control that already says it. */
  label?: string | null;
}

/**
 * An indeterminate spinner.
 *
 * `currentColor` rather than a token, so it inherits from whatever it sits inside — the same
 * component works on a primary button and on a white card without a variant prop.
 */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      role={label === null ? 'presentation' : 'status'}
      aria-label={label ?? undefined}
      aria-hidden={label === null || undefined}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
