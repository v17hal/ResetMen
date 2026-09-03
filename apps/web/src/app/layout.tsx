import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BottomNav } from '@/components/bottom-nav';
import { SiteFooter } from '@/components/site-footer';
import { SiteJsonLd } from '@/components/site-json-ld';
import { SITE_URL } from '@/lib/seo';
import { fontVariables } from './fonts';
import './globals.css';
import { Providers } from './providers';

/**
 * Site-wide defaults. Every page overrides the title and description with its own.
 *
 * `metadataBase` is what makes `alternates.canonical` and the Open Graph image resolve to
 * absolute URLs; without it Next emits relative ones and both are ignored.
 *
 * The default title says what the shop sells and where, rather than a slogan. "Book your
 * reset" is a lovely line and nobody has ever typed it into Google. It stays as the visible
 * greeting on the page; the title tag is for the search result.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  /**
   * Written around what people search for, not around the brand.
   *
   * "Quick", "head", "body" and "dry" are the words in the client's own keyword list, and
   * they are all true of the shop: ten to thirty minutes, no oil unless the Premium gel is
   * chosen, and no appointment needed. Nobody searches "book your reset", which is what the
   * title said for the site's whole life.
   *
   * No `keywords` meta tag. Google has ignored it since 2009 and Bing treats it as a spam
   * signal; the words have to be in the title, the description and the page or they do
   * nothing at all.
   */
  title: {
    default: 'Quick Head & Body Massage in Pune — RESET Wellness for Men',
    template: '%s · RESET',
  },
  description:
    'Quick dry massage for men in Pune — head, neck, shoulder and full body, from ₹49. ' +
    'Ten to thirty minutes, no appointment needed. Pick a time and walk straight in.',
  applicationName: 'RESET',
  appleWebApp: { capable: true, title: 'RESET', statusBarStyle: 'default' },
  alternates: { canonical: '/' },
  /**
   * Open Graph, which had none.
   *
   * The client sends this link on WhatsApp all day. With no OG tags WhatsApp renders a bare
   * blue URL, which converts worse than a card with the name, the offer and a picture — and
   * every share is a free impression the shop was throwing away.
   */
  openGraph: {
    type: 'website',
    siteName: 'RESET',
    locale: 'en_IN',
    url: SITE_URL,
    title: 'Quick Head & Body Massage in Pune — RESET Wellness for Men',
    description:
      'Quick dry massage for men in Pune — head, neck, shoulder and full body, from ₹49. ' +
      'Pick a time and walk straight in.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quick Head & Body Massage in Pune — RESET Wellness for Men',
    description: 'Quick dry massage for men in Pune, from ₹49. Walk straight in.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  /**
   * Search Console ownership, waiting for a token.
   *
   * Verifying the property is what lets somebody submit the sitemap and ask Google to crawl
   * a page rather than wait to be found, and it is the only place the crawl errors and the
   * queries people actually typed are visible. It needs the shop's own Google account, so
   * the token is supplied at build time rather than committed.
   *
   * Left out of the tag entirely when unset — an empty `content` on a verification meta is
   * read as a failed attempt rather than as no attempt.
   */
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION === undefined ||
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION === ''
    ? {}
    : {
        verification: {
          google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        },
      }),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom. Pinching to read a price is not a bug to prevent.
  maximumScale: 5,
  // Light regardless of the OS, matching the app — see the note on the html element.
  themeColor: '#F8F6F2',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // `data-theme` pins the palette light, regardless of the OS.
  //
  // The tokens call dark the brand default, and for a men's-grooming identity that is the
  // right instinct. It is the wrong instinct for a catalogue: a menu is small type and
  // pictures, and both read better on white. The app made the same call, and a customer
  // moving between the two should not meet a different product. The dark palette is still
  // generated and one attribute away.
  return (
    <html lang="en" data-theme="light" className={fontVariables}>
      <body className="min-h-dvh bg-bg text-text antialiased">
        {/* Who the site is, and how to search it. Rendered on the server, so a crawler
            reads it without executing anything. */}
        <SiteJsonLd />
        <a
          href="#main"
          className="sr-only-focusable absolute left-base top-base z-50 rounded-md bg-primary px-base py-sm text-primary-fg"
        >
          Skip to content
        </a>

        <Providers>
          {/* Padded for the fixed bottom nav, plus the home indicator on a gesture phone. */}
          <div className="mx-auto min-h-dvh w-full max-w-content pb-[calc(var(--reset-layout-bottom-nav-height)+env(safe-area-inset-bottom))] sm:pb-0">
            <main id="main">{children}</main>
          </div>
          <SiteFooter />
        <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
