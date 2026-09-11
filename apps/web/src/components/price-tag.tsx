import { cn, formatMoney } from '@reset/ui';

/** 49 against 149 is 67% off. Rounded, as the client's own menu does (550/699 → 79%). */
export function discountPercent(pricePaise: number, compareAtPricePaise: number): number {
  return Math.round(((compareAtPricePaise - pricePaise) / compareAtPricePaise) * 100);
}

/**
 * "₹49 ~~₹149~~ 67% OFF" — client request 11/09/2026.
 *
 * The API only sends a "was" price when it is above the real one, so there is no case here
 * for a zero or negative discount. Screen readers hear "was ₹149", not a struck-through
 * number read as if it were the price.
 */
export function PriceTag({
  pricePaise,
  compareAtPricePaise,
  priceClassName,
}: {
  pricePaise: number;
  compareAtPricePaise: number | null;
  priceClassName?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-sm gap-y-0.5">
      <span className={cn('font-display', priceClassName)}>{formatMoney(pricePaise)}</span>
      {compareAtPricePaise !== null && (
        <>
          <s className="text-body-sm text-text-muted">
            <span className="sr-only">was </span>
            {formatMoney(compareAtPricePaise)}
          </s>
          <span className="text-body-sm font-semibold text-primary">
            {discountPercent(pricePaise, compareAtPricePaise)}% OFF
          </span>
        </>
      )}
    </span>
  );
}

/** "BESTSELLER" — the amber reserved for things worth noticing. */
export function ServiceBadge({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-accent/12 px-xs py-0.5 text-caption font-semibold uppercase tracking-wide text-accent">
      {label}
    </span>
  );
}
