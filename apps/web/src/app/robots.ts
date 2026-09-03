import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/seo';

/**
 * There was no robots.txt at all — the URL returned 404.
 *
 * An absent robots.txt is not neutral. Crawlers treat it as "crawl everything", which is
 * how a booking funnel ends up indexed: /checkout and /confirmation/<id> are pages that
 * only make sense to one signed-in person, and a confirmation page in a search result is a
 * customer's appointment showing up in public.
 *
 * The signed-in surfaces are excluded, the catalogue is opened, and the sitemap is named so
 * a crawler finds the service pages without having to discover them through links.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Nothing here is useful to a stranger, and some of it is somebody's business.
          '/checkout',
          '/confirmation/',
          '/account',
          '/bookings',
          '/rewards',
          // A slot list is generated per service, per day. Indexing it produces thousands
          // of near-identical pages that go stale within the hour.
          '/slots',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
