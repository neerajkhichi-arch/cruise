/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runs src/instrumentation.ts on server start — that is where the auto-pause
  // loop is armed. Next 14 needs this flag for the hook to fire at all.
  experimental: {
    instrumentationHook: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

module.exports = nextConfig;
