import type { NextConfig } from "next";

// Static security headers applied to every response. The Content-Security-Policy
// is intentionally NOT set here — it is generated per-request with a fresh nonce
// in `src/proxy.ts` so Next.js can attach the nonce to its own scripts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // The app renders frames with plain <img> + object URLs and ships no remote
  // images, so the Next image optimizer (and its `sharp` dependency) is unused.
  images: { unoptimized: true },
  // Next 16 builds with Turbopack by default. onnxruntime-web resolves its browser
  // build via its package "browser" field, so no node-stub alias is required.
  turbopack: {},
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
