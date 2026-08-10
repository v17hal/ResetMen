'use client';

import {
  Badge,
  Card,
  ErrorState,
  Skeleton,
  formatDuration,
  formatMoney,
  stagger,
  useReducedMotion,
} from '@reset/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * Home.
 *
 * One request — `/catalog/home` — rather than segments, then categories, then services.
 * Four round-trips on a cold open is the difference between the site feeling instant and
 * feeling like a website.
 */
export default function HomePage() {
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const reduced = useReducedMotion();

  const home = useQuery({
    queryKey: ['home', segmentId],
    queryFn: () => api().catalog.home(segmentId),
  });

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

  return (
    <div className="flex flex-col gap-lg p-base">
      <header className="flex flex-col gap-xs pt-sm">
        <h1 className="font-display text-display">Book your reset</h1>
        <p className="text-body text-text-muted">
          Pick a service, choose a time, and walk straight in.
        </p>
      </header>

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
                    onClick={() => setSegmentId(segment.id)}
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

          {home.data.categories.map((category) => {
            const services = home.data.services.filter(
              (service) => service.categoryId === category.id,
            );
            if (services.length === 0) return null;

            return (
              <section key={category.id} className="flex flex-col gap-sm">
                <div className="flex items-baseline justify-between gap-sm">
                  <h2 className="font-display text-h1">{category.name}</h2>
                  {category.fromPricePaise !== null && (
                    <span className="text-body-sm text-text-muted">
                      from {formatMoney(category.fromPricePaise)}
                    </span>
                  )}
                </div>

                {category.description !== null && (
                  <p className="text-body-sm text-text-muted">{category.description}</p>
                )}

                <ul className="flex flex-col gap-sm">
                  {services.map((service, index) => (
                    <li key={service.id} {...stagger(index, reduced)}>
                      <Link href={`/service/${service.slug}`} className="block">
                        <Card
                          elevated
                          className="flex items-center gap-base transition-transform duration-micro ease-standard active:scale-[0.99]"
                        >
                          {service.imageUrl !== null && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={service.imageUrl}
                              alt=""
                              className="h-16 w-16 shrink-0 rounded-md object-cover"
                              loading="lazy"
                            />
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-h2">{service.name}</p>
                            {service.description !== null && (
                              <p className="line-clamp-2 text-body-sm text-text-muted">
                                {service.description}
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-xs">
                            <span className="font-mono text-body">
                              {formatMoney(service.pricePaise)}
                            </span>
                            <Badge>{formatDuration(service.durationMinutes)}</Badge>
                          </div>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {home.data.categories.length === 0 && (
            <Card className="text-body text-text-muted">
              Nothing is bookable online yet. Please call the store.
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-lg" aria-busy>
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-sm">
          <Skeleton className="h-7 w-40" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
