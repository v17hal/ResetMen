'use client';

import { cn } from '@reset/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Book', icon: CalendarIcon },
  { href: '/bookings', label: 'Visits', icon: TicketIcon },
  { href: '/rewards', label: 'Rewards', icon: GiftIcon },
  { href: '/shop', label: 'Shop', icon: BagIcon },
  { href: '/account', label: 'You', icon: UserIcon },
] as const;

/**
 * Bottom tab bar on phones, a top bar from `sm` up.
 *
 * Five destinations is the ceiling for a thumb — past that the targets get narrower than
 * they are tall, and the labels start truncating.
 */
export function BottomNav() {
  const pathname = usePathname();

  // Checkout and confirmation are focused, one-way screens. A tab bar there is an invitation
  // to abandon a hold that is already counting down.
  if (pathname.startsWith('/checkout') || pathname.startsWith('/confirmation')) return null;

  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface',
        'pb-[env(safe-area-inset-bottom)]',
        'sm:sticky sm:top-0 sm:bottom-auto sm:border-b sm:border-t-0 sm:pb-0',
      )}
    >
      <ul className="mx-auto flex max-w-content items-stretch justify-around sm:justify-start sm:gap-base sm:px-base">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1 sm:flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-touch flex-col items-center justify-center gap-0.5 py-sm text-caption',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  'sm:min-h-touch sm:flex-row sm:gap-xs sm:px-sm sm:text-body-sm',
                  active ? 'text-primary' : 'text-text-muted hover:text-text',
                )}
              >
                <Icon filled={active} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface IconProps {
  filled?: boolean;
}

function base(filled: boolean | undefined) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: filled === true ? 'currentColor' : 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

function CalendarIcon({ filled }: IconProps) {
  return (
    <svg {...base(filled)}>
      <rect x="3" y="5" width="18" height="16" rx="3" fill="none" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function TicketIcon({ filled }: IconProps) {
  return (
    <svg {...base(filled)}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
    </svg>
  );
}

function GiftIcon({ filled }: IconProps) {
  return (
    <svg {...base(filled)}>
      <rect x="3" y="9" width="18" height="12" rx="2" fill="none" />
      <path d="M3 13h18M12 9v12M12 9S9 4 7 5.5 9 9 12 9Zm0 0s3-5 5-3.5S15 9 12 9Z" />
    </svg>
  );
}

function BagIcon({ filled }: IconProps) {
  return (
    <svg {...base(filled)}>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" />
    </svg>
  );
}

function UserIcon({ filled }: IconProps) {
  return (
    <svg {...base(filled)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" fill="none" />
    </svg>
  );
}
