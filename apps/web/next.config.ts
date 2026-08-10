import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  transpilePackages: ['@reset/ui', '@reset/api-client', '@reset/types', '@reset/design-tokens'],

  typescript: { ignoreBuildErrors: false },

  /** See the same block in apps/admin — webpack does not do NodeNext's `.js` → `.ts` rewrite. */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The Razorpay checkout opens in an iframe/popup it owns, so this page is never
          // legitimately framed by anyone.
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
