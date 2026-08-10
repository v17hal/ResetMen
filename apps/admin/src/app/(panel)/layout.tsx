'use client';

import type { AdminRole } from '@reset/api-client';
import { Button, LoadingState, cn } from '@reset/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  /** Minimum role. Hiding a link is a convenience — the API re-checks every request. */
  minimum: AdminRole;
  /** Counter work, shown first and kept together. */
  group: 'counter' | 'manage' | 'insight';
}

const NAV: readonly NavItem[] = [
  { href: '/', label: 'Today', minimum: 'STAFF', group: 'counter' },
  { href: '/timeline', label: 'Timeline', minimum: 'STAFF', group: 'counter' },
  { href: '/checkin', label: 'Check in', minimum: 'STAFF', group: 'counter' },
  // No "all bookings" entry: the API exposes the day by station (timeline) and a customer's
  // history (customers/:id), but no cross-customer booking list. A nav item pointing at a
  // screen that cannot be built is worse than its absence — the CSV export covers the
  // reporting case.

  { href: '/customers', label: 'Customers', minimum: 'STAFF', group: 'manage' },
  { href: '/catalog', label: 'Catalog', minimum: 'MANAGER', group: 'manage' },
  { href: '/capacity', label: 'Capacity', minimum: 'MANAGER', group: 'manage' },
  { href: '/rewards', label: 'Rewards', minimum: 'MANAGER', group: 'manage' },
  { href: '/products', label: 'Products', minimum: 'MANAGER', group: 'manage' },

  { href: '/payments', label: 'Payments', minimum: 'MANAGER', group: 'insight' },
  { href: '/reports', label: 'Reports', minimum: 'MANAGER', group: 'insight' },
  { href: '/staff', label: 'Staff', minimum: 'OWNER', group: 'insight' },
  { href: '/audit', label: 'Audit log', minimum: 'OWNER', group: 'insight' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  counter: 'Counter',
  manage: 'Manage',
  insight: 'Insight',
};

export default function PanelLayout({ children }: { children: ReactNode }) {
  const { session, loading, signOut, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && session === null) router.replace('/login');
  }, [loading, session, router]);

  // Route changes close the drawer. Without this, tapping a link on a phone leaves the
  // overlay covering the page it just navigated to.
  useEffect(() => setNavOpen(false), [pathname]);

  if (loading) return <LoadingState label="Checking your session" className="min-h-dvh" />;
  if (session === null) return null;

  const visible = NAV.filter((item) => can(item.minimum));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <header className="flex items-center justify-between border-b border-border bg-surface px-base py-sm lg:hidden">
        <span className="font-display text-h2">RESET</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-controls="panel-nav"
        >
          {navOpen ? 'Close' : 'Menu'}
        </Button>
      </header>

      <nav
        id="panel-nav"
        aria-label="Sections"
        className={cn(
          'shrink-0 border-border bg-surface lg:block lg:w-60 lg:border-r',
          navOpen ? 'block border-b' : 'hidden',
        )}
      >
        <div className="hidden px-base py-lg lg:block">
          <span className="font-display text-h2">RESET</span>
          <p className="text-caption text-text-muted">Admin</p>
        </div>

        <ul className="flex flex-col gap-0.5 p-sm">
          {(['counter', 'manage', 'insight'] as const).map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (items.length === 0) return null;

            return (
              <li key={group}>
                <p className="px-sm pb-xs pt-base text-caption uppercase tracking-wide text-text-muted">
                  {GROUP_LABELS[group]}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active =
                      item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-touch-admin items-center rounded-md px-sm text-body-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            active
                              ? 'bg-primary/10 font-medium text-primary'
                              : 'text-text hover:bg-surface2',
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto border-t border-border p-base">
          <p className="truncate text-body-sm font-medium">{session.name}</p>
          <p className="text-caption text-text-muted">{session.role.toLowerCase()}</p>
          <Button variant="secondary" size="sm" fullWidth onClick={signOut} className="mt-sm">
            Sign out
          </Button>
        </div>
      </nav>

      <main id="main" className="min-w-0 flex-1 p-base lg:p-lg">
        {children}
      </main>
    </div>
  );
}
