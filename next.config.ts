import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['172.16.0.2', '192.168.1.100'],
  async headers() {
    // Content Security Policy - izinkan Cloudflare Turnstile CDN
    const csp = [
      "default-src 'self'",
      // Script: self + inline (Next.js butuh unsafe-inline) + Turnstile
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      // Style: self + inline (Next.js/Tailwind) + Google Fonts
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Font: self + Google Fonts CDN
      "font-src 'self' https://fonts.gstatic.com",
      // Image: self + data URI + Google Maps tiles
      "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.tile.openstreetmap.org",
      // Fetch/XHR: self + GEE + Supabase + Cloudflare Turnstile verify
      "connect-src 'self' https://*.googleapis.com https://*.supabase.co https://challenges.cloudflare.com",
      // Frame: izinkan Turnstile challenge iframe dari Cloudflare
      "frame-src https://challenges.cloudflare.com",
      // Tidak izinkan embed di iframe pihak lain
      "frame-ancestors 'none'",
      // Worker: hanya self (Leaflet/Map worker)
      "worker-src 'self' blob:",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
