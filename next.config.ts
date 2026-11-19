import type { NextConfig } from "next";

/**
 * In production (Render) the browser calls same-origin `/v1/*` and Next.js proxies it to the
 * API. That keeps the HttpOnly refresh cookie first-party: two `*.onrender.com` hosts are
 * different sites, so a `SameSite=strict` cookie set by the API host would never be sent.
 * Unset locally, where the browser talks to http://localhost:3000/v1 directly.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The `/v1/*` rewrite proxy aborts upstream requests after 30s by default. The free-tier
    // chat-api sleeps when idle and takes ~1 min to wake, so the first call (usually
    // /auth/refresh) would die with "socket hang up". Give it room to cold-start.
    proxyTimeout: 120_000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [{ source: "/v1/:path*", destination: `${apiProxyTarget}/v1/:path*` }];
  },
};

export default nextConfig;
