import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BottomNav } from '@/components/bottom-nav';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'RESET — book your reset',
    template: '%s · RESET',
  },
  description:
    'Professional wellness, dry massage, relaxation and grooming. Book a time, walk in, ' +
    'and leave feeling refreshed.',
  applicationName: 'RESET',
  appleWebApp: { capable: true, title: 'RESET', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom. Pinching to read a price is not a bug to prevent.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8F6F2' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F14' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-text antialiased">
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
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
