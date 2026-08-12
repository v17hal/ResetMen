import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { fontVariables } from './fonts.js';
import './globals.css';
import { Providers } from './providers.js';

export const metadata: Metadata = {
  title: 'RESET Admin',
  description: 'Bookings, capacity and reporting for the RESET outlet.',
  // The panel is used at a counter on a tablet. It is not a public page and should never
  // appear in a search result.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The station timeline is wide and staff pinch-zoom it. Locking scale would take that away.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-bg text-text antialiased">
        <a
          href="#main"
          className="sr-only-focusable absolute left-base top-base z-50 rounded-md bg-primary px-base py-sm text-primary-fg"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
