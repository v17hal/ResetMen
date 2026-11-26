/**
 * Everything the homepage says, in one place — client design of 26/11/2026
 * (docs/design/homepage-2026-11-26.jpg). The words are the design's, as given.
 *
 * Pictures are cut from that design until the client sends the originals; replacing a file
 * in public/home/ with a sharper one of the same name needs no code change.
 */

export interface MarketingService {
  /** Also the anchor the header's "Our Services" menu jumps to. */
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly image: string;
  readonly benefits: readonly string[];
}

export const WHY_MASSAGE: readonly { icon: string; text: string }[] = [
  { icon: '/home/why-1.png', text: 'Boosts blood circulation for improved energy levels' },
  { icon: '/home/why-2.png', text: 'Soothes body and mind for better sleep and reduced stress.' },
  { icon: '/home/why-3.png', text: 'Promotes firming, toning, and brings back the natural glow.' },
  { icon: '/home/why-4.png', text: 'Boosts mental clarity and focus by reducing cortisol levels.' },
];

export const SERVICES: readonly MarketingService[] = [
  {
    id: 'scientific-massage',
    name: 'Scientific Massage',
    summary: 'Evidence-based massage techniques for complete body relaxation.',
    image: '/home/service-1.webp',
    benefits: ['Reduces stress & pain', 'Improves circulation', 'Enhances flexibility'],
  },
  {
    id: 'deep-tissue',
    name: 'Advanced Mechanized Deep Tissue Massage',
    summary: 'High-tech G5 vibration therapy for deep muscle relaxation.',
    image: '/home/service-2.webp',
    benefits: ['Relieves chronic pain', 'Releases muscle knots', 'Improves mobility'],
  },
  {
    id: 'cupping',
    name: 'Cupping Therapy',
    summary: 'Traditional therapy for better circulation & healing.',
    image: '/home/service-3.webp',
    benefits: ['Reduces muscle tension', 'Relieves pain & stiffness', 'Boosts immunity'],
  },
  {
    id: 'ice-bath',
    name: 'Ice Bath',
    summary: 'Cold therapy to reduce inflammation & recover faster.',
    image: '/home/service-4.webp',
    benefits: ['Reduces muscle soreness', 'Speeds up recovery', 'Boosts performance'],
  },
  {
    id: 'steam',
    name: 'Steam',
    summary: 'Deep steam for detox & respiratory wellness.',
    image: '/home/service-5.webp',
    benefits: ['Purifies body', 'Relieves congestion', 'Improves skin health'],
  },
];

export const WHY_CHOOSE: readonly { icon: string; label: string }[] = [
  { icon: '/home/choose-1.png', label: 'Modern Wellness Solutions' },
  { icon: '/home/choose-2.png', label: 'Safe & Hygienic Environment' },
  { icon: '/home/choose-3.png', label: 'Trained & Experienced Therapists' },
  { icon: '/home/choose-4.png', label: 'Affordable & Accessible for All' },
  { icon: '/home/choose-5.png', label: 'Your Wellness, Our Priority' },
];

export interface Testimonial {
  readonly image: string;
  readonly quote: string;
  readonly author: string;
  /** The customer's video, once the client sends it. Until then the picture does not play. */
  readonly videoUrl: string | null;
}

/**
 * As in the design. These must be real customers and their own words — the client is to
 * confirm before launch, and send the videos the play buttons stand for.
 */
export const TESTIMONIALS: readonly Testimonial[] = [
  {
    image: '/home/video-1.webp',
    quote:
      'RESET has truly helped me relax after long hours of work. The massage and ice bath are fantastic!',
    author: 'Rahul S., Pune',
    videoUrl: null,
  },
  {
    image: '/home/video-2.webp',
    quote: 'Excellent service, very professional staff. I feel more energetic now.',
    author: 'Sneha M., Pune',
    videoUrl: null,
  },
];

/** "Watch More Videos" — the shop's video channel. Hidden until there is one to link to. */
export const MORE_VIDEOS_URL: string | null = null;

/**
 * The footer's Instagram, YouTube and Facebook. An icon with no address is shown but not
 * linked, so it never leads to a dead page; fill these in and they become links.
 */
export const SOCIAL: Readonly<Record<'instagram' | 'youtube' | 'facebook', string | null>> = {
  instagram: null,
  youtube: null,
  facebook: null,
};
