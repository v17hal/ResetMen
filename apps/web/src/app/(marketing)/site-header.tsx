'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { CalendarIcon, ChevronDownIcon, CloseIcon, MenuIcon } from './icons';

/**
 * The homepage's top bar, as in the client's design: logo, five links and "Find Centre".
 *
 * The design is a desktop picture; on a phone, where most customers are, the links fold
 * into a menu behind one button and "Our Services" opens in place rather than on hover.
 */
export function SiteHeader({
  mapsUrl,
  services,
}: {
  mapsUrl: string;
  services: readonly { id: string; name: string }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef<HTMLLIElement>(null);

  // The dropdown closes on a click anywhere else and on Escape, like any menu should.
  useEffect(() => {
    if (!servicesOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!servicesRef.current?.contains(event.target as Node)) setServicesOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setServicesOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [servicesOpen]);

  const close = () => {
    setMenuOpen(false);
    setServicesOpen(false);
  };

  const link = 'rounded-sm py-2 text-[15px] text-white/90 transition-colors hover:text-white lg:py-[calc(6*var(--d))] lg:text-[calc(13.5*var(--d))]';

  return (
    <header className="bg-[#153D42] text-white">
      <div className="mx-auto flex h-[68px] w-full items-center gap-4 px-4 sm:px-6 lg:h-[calc(62*var(--d))] lg:max-w-[calc(1024*var(--d))] lg:gap-0 lg:pl-[calc(30*var(--d))] lg:pr-[calc(34*var(--d))]">
        <Link href="/" aria-label="RESET Wellness Centre — home" className="shrink-0" onClick={close}>
          <img src="/home/logo.png" alt="RESET Wellness Centre" width={182} height={52} className="h-11 w-auto lg:h-[calc(52*var(--d))]" />
        </Link>

        <nav aria-label="Main" className="mx-auto hidden lg:block lg:pl-[calc(20*var(--d))]">
          <ul className="flex items-center gap-8 whitespace-nowrap lg:gap-[calc(26*var(--d))]">
            <li>
              <Link href="/" aria-current="page" className={`${link} border-b-2 border-white font-semibold text-white lg:border-b-[calc(2*var(--d))]`}>
                Home
              </Link>
            </li>
            <li ref={servicesRef} className="relative">
              <button
                type="button"
                className={`${link} flex items-center gap-1`}
                aria-expanded={servicesOpen}
                aria-controls="services-menu"
                onClick={() => setServicesOpen((open) => !open)}
              >
                Our Services
                <ChevronDownIcon className={`h-4 w-4 transition-transform lg:h-[calc(13*var(--d))] lg:w-[calc(13*var(--d))] ${servicesOpen ? 'rotate-180' : ''}`} />
              </button>
              {servicesOpen && (
                <ul
                  id="services-menu"
                  className="absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2 rounded-xl bg-white p-2 shadow-xl ring-1 ring-black/5"
                >
                  {services.map((service) => (
                    <li key={service.id}>
                      <a
                        href={`#${service.id}`}
                        onClick={close}
                        className="block rounded-lg px-3 py-2.5 text-[15px] text-[#0B3A38] hover:bg-[#EEF3F3]"
                      >
                        {service.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li>
              <a href="#why-us" className={link}>
                Why Us
              </a>
            </li>
            <li>
              <a href="#testimonials" className={link}>
                Testimonials
              </a>
            </li>
            <li>
              <Link href="/book" className={link}>
                Book Appointment
              </Link>
            </li>
          </ul>
        </nav>

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto hidden items-center gap-2 whitespace-nowrap rounded-full bg-[#F2EFF6] px-6 py-3 text-[15px] font-semibold text-[#1F3B3F] shadow-sm transition-colors hover:bg-white sm:flex lg:ml-0 lg:h-[calc(38*var(--d))] lg:gap-[calc(7*var(--d))] lg:px-[calc(18*var(--d))] lg:py-0 lg:text-[calc(13.5*var(--d))]"
        >
          <CalendarIcon className="h-5 w-5 lg:h-[calc(17*var(--d))] lg:w-[calc(17*var(--d))]" />
          Find Centre
        </a>

        <button
          type="button"
          className="ml-auto rounded-md p-2 text-white sm:ml-2 lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <CloseIcon className="h-7 w-7" /> : <MenuIcon className="h-7 w-7" />}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-white/10 lg:hidden">
          <ul className="mx-auto flex flex-col px-4 py-3 sm:px-6">
            <li>
              <Link href="/" onClick={close} className="block py-3 text-[17px] font-semibold">
                Home
              </Link>
            </li>
            <li>
              <button
                type="button"
                className="flex w-full items-center justify-between py-3 text-[17px]"
                aria-expanded={servicesOpen}
                onClick={() => setServicesOpen((open) => !open)}
              >
                Our Services
                <ChevronDownIcon className={`h-5 w-5 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} />
              </button>
              {servicesOpen && (
                <ul className="mb-2 border-l border-white/20 pl-4">
                  {services.map((service) => (
                    <li key={service.id}>
                      <a href={`#${service.id}`} onClick={close} className="block py-2 text-[15px] text-white/85">
                        {service.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li>
              <a href="#why-us" onClick={close} className="block py-3 text-[17px]">
                Why Us
              </a>
            </li>
            <li>
              <a href="#testimonials" onClick={close} className="block py-3 text-[17px]">
                Testimonials
              </a>
            </li>
            <li>
              <Link href="/book" onClick={close} className="block py-3 text-[17px]">
                Book Appointment
              </Link>
            </li>
            <li className="pb-3 pt-2">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#F2EFF6] px-6 py-3 text-[15px] font-semibold text-[#1F3B3F]"
              >
                <CalendarIcon className="h-5 w-5" />
                Find Centre
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
