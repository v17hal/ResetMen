import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  SITE_URL,
  getServiceResult,
  getStore,
  jsonLd,
  rupees,
  withLocality,
} from '@/lib/seo';
import { ServiceDetail } from './service-detail';

/**
 * A service page, rendered on the server.
 *
 * This was a client component that fetched its own service after hydration, so every one of
 * these URLs served the same 13KB shell with the same site-wide title and no mention of the
 * treatment it was about. Five treatments, five identical pages as far as a crawler was
 * concerned — and identical pages get collapsed into one.
 *
 * These are the pages worth ranking. "Head massage in <city>" is a search with intent
 * behind it; "book your reset" is not a search at all.
 */

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Rendered per request, never at build time.
 *
 * These were prerendered with `generateStaticParams`, which was wrong for a reason that
 * only shows up in production: the build runs inside a Docker container that has no route
 * to the running API. Every fetch failed, and the pages were generated — and shipped — as
 * permanent 404s. Nothing in the build said so; it exited 0 with five broken pages.
 *
 * The individual `fetch` calls still cache for five minutes, so this costs one API round
 * trip per page per five minutes rather than one per visitor. Prerendering can come back
 * the day the build has a route to the API, and not before.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [result, store] = await Promise.all([getServiceResult(slug), getStore()]);

  // Fall back to the site defaults rather than a wrong title. A page that cannot describe
  // itself is a lost opportunity; a page titled "not found" that renders fine is a lie to
  // both the customer and the crawler.
  if (!('service' in result)) return {};
  const service = result.service;

  /**
   * The title carries the treatment, the town and the price.
   *
   * A price in the title is unusual advice and right here: these are impulse purchases at
   * ₹49 to ₹299, the number is the offer, and it is what makes somebody click one result
   * over another. The template appends "· RESET" so the brand is still there.
   */
  const title = `${withLocality(service.name + ' Massage', store)} — from ${rupees(service.pricePaise)}`;

  const description =
    service.description !== null && service.description.trim() !== ''
      ? `${service.description.trim()} ${rupees(service.pricePaise)}, ${service.durationMinutes} minutes. Book a time and walk straight in.`
      : `${service.name} — ${rupees(service.pricePaise)} for ${service.durationMinutes} minutes. ` +
        'Book a time and walk straight in.';

  const url = `${SITE_URL}/service/${service.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      ...(service.imageUrl === null ? {} : { images: [service.imageUrl] }),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ServicePage({ params }: Params) {
  const { slug } = await params;
  const [result, store] = await Promise.all([getServiceResult(slug), getStore()]);

  // A slug that is not a service is a 404. A slug we could not ask about is not — that
  // renders the page and lets the browser fetch it, exactly as it did before.
  if ('missing' in result) notFound();

  const service = 'service' in result ? result.service : null;

  if (service === null) {
    return <ServiceDetail slug={slug} initialData={null} />;
  }

  const url = `${SITE_URL}/service/${service.slug}`;

  /**
   * The treatment, as an offer.
   *
   * `Service` with an `Offer` is what can earn a price in the search result. The price is
   * the one the catalogue holds — it is re-quoted server-side at booking, so this is the
   * advertised "from", which is exactly what `lowPrice` means.
   */
  const serviceLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${url}#service`,
    name: service.name,
    ...(service.description === null ? {} : { description: service.description }),
    serviceType: 'Massage',
    provider: { '@id': `${SITE_URL}/#business` },
    ...(store?.city == null ? {} : { areaServed: { '@type': 'City', name: store.city } }),
    offers: {
      '@type': 'Offer',
      price: (service.pricePaise / 100).toFixed(2),
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      url,
    },
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Treatments', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: service.name, item: url },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([serviceLd, breadcrumbs]) }}
      />
      <ServiceDetail slug={slug} initialData={service} />
    </>
  );
}
