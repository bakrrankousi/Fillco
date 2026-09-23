/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  // Linting runs once for the whole monorepo (pnpm lint).
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // The browser talks to /api/v1 on the same origin; Next proxies to the API so cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
