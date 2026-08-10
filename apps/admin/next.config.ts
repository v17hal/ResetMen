import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * `@reset/ui` and `@reset/api-client` are consumed as TypeScript source rather than as
   * built artifacts, so Next has to compile them alongside the app. Without this the build
   * fails on the first `.ts` import from a workspace package.
   */
  transpilePackages: ['@reset/ui', '@reset/api-client', '@reset/types', '@reset/design-tokens'],

  typescript: {
    // A type error must fail the build. Shipping an admin panel that does not compile is
    // how a store ends up unable to check anyone in.
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
