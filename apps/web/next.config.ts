import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// `new URL('../..', import.meta.url).pathname` looks equivalent and is not: on Windows it
// yields `/C:/Users/...`, with a leading slash before the drive letter, which is not a
// valid path. fileURLToPath handles both platforms.
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,

  // Traces exactly the files the server needs into .next/standalone — roughly 100 MB
  // instead of shipping the whole workspace's node_modules into the image.
  output: 'standalone',
  // The trace root is the workspace, not this app, or the shared packages are left behind.
  outputFileTracingRoot: workspaceRoot,

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
