import {
  SITE_URL,
  getStore,
  hasRealPremises,
  jsonLd,
  openingHoursSpecification,
} from '@/lib/seo';

/**
 * Who this site is, in the form Google reads.
 *
 * There was no structured data anywhere on the site, so nothing told Google that RESET is a
 * business, what it sells, when it is open, or that a search box exists.
 *
 * The important judgement here is which type to claim. `LocalBusiness` is the schema that
 * puts a shop on the map and it is also the one Google checks hardest, against its own
 * record of the place from the Business Profile. The live store record has no street
 * address, no phone number, and a city left over from seed data — publishing that as
 * `LocalBusiness` would assert a location Google can contradict, and a contradiction costs
 * ranking rather than earning it.
 *
 * So the site describes itself as an `Organization` until the record is real, and upgrades
 * itself the moment an address and phone exist. Nothing here has to be edited when that
 * happens.
 */
export async function SiteJsonLd() {
  const store = await getStore();
  const premises = hasRealPremises(store);

  const business: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': premises ? ['HealthAndBeautyBusiness', 'DaySpa'] : 'Organization',
    '@id': `${SITE_URL}/#business`,
    name: 'RESET',
    url: SITE_URL,
    description:
      'Head, neck, shoulder and full-body dry massage, wellness and grooming for men. ' +
      'Book a time and walk straight in.',
    ...(premises
      ? {
          telephone: store!.phone,
          address: {
            '@type': 'PostalAddress',
            streetAddress: store!.address,
            addressLocality: store!.city,
            addressCountry: 'IN',
          },
          ...(store!.lat !== null && store!.lng !== null
            ? {
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: store!.lat,
                  longitude: store!.lng,
                },
              }
            : {}),
          openingHoursSpecification: openingHoursSpecification(store),
          currenciesAccepted: 'INR',
          // No gateway; the counter takes the money.
          paymentAccepted: 'Cash, UPI, Card',
          priceRange: '₹₹',
        }
      : {}),
  };

  /**
   * The site itself, so a brand search can show a search box under the result.
   *
   * `SearchAction` is only honest because the homepage has a real search field that
   * filters the catalogue. Declaring one that does not exist is a way to lose the feature
   * permanently.
   */
  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'RESET',
    publisher: { '@id': `${SITE_URL}/#business` },
    inLanguage: 'en-IN',
  };

  return (
    <script
      type="application/ld+json"
      // The content is built here from typed values, not from anything a user can write.
      dangerouslySetInnerHTML={{ __html: jsonLd([business, website]) }}
    />
  );
}
