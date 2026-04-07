// lib/validators/turnstile.js
// Cloudflare Turnstile server-side token verification.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Cloudflare Turnstile token against the Cloudflare API.
 *
 * In local development (no TURNSTILE_SECRET_KEY set), verification is skipped
 * and the function returns true so the app stays functional during dev.
 *
 * @param {string|null} token  The `cf-turnstile-response` value from the frontend
 * @param {string} [ip]        Optional client IP for extra validation
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstileToken(token, ip = '') {
  // Skip verification in dev if secret key is not configured
  if (!process.env.TURNSTILE_SECRET_KEY) {
    if (process.env.NODE_ENV !== 'production') return true;
    return false; // Block in production if key is missing
  }

  if (!token || typeof token !== 'string' || token.length > 2048) return false;

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

    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
