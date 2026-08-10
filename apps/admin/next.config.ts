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

  /**
   * Lets webpack resolve the `.js` specifiers that ESM TypeScript is written with.
   *
   * `packages/ui` and the workspace packages import `./cn.js` and mean `./cn.ts` — that is
   * what NodeNext resolution requires, and tsc rewrites it on the way out. Webpack does not
   * do that rewrite on its own, so without this every relative import inside a transpiled
   * workspace package fails to resolve at build time while typechecking passes cleanly.
   */
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
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
