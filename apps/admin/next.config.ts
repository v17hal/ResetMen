import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// See apps/web/next.config.ts: the `.pathname` form yields `/C:/Users/...` on Windows,
// with a leading slash before the drive letter, which is not a valid path.
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,

  // See apps/web/next.config.ts — standalone output, traced from the workspace root so
  // the shared packages come with it.
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,

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
