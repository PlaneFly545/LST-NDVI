// proxy.js
// Security proxy: Bot UA blocking + Enhanced fingerprint rate limiting.
// Uses Web Crypto API (crypto.subtle) — compatible with Next.js Edge Runtime.
// Turnstile verification is handled per-endpoint in the API handler.
import { NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 menit
const RATE_LIMIT_MAX_REQUESTS = 5;

/** In-memory store: Map<fingerprint, { count, windowStart }> */
const requestStore = new Map();

/** Known bot/scraper/CLI User-Agent patterns to block */
const BOT_UA_PATTERNS = [
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /libwww-perl/i,
  /scrapy\//i,
  /java\//i,
  /aiohttp\//i,
];

function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Build a fingerprint using Web Crypto API (SubtleCrypto).
 * This is the Edge Runtime-compatible equivalent of Node.js crypto.createHash().
 * The `crypto` global here refers to the Web Crypto API, NOT Node.js crypto module.
 */
async function buildFingerprint(ip, ua, lang) {
  const text = `${ip}:${ua}:${lang}`;
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function proxy(request) {
  const ua = request.headers.get('user-agent') || '';

  // ── 1. Bot User-Agent Blocking ──────────────────────────────────────────
  if (!ua.trim() || BOT_UA_PATTERNS.some((p) => p.test(ua))) {
    return NextResponse.json(
      { error: 'Akses tidak diizinkan.' },
      { status: 403 }
    );
  }

  // ── 2. Fingerprint Rate Limiting ────────────────────────────────────────
  const ip   = getClientIp(request);
  const lang = request.headers.get('accept-language') || '';
  const fp   = await buildFingerprint(ip, ua, lang);
  const now  = Date.now();

  const record = requestStore.get(fp);

  if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
    requestStore.set(fp, { count: 1, windowStart: now });
    return NextResponse.next();
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: 'Rate limit terlampaui. Maksimal 5 request per menit.',
      },
      { status: 429 }
    );
  }

  record.count += 1;
  requestStore.set(fp, record);

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
