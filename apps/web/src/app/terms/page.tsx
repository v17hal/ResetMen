import { TERMS } from '@reset/types';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SITE_URL, getStore } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'RESETMEN provides non-medical wellness, relaxation and body-care services. Our terms, and how cancellations and refunds work.',
  alternates: { canonical: `${SITE_URL}/terms` },
};

/**
 * Terms & Conditions — the client's wording of 11/09/2026, from `TERMS` in @reset/types.
 *
 * The same object the checkout checkbox quotes and the API validates against, so the page,
 * the checkbox and the record of what each customer agreed to cannot drift apart.
 *
 * Clause 4 refers to a Cancellation & Refund Policy that did not exist anywhere, so the
 * section below states what the system actually does. The cancellation window is read from
 * the store's own settings rather than typed here, so changing it in the admin panel keeps
 * this page true.
 */
export default async function TermsPage() {
  const store = await getStore();
  const hours = Math.round((store?.cancellationWindowMinutes ?? 120) / 60);

  const updated = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${TERMS.version}T12:00:00+05:30`));

  return (
    <article className="flex flex-col gap-lg p-base">
      <header className="flex flex-col gap-sm pt-sm">
        <Link href="/" className="text-body-sm text-primary underline underline-offset-4">
          ← Book a session
        </Link>
        <h1 className="font-display text-h1">{TERMS.title}</h1>
        <p className="text-body-sm text-text-muted">Last updated {updated}</p>
      </header>

      <ol className="flex list-decimal flex-col gap-md pl-lg text-body">
        {TERMS.clauses.map((clause) => (
          <li key={clause} className="pl-xs">
            {clause}
          </li>
        ))}
      </ol>

      <section id="cancellation-and-refunds" className="flex flex-col gap-sm">
        <h2 className="font-display text-h2">Cancellation &amp; Refund Policy</h2>
        <ul className="flex list-disc flex-col gap-sm pl-lg text-body">
          <li className="pl-xs">
            You can cancel free of charge up to {hours} hour{hours === 1 ? '' : 's'} before your
            slot, from <Link href="/bookings" className="text-primary underline underline-offset-4">Visits</Link>.
          </li>
          <li className="pl-xs">
            Closer to your slot than that, please{' '}
            <Link href="/help" className="text-primary underline underline-offset-4">
              message us
            </Link>{' '}
            and we will do what we can.
          </li>
          <li className="pl-xs">
            Payment is taken at the counter when you arrive. Nothing is charged online.
          </li>
          <li className="pl-xs">Where a refund is due, it is made at the counter.</li>
        </ul>
      </section>

      <p className="text-body-sm text-text-muted">
        Questions about these terms?{' '}
        <Link href="/help" className="text-primary underline underline-offset-4">
          Ask us
        </Link>
        .
      </p>
    </article>
  );
}
