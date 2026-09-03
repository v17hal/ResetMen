import type { HomeDto, ServiceDetail, StoreDto } from '@reset/api-client';

/**
 * Server-side catalogue reads, and the facts every page's metadata is built from.
 *
 * The browser client cannot be used here: it is a `'use client'` module holding a token
 * store on `localStorage`, and these run during the render on the server. These endpoints
 * are public and need no token, so a plain `fetch` is both sufficient and correct.
 *
 * Why any of this exists: every page was a client component fetching its own data after
 * hydration, so the HTML a crawler received was a 16KB shell. No service name, no price, no
 * city — the homepage contained the word "massage" exactly twice, both times in the meta
 * description. Google was being shown an empty building with a sign outside.
 *
 * Everything here is cached for five minutes. A catalogue changes a few times a year and
 * this runs on every crawl of every page.
 */

const REVALIDATE_SECONDS = 300;

/** The canonical origin. Every absolute URL in metadata is built from this one value. */
export const SITE_URL = 'https://resetmen.in';

function apiBase(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url === undefined || url === '') {
    throw new Error('NEXT_PUBLIC_API_URL is not set.');
  }
  return url;
}

/**
 * A read that never takes the page down with it.
 *
 * Metadata generation runs inside the render. An API blip while Googlebot is crawling
 * should cost the page its rich title, not return a 500 — a crawler that meets an error
 * page drops the URL, which is a far worse outcome than a generic description.
 */
async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function getStore(): Promise<StoreDto | null> {
  return read<StoreDto>('/catalog/store');
}

export function getHome(): Promise<HomeDto | null> {
  return read<HomeDto>('/catalog/home');
}

export function getService(slug: string): Promise<ServiceDetail | null> {
  return read<ServiceDetail>(`/catalog/services/${encodeURIComponent(slug)}`);
}

/**
 * The same read, but able to tell "no such service" from "could not ask".
 *
 * These are not the same thing and treating them as one took the five service pages down.
 * The page called `notFound()` whenever the fetch returned nothing, and the fetch returns
 * nothing both when the API says 404 and when it cannot be reached at all. During the
 * Docker build it could not be reached — the build container has no route to the running
 * API — so every service page was generated as a permanent 404 and shipped that way.
 *
 * A missing service is a 404. A failed request is a reason to render the page anyway and
 * let the browser fetch it, which is what the page did before any of this.
 */
export async function getServiceResult(
  slug: string,
): Promise<{ service: ServiceDetail } | { missing: true } | { unavailable: true }> {
  try {
    const response = await fetch(
      `${apiBase()}/catalog/services/${encodeURIComponent(slug)}`,
      { next: { revalidate: REVALIDATE_SECONDS }, headers: { accept: 'application/json' } },
    );

    if (response.status === 404) return { missing: true };
    if (!response.ok) return { unavailable: true };

    return { service: (await response.json()) as ServiceDetail };
  } catch {
    return { unavailable: true };
  }
}

/**
 * The town the shop is in, for titles and descriptions.
 *
 * Read from the store record rather than hard-coded, and omitted entirely when it is not
 * set. A wrong town in a title is worse than no town: "massage in Ahmedabad" on a shop in
 * Indore earns clicks from people who cannot visit, and teaches Google the wrong place.
 */
export function locality(store: StoreDto | null): string | null {
  const city = store?.city?.trim();
  return city === undefined || city === '' ? null : city;
}

/** "Head Massage in Indore" — or just "Head Massage" until the city is known to be right. */
export function withLocality(subject: string, store: StoreDto | null): string {
  const city = locality(store);
  return city === null ? subject : `${subject} in ${city}`;
}

export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

/**
 * Opening hours in the format schema.org expects: "Mo-Su 09:00-21:00", one entry per day.
 *
 * Days the shop is shut are left out rather than sent as a zero-length window — an
 * `opens` equal to `closes` reads to Google as "open 24 hours" on some parsers.
 */
export function openingHoursSpecification(
  store: StoreDto | null,
): Array<Record<string, unknown>> {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (store?.hours ?? [])
    .filter((hour) => !hour.isClosed)
    .map((hour) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${days[hour.dayOfWeek] ?? 'Monday'}`,
      opens: hour.opensAt,
      closes: hour.closesAt,
    }));
}

/**
 * Whether we know enough about the premises to claim to be one.
 *
 * `LocalBusiness` is the schema that puts a shop on the map, and it is also the schema
 * Google checks hardest against its own record of the place. Emitting it with no street
 * address, no phone and a city inherited from seed data would publish a contradiction:
 * Google compares structured data against the Business Profile, and a mismatch costs
 * ranking rather than earning it. So it is withheld until the record is real, and the site
 * describes itself as an Organization in the meantime — true, useful, and not a claim about
 * a location.
 */
export function hasRealPremises(store: StoreDto | null): boolean {
  return (
    store !== null &&
    store.address !== null &&
    store.address.trim() !== '' &&
    store.phone !== null &&
    store.phone.trim() !== ''
  );
}

/** Serialised for a `<script type="application/ld+json">`, with `<` escaped. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
