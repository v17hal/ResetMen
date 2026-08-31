'use client';

import type { AddonGroupDto } from '@reset/api-client';
import {
  Button,
  ErrorState,
  Skeleton,
  formatDuration,
  formatMoney,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { ServiceImage } from '@/components/service-look';
import { errorMessage } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * Service detail and add-on selection.
 *
 * The running total shown here is a local sum of catalog prices, purely so the number moves
 * as options are ticked. It is never what gets charged — the server re-prices the whole
 * basket at `/bookings/quote` and again at hold, and that figure is the one on the
 * checkout screen.
 */
export default function ServicePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const service = useQuery({
    queryKey: ['service', params.slug],
    queryFn: () => api().catalog.service(params.slug),
  });

  const totals = useMemo(() => {
    if (service.data === undefined) return { price: 0, minutes: 0 };

    const options = service.data.addonGroups
      .flatMap((group) => group.options)
      .filter((option) => selected.has(option.id));

    return {
      price: service.data.pricePaise + options.reduce((sum, o) => sum + o.priceDeltaPaise, 0),
      minutes:
        service.data.durationMinutes +
        options.reduce((sum, o) => sum + o.durationDeltaMinutes, 0),
    };
  }, [service.data, selected]);

  if (service.isError) {
    return (
      <div className="p-base">
        <ErrorState
          title="Could not load this service"
          description={errorMessage(service.error)}
          onRetry={() => void service.refetch()}
        />
      </div>
    );
  }

  if (service.isPending) {
    return (
      <div className="flex flex-col gap-base p-base" aria-busy>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const invalidGroups = service.data.addonGroups.filter((group) => {
    const chosen = group.options.filter((option) => selected.has(option.id)).length;
    return chosen < group.minSelect || chosen > group.maxSelect;
  });

  function goToSlots(): void {
    const query = new URLSearchParams({ serviceId: service.data!.id });
    for (const id of selected) query.append('addon', id);
    router.push(`/slots?${query.toString()}`);
  }

  return (
    <div className="flex flex-col">
      {/* Always shown. Without a photo the icon fills the same frame, so the page opens on
          the thing being sold rather than on bare text. */}
      <ServiceImage
        name={service.data.name}
        imageUrl={service.data.imageUrl}
        className="h-[200px] w-full"
        rounded="sm:rounded-b-lg"
      />

      <div className="flex flex-col gap-lg p-base">
        <header className="flex flex-col gap-sm">
          <Link href="/" className="text-body-sm text-primary underline underline-offset-4">
            ← All services
          </Link>
          <h1 className="font-display text-h1">{service.data.name}</h1>
          <div className="flex flex-wrap items-center gap-md">
            <span className="font-display text-[26px]">
              {formatMoney(service.data.pricePaise)}
            </span>
            <span className="text-body-sm text-text-muted">
              {formatDuration(service.data.durationMinutes)}
            </span>
          </div>
          {service.data.description !== null && (
            <p className="text-body text-text-muted">{service.data.description}</p>
          )}
        </header>

        {service.data.addonGroups.map((group) => (
          <AddonGroup
            key={group.id}
            group={group}
            selected={selected}
            onChange={setSelected}
          />
        ))}
      </div>

      {/* Sticky summary. Sits above the tab bar rather than under it. */}
      <div className="sticky bottom-[calc(var(--reset-layout-bottom-nav-height)+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface p-base sm:bottom-0">
        <div className="mx-auto flex max-w-content items-center gap-base">
          <div className="flex flex-col">
            <span className="font-mono text-h2">{formatMoney(totals.price)}</span>
            <span className="text-caption text-text-muted">
              {formatDuration(totals.minutes)} total
            </span>
          </div>

          <Button
            size="lg"
            className="flex-1"
            disabled={invalidGroups.length > 0}
            onClick={goToSlots}
          >
            {invalidGroups.length > 0
              ? `Choose ${invalidGroups[0]!.name}`
              : 'Choose a time'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddonGroup({
  group,
  selected,
  onChange,
}: {
  group: AddonGroupDto;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const single = group.maxSelect === 1;
  const chosen = group.options.filter((option) => selected.has(option.id)).length;

  function toggle(id: string): void {
    const next = new Set(selected);

    if (single) {
      // A single-select group behaves like a radio: picking one clears the rest of the
      // group rather than silently exceeding maxSelect.
      for (const option of group.options) next.delete(option.id);
      if (!selected.has(id)) next.add(id);
    } else if (next.has(id)) {
      next.delete(id);
    } else if (chosen < group.maxSelect) {
      next.add(id);
    } else {
      return;
    }

    onChange(next);
  }

  return (
    <fieldset className="flex flex-col gap-sm">
      <legend className="flex w-full items-baseline justify-between gap-sm">
        <span className="font-display text-h2">{group.name}</span>
        <span className="text-caption text-text-muted">
          {group.minSelect > 0
            ? `Choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}–${group.maxSelect}`}`
            : single
              ? 'Optional'
              : `Up to ${group.maxSelect}`}
        </span>
      </legend>

      <ul className="flex flex-col gap-sm">
        {group.options.map((option) => {
          const isSelected = selected.has(option.id);
          const atLimit = !single && !isSelected && chosen >= group.maxSelect;

          return (
            <li key={option.id}>
              <button
                type="button"
                role={single ? 'radio' : 'checkbox'}
                aria-checked={isSelected}
                disabled={atLimit}
                onClick={() => toggle(option.id)}
                className={[
                  'flex min-h-touch w-full items-center gap-base rounded-md border p-base text-left',
                  'transition-colors duration-micro ease-standard',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface hover:bg-surface2',
                  atLimit ? 'opacity-50' : '',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'grid h-5 w-5 shrink-0 place-items-center border',
                    single ? 'rounded-full' : 'rounded-sm',
                    isSelected ? 'border-primary bg-primary' : 'border-border',
                  ].join(' ')}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.5L5 9l4.5-5.5"
                        stroke="var(--reset-color-primary-fg)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">{option.name}</span>
                  {option.durationDeltaMinutes > 0 && (
                    <span className="block text-caption text-text-muted">
                      +{option.durationDeltaMinutes} min
                    </span>
                  )}
                </span>

                <span className="shrink-0 font-mono text-body-sm">
                  {option.priceDeltaPaise === 0
                    ? 'Free'
                    : `+${formatMoney(option.priceDeltaPaise)}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
