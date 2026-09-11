'use client';

import type { HomeBanner } from '@reset/api-client';
import { cn, useReducedMotion } from '@reset/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const INTERVAL_MS = 5_000;

/**
 * The promotion strip across the top of the home page — client request 11/09/2026, "like
 * the Yes Madam app".
 *
 * Native scroll-snap rather than a carousel library: it swipes the way every phone
 * expects, works with a trackpad, and costs no JavaScript to render. The script only moves
 * it on a timer and keeps the dots in step.
 *
 * Stops advancing while someone is touching, hovering or tabbing through it — a slide that
 * moves under a finger is the most common complaint about these — and never advances for
 * anyone who has asked their device for less motion.
 */
export function HomeBanners({ banners }: { banners: HomeBanner[] }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // A picture that fails to load is dropped, not shown as a broken frame.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  const shown = banners.filter((banner) => !failed.has(banner.id));

  useEffect(() => {
    const element = track.current;
    if (element === null) return;
    const onScroll = () => {
      if (element.clientWidth > 0) setIndex(Math.round(element.scrollLeft / element.clientWidth));
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [shown.length]);

  useEffect(() => {
    if (reduced || paused || shown.length < 2) return;
    const timer = setInterval(() => {
      const element = track.current;
      if (element === null || element.clientWidth === 0) return;
      const next = (Math.round(element.scrollLeft / element.clientWidth) + 1) % shown.length;
      element.scrollTo({ left: next * element.clientWidth, behavior: 'smooth' });
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reduced, paused, shown.length]);

  if (shown.length === 0) return null;

  const goTo = (i: number) => {
    const element = track.current;
    if (element === null) return;
    element.scrollTo({ left: i * element.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Offers"
      className="flex flex-col gap-xs"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div
        ref={track}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-lg shadow-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shown.map((banner, i) => {
          const image = (
            // A plain <img>: these come from the media store, already resized on upload.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={banner.imageUrl}
              alt={banner.altText}
              // The first one is the largest thing on the page; the rest can wait.
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => setFailed((current) => new Set(current).add(banner.id))}
              className="aspect-[16/10] w-full bg-surface2 object-cover"
            />
          );

          return (
            <div
              key={banner.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${shown.length}`}
              className="w-full shrink-0 snap-start"
            >
              {banner.serviceSlug === null ? (
                image
              ) : (
                <Link
                  href={`/service/${banner.serviceSlug}`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  {image}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {shown.length > 1 && (
        <div className="flex justify-center">
          {shown.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              aria-label={`Show offer ${i + 1} of ${shown.length}`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className="flex min-h-touch w-7 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all duration-micro',
                  i === index ? 'w-4 bg-primary' : 'w-1.5 bg-border',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
