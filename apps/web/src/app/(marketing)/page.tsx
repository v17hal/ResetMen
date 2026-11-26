import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode, SVGProps } from 'react';

import { getStore } from '@/lib/seo';
import {
  MORE_VIDEOS_URL,
  SERVICES,
  SOCIAL,
  TESTIMONIALS,
  WHY_CHOOSE,
  WHY_MASSAGE,
} from './home-content';
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  FacebookIcon,
  InstagramIcon,
  MapPinIcon,
  QuoteIcon,
  YoutubeIcon,
} from './icons';
import { SiteHeader } from './site-header';

/**
 * The homepage — client design of 26/11/2026 (docs/design/homepage-2026-11-26.jpg), built
 * piece for piece. Booking itself moved to /book; every "Book Appointment" leads there.
 *
 * Desktop sizes are the design's own pixels. The design is a 1024-pixel-wide picture, and
 * `--d` is one of its pixels: exactly 1px at 1024 wide, growing with the window to 1440, so
 * `text-[calc(52*var(--d))]` is the 52-pixel title in the picture at every desktop width and
 * the page keeps its proportions instead of reflowing. Phones have their own sizes, the same
 * sections stacked in the same order.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const store = await getStore();

  // "Find Centre" opens the shop in Maps, by the address the shop edits in the admin panel.
  const address = [store?.address, store?.city].filter(Boolean).join(', ');
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `RESET Wellness Centre, ${address || 'Pune'}`,
  )}`;
  const city = store?.city ?? 'Pune';

  return (
    <div className="bg-[#F8F6FA] font-body text-[#3F4F4A] [--d:clamp(1px,0.09766vw,1.40625px)]">
      <SiteHeader mapsUrl={mapsUrl} services={SERVICES.map(({ id, name }) => ({ id, name }))} />

      <main id="main">
        <Hero mapsUrl={mapsUrl} />
        <WhyMassage />
        <Services />
        <WhyChooseAndRelax />
        <Feedback />
        <BookingBand />
      </main>

      <Footer mapsUrl={mapsUrl} city={city} />
    </div>
  );
}

/** The design's content width: 1024 of its pixels, so 1440px at most. */
const FRAME = 'mx-auto w-full lg:max-w-[calc(1024*var(--d))]';

// ── Pieces ─────────────────────────────────────────────────────────────────────

function SectionTitle({ children, id, line = 95 }: { children: ReactNode; id: string; line?: 95 | 105 }) {
  const rule =
    line === 95
      ? 'hidden h-px w-12 bg-[#2A4242] sm:block lg:w-[calc(95*var(--d))]'
      : 'hidden h-px w-12 bg-[#2A4242] sm:block lg:w-[calc(105*var(--d))]';
  return (
    <div className="flex items-center justify-center gap-4 lg:gap-[calc(18*var(--d))]">
      <span aria-hidden="true" className={rule} />
      <h2 id={id} className="text-center font-display text-[26px] font-bold leading-tight text-[#0B3A38] lg:text-[length:inherit]">
        {children}
      </h2>
      <span aria-hidden="true" className={rule} />
    </div>
  );
}

