'use client';

import {
  ErrorState,
  Skeleton,
  formatDuration,
  formatMoney,
  stagger,
  useReducedMotion,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { CompleteProfileBanner } from '@/components/complete-profile-banner';
import { ServiceImage, lookFor } from '@/components/service-look';
import { errorMessage } from '@/lib/auth';
import { useOnline } from '@/lib/offline';
import { api } from '@/lib/client';

/**
 * Home.
 *
 * One request — `/catalog/home` — rather than segments, then categories, then services.
 * Four round-trips on a cold open is the difference between the site feeling instant and
 * feeling like a website.
 *
 * Laid out the way a delivery menu is, and the way the app now is: search, a strip of
 * categories, then rows that lead with the price and carry their own action. The previous
 * version put a title, a grey description and a price in three equal columns on every row,
 * which scanned as a spreadsheet — nothing pulled the eye to the thing being sold.
 */
export default function HomePage() {
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const reduced = useReducedMotion();
  const online = useOnline();

  const home = useQuery({
    queryKey: ['home', segmentId],
    queryFn: () => api().catalog.home(segmentId),
  });

  /**
   * Names first, descriptions only as a fallback.
   *
   * Searching both at once is surprising: "head" matched a full-body service because its
   * description reads "twenty minutes, head to toe", and the result looked like the filter
   * was broken. Names are what people type; a description match is a rescue for when
   * nothing is named that way, not a peer of it.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return () => true;

    const named = (home.data?.services ?? []).some((s) => s.name.toLowerCase().includes(q));

    return (name: string, description: string | null) =>
      named
        ? name.toLowerCase().includes(q)
        : name.toLowerCase().includes(q) || (description ?? '').toLowerCase().includes(q);
  }, [query, home.data]);

  if (home.isError) {
    return (
      <div className="p-base">
        <ErrorState
          title="Could not load the menu"
          description={errorMessage(home.error)}
          onRetry={() => void home.refetch()}
        />
      </div>
    );
  }

  // Categories with nothing bookable are dropped rather than shown empty — an inert
  // heading reads as something that failed to load.
  const live =
    home.data?.categories.filter((c) =>
      home.data.services.some((s) => s.categoryId === c.id),
    ) ?? [];

  const selected = live.some((c) => c.id === categoryId) ? categoryId : null;

  // A search spans the whole catalogue: someone typing "back" wants the treatment, not to
  // be told the category they happen to have selected does not contain it.
  const scoped =
    query !== '' || selected === null ? live : live.filter((c) => c.id === selected);

  const shown = scoped.filter((c) =>
    home.data?.services.some((s) => s.categoryId === c.id && matches(s.name, s.description)),
  );

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs pt-sm">
        <h1 className="font-display text-h1">Book your reset</h1>
        <p className="text-body-sm text-text-muted">
          Pick a service, choose a time, walk straight in.
        </p>
      </header>

      <label className="relative block">
        <span className="sr-only">Search for a service</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="pointer-events-none absolute left-base top-1/2 h-5 w-5 -translate-y-1/2 text-primary"
        >
          <circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="m16 16 4.4 4.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for a service"
          className="min-h-touch w-full rounded-md border border-border bg-surface py-sm pl-[46px] pr-base text-body text-text shadow-card placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>

      {/* Losing signal looked identical to everything working: React Query keeps the last
          good catalogue and reports success while the refetch fails behind it. The data is
          still readable and roughly right, so it stays — labelled. */}
      {!online && (
        <p className="rounded-md border border-warning/40 bg-warning/[0.08] px-base py-sm text-body-sm text-text">
          You are offline. Prices and times may have changed since this was saved.
        </p>
      )}

      <CompleteProfileBanner />

      {home.isPending ? (
        <HomeSkeleton />
      ) : (
        <>
          {/* Hides itself when only one segment is live, so adding Women later is a catalog
              entry rather than a release. */}
          {home.data.segments.length > 1 && (
            <div role="tablist" aria-label="Segment" className="flex gap-xs">
              {home.data.segments.map((segment) => {
                const active = (segmentId ?? home.data.activeSegmentId) === segment.id;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSegmentId(segment.id);
                      setCategoryId(null);
                    }}
                    className={
                      active
                        ? 'min-h-touch rounded-full bg-primary px-base text-body-sm font-medium text-primary-fg'
                        : 'min-h-touch rounded-full border border-border px-base text-body-sm text-text'
                    }
                  >
                    {segment.name}
                  </button>
                );
              })}
            </div>
          )}

          {live.length > 1 && (
            <ul className="-mx-base flex gap-md overflow-x-auto px-base pb-xs">
              {live.map((category) => {
                const active = selected === category.id;
                const look = lookFor(category.name);
                return (
                  <li key={category.id} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={active}
                      // Tapping the active category clears the filter — the same gesture
                      // that narrowed the list widens it again.
                      onClick={() => setCategoryId(active ? null : category.id)}
                      className="flex w-[88px] flex-col items-center gap-xs"
                    >
                      <span
                        className={
                          'flex h-[62px] w-[62px] items-center justify-center rounded-full text-white ring-offset-2 ring-offset-bg transition-shadow duration-micro ' +
                          (active ? 'ring-2 ring-primary' : '')
                        }
                        style={{
                          backgroundImage:
                            'linear-gradient(135deg, ' + look.from + ', ' + look.to + ')',
                        }}
                      >
                        {look.icon}
                      </span>
                      <span
                        className={
                          'text-center text-caption ' +
                          (active ? 'font-bold text-primary' : 'font-medium text-text-muted')
                        }
                      >
                        {category.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {shown.map((category) => {
            const services = home.data.services.filter(
              (s) => s.categoryId === category.id && matches(s.name, s.description),
            );

            return (
              <section key={category.id} className="flex flex-col gap-sm">
                <div className="flex items-baseline justify-between gap-sm pt-sm">
                  <h2 className="font-display text-h2">
                    {category.name}{' '}
                    <span className="text-text-muted">&middot; {services.length}</span>
                  </h2>
                  {category.fromPricePaise !== null && (
                    <span className="text-caption text-text-muted">
                      from {formatMoney(category.fromPricePaise)}
                    </span>
                  )}
                </div>

                <ul className="flex flex-col">
                  {services.map((service, index) => (
                    <li
                      key={service.id}
                      {...stagger(index, reduced)}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <Link
                        href={`/service/${service.slug}`}
                        className="flex items-start gap-base py-base transition-transform duration-micro ease-standard active:scale-[0.99]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-h2 text-[17px]">{service.name}</p>

                          <p className="mt-xs flex items-center gap-sm">
                            <span className="font-display text-[18px]">
                              {formatMoney(service.pricePaise)}
                            </span>
                            <span className="flex items-center gap-[3px] text-caption text-text-muted">
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="h-[13px] w-[13px]"
                              >
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="8.6"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                />
                                <path
                                  d="M12 7.6V12l2.8 1.8"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                              </svg>
                              {formatDuration(service.durationMinutes)}
                            </span>
                          </p>

                          {service.description !== null && (
                            <p className="mt-xs line-clamp-2 text-caption leading-relaxed text-text-muted">
                              {service.description}
                            </p>
                          )}
                        </div>

                        {/* The button hangs off the bottom of the tile, so the action sits
                            where the eye already is. */}
                        <div className="relative shrink-0 pb-[14px]">
                          <ServiceImage name={service.name} imageUrl={service.imageUrl} />
                          <span className="absolute bottom-0 left-1/2 flex h-8 w-[84px] -translate-x-1/2 items-center justify-center rounded-sm border-[1.4px] border-primary bg-surface text-caption font-extrabold tracking-wide text-primary shadow-card">
                            BOOK
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {shown.length === 0 && (
            <p className="rounded-lg border border-border bg-surface p-lg text-center text-body text-text-muted">
              {query === ''
                ? 'Nothing is bookable online yet. Please call the store.'
                : 'No match for that search. Try a shorter word, such as head, back or full body.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Shaped like the real thing, so the catalogue does not jump when it lands. */
function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-base" aria-busy>
      <div className="flex gap-md">
        {[0, 1, 2, 3].map((bubble) => (
          <div key={bubble} className="flex w-[88px] flex-col items-center gap-xs">
            <Skeleton className="h-[62px] w-[62px] rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="h-6 w-40" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-base py-base">
          <div className="flex-1 space-y-sm">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-52" />
          </div>
          <Skeleton className="h-28 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
