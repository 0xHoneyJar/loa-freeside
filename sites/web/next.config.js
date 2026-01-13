/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
  },
  // Enable trailing slashes for cleaner URLs
  trailingSlash: false,
  // Disable x-powered-by header
  poweredByHeader: false,
};

module.exports = nextConfig;
