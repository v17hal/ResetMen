import { formatPhone } from '@reset/ui';

import { getStore, locality, openingHoursSpecification } from '@/lib/seo';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Name, address, phone and hours, in the page itself.
 *
 * Structured data tells Google what the business is; this is the part a person reads, and
 * the two have to agree. Search engines cross-check the markup against the visible text,
 * and NAP that appears only in a `<script>` tag is the weakest form of it.
 *
 * It is also the plainest conversion win on the site. A customer deciding whether to come
 * in wants three facts — where, when, and a number to ring — and none of them were anywhere
 * on the site. The phone is a `tel:` link because most of this traffic is a phone.
 *
 * Rendered on the server, so it is in the HTML rather than arriving after hydration.
 */
export async function SiteFooter() {
  const store = await getStore();
  if (store === null) return null;

  const city = locality(store);
  const hours = openingHoursSpecification(store);
  const closedDays = (store.hours ?? []).filter((hour) => hour.isClosed);

  // Consecutive days on identical hours read as "Mon–Sat", not as six lines.
  const openLine =
    hours.length === 0
      ? null
      : `${hours[0]!.opens as string} – ${hours[0]!.closes as string}`;

  return (
    <footer className="mt-2xl border-t border-border bg-surface px-base py-lg text-body-sm">
      <div className="mx-auto flex max-w-3xl flex-col gap-base">
        <div>
          {/* Not an h1 — the page already has one. */}
          <p className="font-display text-h3">RESET{city === null ? '' : ` ${city}`}</p>
          <p className="text-text-muted">
            Quick dry massage and wellness for men — head, neck, shoulder and full body.
            Ten to thirty minutes, walk straight in.
          </p>
        </div>

        <div className="flex flex-col gap-sm sm:flex-row sm:gap-2xl">
          {store.address !== null && store.address.trim() !== '' && (
            <div className="flex flex-col">
              <span className="text-caption uppercase tracking-wide text-text-muted">Where</span>
              {/* Marked up so the address is machine-readable as well as legible. */}
              <address className="not-italic">
                <span>{store.address}</span>
                {city !== null && (
                  <>
                    <br />
                    <span>{city}</span>
                  </>
                )}
              </address>
            </div>
          )}

          {store.phone !== null && store.phone.trim() !== '' && (
            <div className="flex flex-col">
              <span className="text-caption uppercase tracking-wide text-text-muted">Call</span>
              {/* Grouped for reading aloud and dialling: +91 94044 91801. The href keeps
                  the unspaced E.164 number, which is what a dialler wants. */}
              <a href={`tel:${store.phone}`} className="underline underline-offset-2">
                {formatPhone(store.phone)}
              </a>
            </div>
          )}

          {openLine !== null && (
            <div className="flex flex-col">
              <span className="text-caption uppercase tracking-wide text-text-muted">Open</span>
              <span>{openLine}</span>
              {closedDays.length > 0 && (
                <span className="text-text-muted">
                  {/* "Closed on Mondays" — a standing weekly closure, not one shut Monday. */}
                  Closed on{' '}
                  {closedDays.map((day) => `${DAY_NAMES[day.dayOfWeek]}s`).join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
