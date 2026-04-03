import { NextResponse } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5;

// In-memory store: Map<ip, { count: number, windowStart: number }>
const ipRequestStore = new Map();

function getClientIp(request) {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

export function middleware(request) {
  const ip = getClientIp(request);
  const now = Date.now();

  const record = ipRequestStore.get(ip);

  if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipRequestStore.set(ip, { count: 1, windowStart: now });
    return NextResponse.next();
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: 'Rate limit terlampaui. Maksimal 5 request per menit per IP.',
      },
      { status: 429 }
    );
  }

  record.count += 1;
  ipRequestStore.set(ip, record);

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
