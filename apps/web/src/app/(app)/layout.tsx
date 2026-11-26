import type { ReactNode } from 'react';

import { BottomNav } from '@/components/bottom-nav';
import { SiteFooter } from '@/components/site-footer';

/**
 * The booking app's shell: a phone-width column, the shop's footer and the bottom tabs.
 *
 * Every page a customer books, pays and checks rewards on lives under this group. The
 * homepage does not — since the client's design of 26/11/2026 it is a full-width marketing
 * page with its own header and footer, and "Book Appointment" brings people here, to /book.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Padded for the fixed bottom nav, plus the home indicator on a gesture phone. */}
      <div className="mx-auto min-h-dvh w-full max-w-content pb-[calc(var(--reset-layout-bottom-nav-height)+env(safe-area-inset-bottom))] sm:pb-0">
        <main id="main">{children}</main>
      </div>
      <SiteFooter />
      <BottomNav />
    </>
  );
}
