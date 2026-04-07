// middleware.js
// Security middleware: Bot UA blocking + Enhanced fingerprint rate limiting.
// Turnstile verification is handled per-endpoint in the API handler (needs async fetch).
import { NextResponse } from 'next/server';
import crypto from 'crypto';

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
 * Build a fingerprint from IP + User-Agent + Accept-Language.
 * Much harder to bypass than IP alone because it requires
 * matching all three values simultaneously.
 */
function buildFingerprint(ip, ua, lang) {
  return crypto
    .createHash('sha256')
    .update(`${ip}:${ua}:${lang}`)
    .digest('hex')
    .slice(0, 16);
}

export function middleware(request) {
  const ua = request.headers.get('user-agent') || '';

  // ── 1. Bot User-Agent Blocking ──────────────────────────────────────────
  // Reject empty UA or known bot/CLI patterns
  if (!ua.trim() || BOT_UA_PATTERNS.some((p) => p.test(ua))) {
    return NextResponse.json(
      { error: 'Akses tidak diizinkan.' },
      { status: 403 }
    );
  }

  // ── 2. Fingerprint Rate Limiting ────────────────────────────────────────
  const ip   = getClientIp(request);
  const lang = request.headers.get('accept-language') || '';
  const fp   = buildFingerprint(ip, ua, lang);
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