function Hero({ mapsUrl }: { mapsUrl: string }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-[linear-gradient(100deg,#F2F2FD_0%,#EFEDF9_40%,#EBE0EC_70%,#EAD8E4_100%)]"
    >
      <div className={`${FRAME} grid lg:h-[calc(340*var(--d))] lg:grid-cols-[41%_59%]`}>
        <div className="relative z-10 px-5 pb-10 pt-9 lg:px-0 lg:pb-0 lg:pl-[calc(46*var(--d))] lg:pt-[calc(31*var(--d))]">
          <h1
            id="hero-title"
            className="font-display text-[44px] font-extrabold leading-[0.95] tracking-[-0.02em] text-[#0B3A38] lg:whitespace-nowrap lg:text-[calc(50*var(--d))] lg:leading-[0.94]"
          >
            RESET
            <br />
            Wellness Centre
          </h1>
          <span aria-hidden="true" className="mt-4 block h-[3px] w-[30px] bg-[#12362F] lg:mt-[calc(13*var(--d))] lg:h-[calc(3*var(--d))] lg:w-[calc(30*var(--d))]" />
          <p className="mt-4 font-display text-[26px] font-bold leading-[1.08] text-[#0B3A38] lg:mt-[calc(14*var(--d))] lg:text-[calc(28*var(--d))]">
            Bodycare is a Necessity,
            <br />
            Not a Luxury.
          </p>
          <p className="mt-3 text-[16px] font-medium leading-[1.33] text-[#243036] lg:mt-[calc(13*var(--d))] lg:text-[calc(15*var(--d))]">
            RESET – Making Bodycare Affordable
            <br />
            &amp; Accessible to All
          </p>
          <div className="mt-6 flex flex-wrap gap-3 lg:mt-[calc(20*var(--d))] lg:gap-[calc(17*var(--d))]">
            <Link
              href="/book"
              className="inline-flex items-center gap-2 rounded-full bg-[#134E5F] px-5 py-3 text-[14px] font-semibold text-white shadow-md transition-colors hover:bg-[#0F4050] lg:h-[calc(35*var(--d))] lg:gap-[calc(7*var(--d))] lg:px-[calc(17*var(--d))] lg:py-0 lg:text-[calc(12.5*var(--d))]"
            >
              <CalendarIcon className="h-5 w-5 lg:h-[calc(16*var(--d))] lg:w-[calc(16*var(--d))]" />
              Book Appointment
              <ArrowRightIcon className="h-4 w-4 lg:h-[calc(12*var(--d))] lg:w-[calc(12*var(--d))]" />
            </Link>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[#183C3C] bg-white/40 px-5 py-2.5 text-[14px] font-semibold text-[#0C3C3C] transition-colors hover:bg-white lg:h-[calc(35*var(--d))] lg:gap-[calc(6*var(--d))] lg:border-[calc(1.6*var(--d))] lg:px-[calc(17*var(--d))] lg:py-0 lg:text-[calc(12.5*var(--d))]"
            >
              <MapPinIcon className="h-5 w-5 lg:h-[calc(17*var(--d))] lg:w-[calc(17*var(--d))]" />
              Find Our Centre
            </a>
          </div>
        </div>

        <img
          src="/home/hero.webp"
          alt="A RESET attendant giving a back massage beside the shop's G5 machine"
          width={1212}
          height={682}
          fetchPriority="high"
          className="w-full object-cover object-left lg:h-full"
        />
      </div>
    </section>
  );
}

function WhyMassage() {
  return (
    <section aria-labelledby="why-massage" className="border-t-[6px] border-white bg-[#EEEFF4] pb-6 pt-7 lg:border-t-[calc(13*var(--d))] lg:pb-[calc(11*var(--d))] lg:pt-[calc(7*var(--d))]">
      <div className={`${FRAME} px-4 lg:px-[calc(20*var(--d))]`}>
        <div className="lg:text-[calc(26*var(--d))]">
          <SectionTitle id="why-massage">Why Massage is Important?</SectionTitle>
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-2 lg:mt-[calc(7*var(--d))] lg:grid-cols-4 lg:gap-[calc(5*var(--d))]">
          {WHY_MASSAGE.map((item) => (
            <li
              key={item.text}
              className="flex flex-col items-center rounded-md bg-[#2F5466] px-3 py-5 text-center lg:h-[calc(136*var(--d))] lg:rounded-[calc(6*var(--d))] lg:px-[calc(26*var(--d))] lg:py-0 lg:pt-[calc(9*var(--d))]"
            >
              <img src={item.icon} alt="" width={70} height={64} className="h-12 w-auto lg:h-[calc(56*var(--d))]" />
              <p className="mt-3 text-[14px] leading-snug text-white lg:mt-[calc(8*var(--d))] lg:text-[calc(14.5*var(--d))] lg:leading-[1.42]">
                {item.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Services() {
  return (
    <section id="services" aria-labelledby="our-services" className="pb-8 pt-8 lg:pb-[calc(10*var(--d))] lg:pt-[calc(8*var(--d))]">
      <div className={`${FRAME} px-4 lg:px-[calc(20*var(--d))]`}>
        <div className="lg:text-[calc(28*var(--d))]">
          <SectionTitle id="our-services" line={105}>
            Our Services
          </SectionTitle>
        </div>
        <p className="mt-1 text-center text-[16px] text-[#243630] lg:mt-[calc(2*var(--d))] lg:text-[calc(14.5*var(--d))]">
          Advanced Wellness Solutions for a Healthier, Happier You
        </p>

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:mt-[calc(11*var(--d))] lg:grid-cols-5 lg:gap-[calc(14*var(--d))] lg:px-[calc(4*var(--d))]">
          {SERVICES.map((service) => (
            <li
              key={service.id}
              id={service.id}
              className="flex scroll-mt-6 flex-col overflow-hidden rounded-xl bg-white shadow-[0_2px_10px_rgba(16,48,56,0.08)] lg:rounded-[calc(8*var(--d))]"
            >
              <img
                src={service.image}
                alt={service.name}
                width={370}
                height={212}
                loading="lazy"
                className="aspect-[185/106] w-full object-cover"
              />
              <div className="flex flex-1 flex-col px-4 pb-5 pt-3 lg:px-[calc(10*var(--d))] lg:pb-[calc(12*var(--d))] lg:pt-[calc(9*var(--d))]">
                <h3 className="flex min-h-[2.4em] items-center justify-center text-center font-display text-[18px] font-bold leading-[1.2] tracking-[-0.01em] text-[#0E4A40] lg:text-[calc(14.5*var(--d))]">
                  {service.name}
                </h3>
                <p className="mt-2 text-center text-[14px] leading-snug text-[#3C4E48] lg:mt-[calc(6*var(--d))] lg:min-h-[calc(48*var(--d))] lg:text-[calc(12*var(--d))] lg:leading-[1.36] lg:tracking-[-0.01em]">
                  {service.summary}
                </p>
                <p className="mt-3 text-[13px] font-bold text-[#1E2E2E] lg:mt-[calc(8*var(--d))] lg:text-[calc(11.5*var(--d))]">
                  Benefits:
                </p>
                <ul className="mt-1 space-y-1 lg:mt-[calc(3*var(--d))] lg:space-y-[calc(4*var(--d))]">
                  {service.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-center gap-2 text-[14px] text-[#424E48] lg:gap-[calc(7*var(--d))] lg:text-[calc(11.5*var(--d))]"
                    >
                      <CheckIcon className="h-4 w-4 shrink-0 text-[#063036] lg:h-[calc(11*var(--d))] lg:w-[calc(11*var(--d))]" />
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WhyChooseAndRelax() {
  return (
    <section id="why-us" aria-labelledby="why-choose" className="pb-6 lg:pb-0">
      <div className={`${FRAME} grid items-center gap-6 px-4 lg:grid-cols-[calc(668*var(--d))_1fr] lg:gap-0 lg:px-0 lg:pl-[calc(20*var(--d))]`}>
        <div className="lg:pb-[calc(10*var(--d))] lg:pt-[calc(4*var(--d))]">
          <div className="lg:text-[calc(26*var(--d))]">
            <SectionTitle id="why-choose" line={105}>
              Why Choose RESET?
            </SectionTitle>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-y-6 sm:grid-cols-3 lg:mt-[calc(12*var(--d))] lg:grid-cols-5 lg:gap-y-0">
            {WHY_CHOOSE.map((item, index) => (
              <li
                key={item.label}
                className={`flex flex-col items-center px-2 text-center lg:px-[calc(4*var(--d))] ${
                  index > 0 ? 'lg:border-l lg:border-[#A8AEB4]' : ''
                }`}
              >
                <img src={item.icon} alt="" width={52} height={52} className="h-12 w-auto lg:h-[calc(48*var(--d))]" />
                <p className="mt-2 max-w-[150px] text-[13px] leading-snug text-[#364848] lg:mt-[calc(5*var(--d))] lg:max-w-none lg:text-[calc(11.5*var(--d))] lg:leading-[1.25]">
                  {item.label}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <img
          src="/home/relax.webp"
          alt="Relax Today… Live Better Tomorrow"
          width={672}
          height={294}
          loading="lazy"
          className="mx-auto w-full max-w-[420px] lg:max-w-none"
        />
      </div>
    </section>
  );
}

function Feedback() {
  return (
    <section id="testimonials" aria-labelledby="feedback" className="pb-8 pt-4 lg:pb-[calc(12*var(--d))] lg:pt-[calc(6*var(--d))]">
      <div className={`${FRAME} px-4 lg:px-[calc(33*var(--d))]`}>
        <div className="lg:text-[calc(21*var(--d))]">
          <SectionTitle id="feedback" line={105}>
            Customer Feedback
          </SectionTitle>
        </div>

        <div className="mt-6 grid gap-8 lg:mt-[calc(12*var(--d))] lg:grid-cols-[calc(527*var(--d))_1fr] lg:gap-[calc(23*var(--d))]">
          {TESTIMONIALS.map((testimonial, index) => (
            <figure
              key={testimonial.author}
              className="flex flex-col gap-4 sm:flex-row sm:items-start lg:gap-[calc(15*var(--d))]"
            >
              <Thumbnail testimonial={testimonial} />
              <div className="flex-1 lg:pt-[calc(18*var(--d))]">
                <blockquote className="relative pl-8 lg:pl-[calc(20*var(--d))]">
                  <QuoteIcon className="absolute left-0 top-1 h-4 w-6 text-[#2A3B39] lg:top-[calc(4*var(--d))] lg:h-[calc(12*var(--d))] lg:w-[calc(16*var(--d))]" />
                  <p className="text-[16px] italic leading-relaxed text-[#3C4848] lg:text-[calc(14*var(--d))] lg:leading-[1.42]">
                    {testimonial.quote}
                  </p>
                </blockquote>
                <figcaption className="mt-2 pl-8 text-[13px] text-[#485454] lg:mt-[calc(8*var(--d))] lg:pl-[calc(20*var(--d))] lg:text-[calc(11*var(--d))]">
                  — {testimonial.author}
                </figcaption>
                {index === 0 && MORE_VIDEOS_URL !== null && (
                  <a
                    href={MORE_VIDEOS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#304242] px-5 py-2 text-[14px] font-semibold text-[#304242] hover:bg-white lg:mt-[calc(18*var(--d))] lg:h-[calc(28*var(--d))] lg:gap-[calc(5*var(--d))] lg:px-[calc(13*var(--d))] lg:py-0 lg:text-[calc(11.5*var(--d))]"
                  >
                    Watch More Videos
                    <ArrowRightIcon className="h-4 w-4 lg:h-[calc(11*var(--d))] lg:w-[calc(11*var(--d))]" />
                  </a>
                )}
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Thumbnail({ testimonial }: { testimonial: (typeof TESTIMONIALS)[number] }) {
  const picture = (
    <img
      src={testimonial.image}
      alt={`${testimonial.author}, a RESET customer`}
      width={464}
      height={270}
      loading="lazy"
      className="w-full rounded-lg object-cover shadow-[0_6px_18px_rgba(16,48,56,0.18)] sm:w-[260px] lg:h-[calc(135*var(--d))] lg:w-[calc(232*var(--d))] lg:rounded-[calc(6*var(--d))]"
    />
  );

  // The picture already shows a play button, as in the design; it plays once there is a
  // video to play.
  if (testimonial.videoUrl === null) return <div className="shrink-0">{picture}</div>;

  return (
    <a
      href={testimonial.videoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0"
      aria-label={`Watch ${testimonial.author}'s video`}
    >
      {picture}
    </a>
  );
}

function BookingBand() {
  return (
    <section aria-labelledby="book-today" className="px-4 pb-6 lg:px-[calc(20*var(--d))] lg:pb-[calc(12*var(--d))]">
      <div className="relative mx-auto flex w-full flex-col items-center gap-4 overflow-hidden rounded-lg bg-[#124356] px-6 py-7 text-white sm:flex-row sm:gap-6 lg:h-[calc(78*var(--d))] lg:max-w-[calc(987*var(--d))] lg:gap-0 lg:rounded-[calc(6*var(--d))] lg:px-0 lg:py-0 lg:pl-[calc(135*var(--d))] lg:pr-[calc(126*var(--d))]">
        <img src="/home/cta-leaves-left.png" alt="" width={115} height={76} className="pointer-events-none absolute bottom-0 left-0 hidden h-full w-auto lg:block" />
        <img src="/home/cta-leaves-right.png" alt="" width={127} height={76} className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-auto lg:block" />
        <img src="/home/cta-calendar.png" alt="" width={56} height={54} className="relative h-14 w-auto lg:h-[calc(50*var(--d))]" />
        <div className="text-center sm:text-left lg:ml-[calc(19*var(--d))]">
          <h2 id="book-today" className="font-display text-[22px] font-bold leading-tight lg:text-[calc(19.5*var(--d))]">
            Book Your Wellness Session Today
          </h2>
          <p className="mt-1 text-[15px] text-white/90 lg:mt-[calc(2*var(--d))] lg:text-[calc(13*var(--d))]">
            Take the first step towards a healthier, stress-free you.
          </p>
        </div>
        <span aria-hidden="true" className="hidden w-px self-stretch bg-white/70 sm:block lg:my-[calc(13*var(--d))] lg:ml-auto lg:mr-[calc(60*var(--d))]" />
        <Link
          href="/book"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#F0F3F6] px-7 py-3 text-[16px] font-bold text-[#124254] transition-colors hover:bg-white lg:h-[calc(46*var(--d))] lg:gap-[calc(6*var(--d))] lg:px-[calc(22*var(--d))] lg:py-0 lg:text-[calc(15*var(--d))]"
        >
          Book Appointment
          <ArrowRightIcon className="h-5 w-5 lg:h-[calc(15*var(--d))] lg:w-[calc(15*var(--d))]" />
        </Link>
      </div>
    </section>
  );
}

function Footer({ mapsUrl, city }: { mapsUrl: string; city: string }) {
  const links: readonly [string, string][] = [
    ['Home', '/'],
    ['Our Services', '#services'],
    ['Why Us', '#why-us'],
    ['Testimonials', '#testimonials'],
    ['Contact', '/help'],
  ];
  const social: readonly [keyof typeof SOCIAL, string, (props: SVGProps<SVGSVGElement>) => ReactNode][] = [
    ['instagram', 'Instagram', InstagramIcon],
    ['youtube', 'YouTube', YoutubeIcon],
    ['facebook', 'Facebook', FacebookIcon],
  ];
  const iconSize = 'h-6 w-6 lg:h-[calc(21*var(--d))] lg:w-[calc(21*var(--d))]';

  return (
    <footer className="bg-[#153D42] text-white">
      <div className={`${FRAME} flex flex-col items-center gap-6 px-4 py-9 lg:h-[calc(116*var(--d))] lg:flex-row lg:gap-0 lg:px-[calc(33*var(--d))] lg:py-0`}>
        <Link href="/" aria-label="RESET Wellness Centre — home" className="shrink-0">
          <img src="/home/logo.png" alt="RESET Wellness Centre" width={210} height={60} className="h-14 w-auto lg:h-[calc(56*var(--d))]" />
        </Link>

        <nav aria-label="Footer" className="lg:ml-auto">
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 whitespace-nowrap text-[15px] lg:flex-nowrap lg:gap-x-0 lg:text-[calc(13*var(--d))]">
            {links.map(([label, href], index) => (
              <li key={label} className="flex items-center">
                {index > 0 && (
                  <span aria-hidden="true" className="hidden text-white/60 lg:mx-[calc(10*var(--d))] lg:inline">
                    |
                  </span>
                )}
                {href.startsWith('/') ? (
                  <Link href={href} className="text-white/90 hover:text-white">
                    {label}
                  </Link>
                ) : (
                  <a href={href} className="text-white/90 hover:text-white">
                    {label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <span aria-hidden="true" className="hidden h-[calc(42*var(--d))] w-px bg-white/40 lg:ml-[calc(30*var(--d))] lg:block" />

        <ul className="flex items-center gap-5 lg:ml-[calc(28*var(--d))] lg:gap-[calc(13*var(--d))]" aria-label="RESET on social media">
          {social.map(([key, label, Icon]) => {
            const url = SOCIAL[key];
            return (
              <li key={key}>
                {url === null ? (
                  <span className="block text-white" title={label}>
                    <Icon className={iconSize} />
                  </span>
                ) : (
                  <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className="block text-white hover:text-white/80">
                    <Icon className={iconSize} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <span aria-hidden="true" className="hidden h-[calc(42*var(--d))] w-px bg-white/40 lg:ml-[calc(22*var(--d))] lg:block" />

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[16px] hover:text-white/80 lg:ml-[calc(22*var(--d))] lg:gap-[calc(5*var(--d))] lg:text-[calc(13*var(--d))]"
        >
          <MapPinIcon className="h-6 w-6 lg:h-[calc(19*var(--d))] lg:w-[calc(19*var(--d))]" />
          {city}
        </a>
      </div>
    </footer>
  );
}
