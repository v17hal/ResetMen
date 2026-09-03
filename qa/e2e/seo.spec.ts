import { expect, test } from '@playwright/test';

/**
 * What a crawler is served, checked without running any JavaScript.
 *
 * `request.get` rather than `page.goto`: the whole point is the HTML as it arrives. Every
 * one of these pages rendered correctly in a browser while being useless to a search engine
 * and, for a while, being a 404 — a fault a screenshot cannot show and a browser test would
 * have hidden, because the client-side fetch repairs the page after hydration.
 *
 * These are the treatments as of writing. A new one does not need a test here; a broken one
 * needs to fail loudly.
 */
const SERVICES = [
  'head',
  'head-neck-shoulder',
  'head-neck-shoulder-back',
  'full-body-basic',
  'full-body-premium',
] as const;

const SITE = process.env.WEB_URL ?? 'https://resetmen.in';

function titleOf(html: string): string {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? '';
}

test.describe('What a crawler receives', () => {
  test('TC-110 the homepage serves its catalogue in the HTML', async ({ request }) => {
    const response = await request.get(SITE);
    expect(response.status()).toBe(200);

    const html = await response.text();

    // The failure this guards: a 16KB shell with the treatments fetched after hydration.
    expect(html, 'the homepage HTML should name a treatment').toContain('Head');
    expect(html, 'the homepage HTML should carry a price').toMatch(/₹\s?\d/);
    expect(titleOf(html).toLowerCase(), 'the title should say what is sold').toContain('massage');
  });

  for (const slug of SERVICES) {
    test(`TC-111-${slug} /service/${slug} is served, and describes itself`, async ({ request }) => {
      const response = await request.get(`${SITE}/service/${slug}`);

      // These were 404 in production for a while: the server read the catalogue from a URL
      // missing its /api/v1 prefix, got 404 for every service, and faithfully turned that
      // into a 404 page.
      expect(response.status(), `${slug} should be served, not 404`).toBe(200);

      const html = await response.text();
      const title = titleOf(html);

      expect(title, `${slug} should not fall back to the site-wide title`).not.toBe(
        'RESET — Head &amp; Body Massage, Wellness and Grooming for Men',
      );
      expect(title.toLowerCase(), `${slug} title should name the treatment`).toContain('massage');
      expect(html, `${slug} should carry its price in the HTML`).toMatch(/₹\s?\d/);
      expect(html, `${slug} should carry a canonical URL`).toContain(
        `${SITE}/service/${slug}`,
      );
      expect(html, `${slug} should carry structured data`).toContain('application/ld+json');
    });
  }

  test('TC-112 a slug that is not a service is a real 404', async ({ request }) => {
    // The other half of the same bug: a soft 404 that returns 200 gets indexed, and a
    // transient failure that returns 404 unpublishes a page that exists.
    const response = await request.get(`${SITE}/service/not-a-real-service`);
    expect(response.status()).toBe(404);
  });

  test('TC-113 robots.txt names the sitemap and shields the signed-in pages', async ({
    request,
  }) => {
    const response = await request.get(`${SITE}/robots.txt`);
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('Sitemap:');
    // /confirmation/<id> is somebody's appointment.
    expect(body).toContain('/confirmation/');
    expect(body).toContain('/checkout');
  });

  test('TC-114 the sitemap lists every treatment', async ({ request }) => {
    const response = await request.get(`${SITE}/sitemap.xml`);
    expect(response.status()).toBe(200);

    const xml = await response.text();
    for (const slug of SERVICES) {
      expect(xml, `the sitemap should list ${slug}`).toContain(`/service/${slug}`);
    }
  });

  test('TC-115 the homepage carries Open Graph tags for link previews', async ({ request }) => {
    const html = await (await request.get(SITE)).text();

    // The client shares this link on WhatsApp all day; without these it renders a bare URL.
    expect(html).toContain('og:title');
    expect(html).toContain('og:description');
    expect(html).toMatch(/rel="canonical"/);
  });
});
