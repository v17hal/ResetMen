import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  SITE_URL,
  getHome,
  getService,
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

/** Rebuilt every ten minutes, so a price change in the admin panel reaches search results. */
export const revalidate = 600;

/**
 * Build the five treatment pages ahead of time.
 *
 * They are the pages worth ranking, so they should answer instantly rather than waiting on
 * an API round trip — time to first byte is a ranking input and, more to the point, the
 * thing between a customer and a price.
 *
 * `dynamicParams` stays at its default, so a service added in the admin panel still renders
 * on demand instead of 404ing until the next deploy.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const home = await getHome();
  return (home?.services ?? []).map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [service, store] = await Promise.all([getService(slug), getStore()]);

  if (service === null) {
    return { title: 'Service not found' };
  }

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
  const [service, store] = await Promise.all([getService(slug), getStore()]);

  // A slug that is not a service is a 404, not an empty page that returns 200. A soft 404
  // gets indexed and then reported as a crawl error.
  if (service === null) notFound();

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
