// lib/validators/turnstile.js
// Cloudflare Turnstile server-side token verification.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Cloudflare Turnstile token against the Cloudflare API.
 *
 * - In LOCAL DEV (NODE_ENV !== 'production'): always returns true (skip verification).
 * - In PRODUCTION: requires a valid token from the Cloudflare widget.
 *
 * @param {string|null} token  The CF-Turnstile-Token header value from the frontend
 * @param {string} [ip]        Optional client IP for extra validation
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstileToken(token, ip = '') {
  // ── Local development: skip entirely ────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  // ── Production: secret key must exist ───────────────────────────────────
  if (!process.env.TURNSTILE_SECRET_KEY) {
    console.error('[Turnstile] CRITICAL: TURNSTILE_SECRET_KEY is not set in environment variables!');
    return false;
  }

  if (!token) {
    console.warn('[Turnstile] Token is missing from headers.');
    return false;
  }

  if (typeof token !== 'string' || token.length > 2048) {
    console.error('[Turnstile] Invalid token format or length:', typeof token);
    return false;
  }

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });

    const data = await res.json();

    if (!res.ok || data.success !== true) {
      console.error('[Turnstile] Verification failed:', {
        status: res.status,
        success: data.success,
        errorCodes: data['error-codes'],
        ipSent: !!ip
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Turnstile] Verification fetch failed:', err);
    return false;
  }
}
