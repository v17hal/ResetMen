import type { Metadata } from 'next';

import { HomeClient } from './home-client';
import { SITE_URL, getHome, getStore, jsonLd, rupees, withLocality } from '@/lib/seo';

/**
 * The homepage, rendered on the server.
 *
 * It used to fetch the catalogue after hydration, so the HTML a crawler received was 16KB
 * of shell: no treatment names, no prices, no links to the service pages, and the word
 * "massage" appearing exactly twice — both times inside the meta description. There was
 * nothing on the page for Google to rank and no path from here to anything else.
 */

/**
 * Rendered per request, never at build time.
 *
 * The build container has no route to the API, so a build-time prerender produces a page
 * with no catalogue on it — which is what this change set was written to stop. The fetches
 * inside still cache for five minutes.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [home, store] = await Promise.all([getHome(), getStore()]);

  const cheapest = (home?.services ?? []).reduce<number | null>(
    (low, service) => (low === null || service.pricePaise < low ? service.pricePaise : low),
    null,
  );

  const title = withLocality('Head & Body Massage for Men', store);
  const from = cheapest === null ? '₹49' : rupees(cheapest);

  return {
    title: `${title} — walk-in from ${from}`,
    description:
      `Head, neck, shoulder and full-body dry massage from ${from}. Pick a treatment, ` +
      'choose your time, and walk straight in — no waiting, no membership.',
    alternates: { canonical: '/' },
  };
}

export default async function HomePage() {
  const [home, store] = await Promise.all([getHome(), getStore()]);

  /**
   * The treatment menu as a list Google can read.
   *
   * `ItemList` is what lets a catalogue be understood as a catalogue rather than as a wall
   * of text, and it names the price of each entry. It duplicates nothing the page does not
   * already show — describing something invisible is what earns a manual penalty.
   */
  const menu = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Treatments',
    itemListElement: (home?.services ?? []).map((service, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Service',
        name: service.name,
        url: `${SITE_URL}/service/${service.slug}`,
        ...(service.description === null ? {} : { description: service.description }),
        ...(store?.city == null ? {} : { areaServed: { '@type': 'City', name: store.city } }),
        offers: {
          '@type': 'Offer',
          price: (service.pricePaise / 100).toFixed(2),
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(menu) }}
      />
      <HomeClient initialHome={home} />
    </>
  );
}
