import type { MetadataRoute } from 'next';

import { SITE_URL, getHome } from '@/lib/seo';

/**
 * The sitemap, built from the live catalogue rather than a hand-kept list.
 *
 * /sitemap.xml returned 404, so the only way Google could find a service page was by
 * following a link on a homepage that — until this change — contained no links, because
 * the catalogue was fetched after hydration and crawlers were served an empty shell. The
 * service pages were effectively undiscoverable.
 *
 * Generated from the catalogue so a service added in the admin panel appears here without
 * anyone remembering to add it. A hand-maintained sitemap is a list of what was true when
 * somebody last thought about it.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = await getHome();
  const now = new Date();

  const pages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${SITE_URL}/shop`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
  ];

  // The money pages: one per bookable service. Priority above the shop and below the
  // homepage, because a search for a named treatment should land on the treatment.
  for (const service of home?.services ?? []) {
    pages.push({
      url: `${SITE_URL}/service/${service.slug}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    });
  }

  return pages;
}
