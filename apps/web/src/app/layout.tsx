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
  title: {
    default: 'RESET — Head & Body Massage, Wellness and Grooming for Men',
    template: '%s · RESET',
  },
  description:
    'Walk-in head, neck, shoulder and full-body dry massage from ₹49. Pick a treatment, ' +
    'choose your time, and walk straight in — no waiting, no membership.',
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
    title: 'RESET — Head & Body Massage, Wellness and Grooming for Men',
    description:
      'Walk-in head, neck, shoulder and full-body dry massage from ₹49. Book a time and ' +
      'walk straight in.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RESET — Head & Body Massage, Wellness and Grooming for Men',
    description: 'Walk-in massage and grooming from ₹49. Book a time and walk straight in.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
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
