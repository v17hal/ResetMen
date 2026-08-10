import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../cn.js';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts the card. Reserve it for something genuinely floating above the page. */
  elevated?: boolean;
  padded?: boolean;
}

/**
 * The soft elevated card from the Best-Flutter-UI-Templates reference: 16px radius, one wide
 * low-opacity shadow. Depth comes from surface tone; shadows are never stacked.
 */
export function Card({ elevated = false, padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface',
        elevated ? 'shadow-card' : '',
        padded ? 'p-base' : '',
        className,
      )}
      {...props}
    />
  );
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Amber is rewards-only; `accent` here means the tile is about something earned. */
  tone?: 'default' | 'accent' | 'danger';
  className?: string;
}

/** The dashboard's headline number. */
export function StatTile({ label, value, hint, tone = 'default', className }: StatTileProps) {
  return (
    <Card className={cn('flex flex-col gap-xs', className)}>
      <span className="text-caption uppercase tracking-wide text-text-muted">{label}</span>
      <span
        className={cn(
          'font-display text-h1',
          tone === 'accent' && 'text-accent',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </span>
      {hint != null && <span className="text-caption text-text-muted">{hint}</span>}
    </Card>
  );
}
