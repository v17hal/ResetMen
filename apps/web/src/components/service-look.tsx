import type { ReactNode } from 'react';

/**
 * Icon and colour for a service, chosen from its name.
 *
 * Every `imageUrl` in the catalogue is null, and the honest options were a letter in a box
 * or something that means what the row is selling. A tile reading "H" three times down a
 * list of head treatments is visibly a missing image; a head is a picture of the thing.
 *
 * Deliberately mirrors `apps/mobile/lib/src/widgets/service_tile.dart` — same keywords,
 * same colours, same glyphs — so a service looks identical in the app and on the website.
 * Change one, change the other.
 */
export interface ServiceLook {
  readonly icon: ReactNode;
  readonly from: string;
  readonly to: string;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Seated, legs crossed, arms resting on the knees. */
const Meditate = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <circle cx="12" cy="5" r="2.1" fill="currentColor" />
    <path {...stroke} d="M12 8.4v4.2" />
    <path {...stroke} d="M12 12.6c-2.6 0-4.8 1.5-5.6 3.6h11.2c-.8-2.1-3-3.6-5.6-3.6Z" />
    <path {...stroke} d="M6.4 16.2c-1 .5-1.7 1.2-1.7 1.9M17.6 16.2c1 .5 1.7 1.2 1.7 1.9" />
  </svg>
);

/** Standing, arms out — the upper body. */
const Upper = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <circle cx="12" cy="5" r="2.1" fill="currentColor" />
    <path {...stroke} d="M4.5 10h15" />
    <path {...stroke} d="M12 8v6" />
    <path {...stroke} d="M9.4 14h5.2v5.5M9.4 14v5.5" />
  </svg>
);

/** Seated in profile, back supported. */
const Recline = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <circle cx="8.6" cy="5.4" r="2.1" fill="currentColor" />
    <path {...stroke} d="M8.6 8.4c-1.5 0-2.6 1.2-2.6 2.7v6.4" />
    <path {...stroke} d="M6 17.5h6.4l4.8-3.4" />
    <path {...stroke} d="M10.4 11.2h3.8" />
  </svg>
);

/** Four-point sparkle. */
const Sparkle = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <path
      fill="currentColor"
      d="M12 3.2 13.6 9 19.4 10.6 13.6 12.2 12 18 10.4 12.2 4.6 10.6 10.4 9Z"
    />
    <path fill="currentColor" d="m18 16.4.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" />
  </svg>
);

/** A face, with a little shine. */
const Face = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <circle {...stroke} cx="11.4" cy="12" r="7.2" />
    <circle cx="9" cy="10.6" r="1" fill="currentColor" />
    <circle cx="13.8" cy="10.6" r="1" fill="currentColor" />
    <path {...stroke} d="M8.6 14.6c1.6 1.4 4 1.4 5.6 0" />
    <path fill="currentColor" d="m19.6 3.4.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z" />
  </svg>
);

/** Lotus — the full-body mark. */
const Lotus = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <path fill="currentColor" d="M12 3.2c1.9 2 2.8 4 2.8 6.1 0 2-.9 3.7-2.8 5.3-1.9-1.6-2.8-3.3-2.8-5.3 0-2.1.9-4.1 2.8-6.1Z" />
    <path {...stroke} d="M8.2 8.6C5.9 9.5 4.4 11 3.7 13.3c2.4.5 4.4.1 6-1.3" />
    <path {...stroke} d="M15.8 8.6c2.3.9 3.8 2.4 4.5 4.7-2.4.5-4.4.1-6-1.3" />
    <path {...stroke} d="M5 17.4c2 1.6 4.3 2.4 7 2.4s5-.8 7-2.4" />
  </svg>
);

/** Walking figure. */
const Walk = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[44%] w-[44%]">
    <circle cx="13" cy="4.8" r="2" fill="currentColor" />
    <path {...stroke} d="M13 8v4.6l3 2.4" />
    <path {...stroke} d="M13 12.6 10 15l-1.4 4.4M16 15l1 4.4" />
    <path {...stroke} d="M13 9.6 9.8 11" />
  </svg>
);

const FALLBACK: ServiceLook = { icon: Lotus, from: '#0E7C66', to: '#12B886' };

const RULES: readonly (readonly [readonly string[], ServiceLook])[] = [
  [['back', 'spine'], { icon: Recline, from: '#1E5F74', to: '#3AA3C9' }],
  [['neck', 'shoulder'], { icon: Upper, from: '#35507A', to: '#5B87C7' }],
  [['head', 'scalp'], { icon: Meditate, from: '#4A3B6B', to: '#7E68BE' }],
  [['premium', 'luxe', 'signature'], { icon: Sparkle, from: '#7A4F1D', to: '#E0A040' }],
  [['glow', 'facial', 'face', 'clean'], { icon: Face, from: '#8A3B5E', to: '#D1719A' }],
  [['foot', 'leg'], { icon: Walk, from: '#2F5B3A', to: '#62AF70' }],
  [['full body', 'body', 'relax', 'basic'], { icon: Lotus, from: '#0E7C66', to: '#17C295' }],
  [['stress', 'relief'], { icon: Meditate, from: '#4A3B6B', to: '#7E68BE' }],
];

export function lookFor(name: string): ServiceLook {
  const n = name.toLowerCase();
  for (const [keywords, look] of RULES) {
    if (keywords.some((k) => n.includes(k))) return look;
  }
  return FALLBACK;
}

/**
 * The square tile on a service row. Shows the real photo the moment one exists; until then
 * an icon on the service's colour.
 */
export function ServiceImage({
  name,
  imageUrl,
  className = 'h-28 w-28',
  rounded = 'rounded-lg',
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
  rounded?: string;
}) {
  const look = lookFor(name);

  if (imageUrl != null && imageUrl !== '') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={`${className} ${rounded} object-cover`}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${className} ${rounded} flex items-center justify-center text-white`}
      style={{ backgroundImage: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
      aria-hidden="true"
    >
      {look.icon}
    </div>
  );
}
