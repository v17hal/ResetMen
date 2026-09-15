import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SITE_URL, getStore, locality } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What RESETMEN collects when you book, why, who else sees it, how long it is kept, and how ' +
    'to delete your account.',
  alternates: { canonical: `${SITE_URL}/privacy` },
};

/**
 * Privacy Policy — written for two readers.
 *
 * A customer deciding whether to sign in with Google, and the Play Console reviewer who will
 * not publish an app that handles a name and a phone number without a policy at a public URL.
 *
 * Every claim here is one the code keeps: deletion really does cancel upcoming bookings,
 * anonymise the record and purge it after thirty days; money really is taken at the counter,
 * so no card detail reaches us; there really is no analytics or advertising SDK in either
 * app. If any of that changes, this page changes in the same commit.
 */
export default async function PrivacyPage() {
  const store = await getStore();
  const city = locality(store);

  return (
    <article className="flex flex-col gap-lg p-base">
      <header className="flex flex-col gap-sm pt-sm">
        <Link href="/" className="text-body-sm text-primary underline underline-offset-4">
          ← Book a session
        </Link>
        <h1 className="font-display text-h1">Privacy Policy</h1>
        <p className="text-body-sm text-text-muted">Last updated 15 September 2026.</p>
      </header>

      <Section title="Who we are">
        <p>
          RESETMEN{city === null ? '' : ` in ${city}`} runs this website and the RESET Android app.
          This policy covers both. If anything here is unclear, ask through{' '}
          <Link href="/help" className="underline underline-offset-2">Help</Link> and we will answer
          in writing.
        </p>
      </Section>

      <Section title="What we collect, and why">
        <ul className="flex list-disc flex-col gap-xs pl-lg">
          <li>
            <strong>Your name and email address</strong>, from Google when you sign in — so we know
            whose booking is whose.
          </li>
          <li>
            <strong>Your phone number</strong>, if you give it. Never required to book. Used to ring
            you if you are late or a booking has to move.
          </li>
          <li>
            <strong>Your bookings and visits</strong> — the service, the time, and whether you
            arrived. This is the service itself, and what your entry QR is checked against.
          </li>
          <li>
            <strong>Payments</strong>, recorded when you pay at the counter: amount, method, date.
            We never see or store card details.
          </li>
          <li>
            <strong>Questions you send us</strong> through Help, and our replies.
          </li>
          <li>
            <strong>A notification token</strong> from your phone, if you allow notifications, so we
            can tell you when a booking is confirmed or your question is answered.
          </li>
          <li>
            <strong>Optional details</strong> such as date of birth or gender. Leave them blank and
            nothing stops working.
          </li>
        </ul>
        <p>
          We do not collect your location, contacts or photos. The app asks for no permission beyond
          internet access and, if you agree, notifications.
        </p>
      </Section>

      <Section title="What we never do">
        <ul className="flex list-disc flex-col gap-xs pl-lg">
          <li>We do not sell or rent your details to anyone.</li>
          <li>We do not use them for advertising; there is no ad network in the app.</li>
          <li>There is no analytics or tracking SDK in the app or on this site.</li>
        </ul>
      </Section>

      <Section title="Who else sees it">
        <p>Only the companies that make the service work, and only for that:</p>
        <ul className="flex list-disc flex-col gap-xs pl-lg">
          <li><strong>Google (Firebase)</strong> — signing you in, and delivering notifications.</li>
          <li><strong>MSG91</strong> — sending an SMS, where we send one.</li>
          <li>
            <strong>Razorpay</strong> — only if paying online is switched on. Today every booking is
            settled at the counter, so nothing reaches a payment gateway.
          </li>
        </ul>
        <p>Our servers are in India. Nobody else receives your details, unless the law requires it.</p>
      </Section>

      <Section title="How long we keep it">
        <p>
          While you have an account, and after that only as long as the law requires. Bookings and
          payments are financial records, so the record of a visit remains — with your name, email
          and phone number removed from it.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          In the app: <strong>You → Delete my account</strong>. On this site: your account page. You
          need not ask us, and need not give a reason. The moment you confirm:
        </p>
        <ul className="flex list-disc flex-col gap-xs pl-lg">
          <li>Any upcoming booking is cancelled, so the time goes back to the shop.</li>
          <li>Your name, email and phone number are cleared from the account.</li>
          <li>You are signed out, and notifications stop.</li>
          <li>The account is purged completely after 30 days.</li>
        </ul>
      </Section>

      <Section title="Your rights">
        <p>
          Under the Digital Personal Data Protection Act, 2023 you may ask what we hold about you,
          ask us to correct it, or ask us to erase it. Ask through{' '}
          <Link href="/help" className="underline underline-offset-2">Help</Link> and we will reply
          in writing. If our answer does not satisfy you, you may complain to the Data Protection
          Board of India.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The service is for adults. We do not knowingly take bookings from anyone under 18, or
          collect their details.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes, the date above changes with it. The current version is always at{' '}
          {SITE_URL}/privacy.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Write to us through{' '}
          <Link href="/help" className="underline underline-offset-2">Help</Link>
          {store?.address === null || store?.address === undefined
            ? '.'
            : `, or in person at ${store.address}${city === null ? '' : `, ${city}`}.`}
        </p>
      </Section>

      <p className="text-caption text-text-muted">
        <Link href="/terms" className="underline underline-offset-2">
          Terms &amp; Conditions
        </Link>
        {' · '}Non-medical wellness services only.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-sm">
      <h2 className="font-display text-h2">{title}</h2>
      <div className="flex flex-col gap-sm text-body-sm">{children}</div>
    </section>
  );
}
