import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request Content-Security-Policy with a fresh nonce.
 *
 * (Next.js 16 renamed the `middleware` convention to `proxy`.)
 *
 * Next.js automatically attaches this nonce to the <script> tags it emits when it
 * sees a `nonce-...` token in the request's CSP header, which lets us use
 * `'strict-dynamic'` instead of allow-listing hosts.
 *
 * Notes on the directives:
 *   - `'wasm-unsafe-eval'`         — required by onnxruntime-web (WebAssembly).
 *   - `worker-src/child-src blob:` — ORT spins up Web Workers from blob: URLs.
 *   - `img-src blob: data:`        — frames/thumbnails are rendered from object URLs.
 *   - `connect-src 'self'`         — the ONNX model and ORT assets are same-origin.
 *                                    If you serve the model cross-origin, add its host here.
 *   - `'unsafe-eval'` (dev only)   — Next.js HMR / react-refresh needs it in development.
 *   - `upgrade-insecure-requests`  — production only (would break plain-http localhost dev).
 */
export function proxy(request: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    isProd ? "" : "'unsafe-eval'",
  ]
    .filter(Boolean)
    .join(" ");

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    isProd ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Apply to documents only; skip static assets and the model/runtime files.
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|models|ort).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
