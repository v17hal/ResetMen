import preset from '@reset/ui/tailwind-preset';
import type { Config } from 'tailwindcss';

export default {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    // Not optional: without it Tailwind never sees the classes used inside the shared
    // components and silently ships them unstyled.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
