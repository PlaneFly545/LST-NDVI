// lib/gee/auth.js
// Singleton GEE authentication + timeout utility
import ee from '@google/earthengine';

const TIMEOUT_ERROR_TAG = 'GEE_TIMEOUT';

let geeAuthPromise = null;

/**
 * Authenticate with Google Earth Engine once per cold start.
 * Subsequent calls reuse the same Promise (singleton pattern).
 * If authentication fails, geeAuthPromise is reset so the next
 * request can retry.
 */
export async function authenticate() {
  if (geeAuthPromise) return geeAuthPromise;

  geeAuthPromise = new Promise((resolve, reject) => {
    if (!process.env.GEE_PRIVATE_KEY || !process.env.GEE_CLIENT_EMAIL) {
      reject(new Error('Credential GEE tidak ditemukan.'));
      return;
    }

    const privateKey = process.env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n');

    ee.data.authenticateViaPrivateKey(
      { private_key: privateKey, client_email: process.env.GEE_CLIENT_EMAIL },
      () => ee.initialize(null, null, resolve, reject),
      (error) => reject(error)
    );
  }).catch((err) => {
    geeAuthPromise = null;
    throw err;
  });

  return geeAuthPromise;
}

/**
 * Wraps a Promise with a timeout.
 * If the timeout fires first, rejects with an error tagged
 * with TIMEOUT_ERROR_TAG so the handler can distinguish it.
 *
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 */
export function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        const err = new Error(
          'Proses GEE melebihi batas waktu. GEE sedang memproses di server — coba lagi dalam beberapa detik.'
        );
        err.code = TIMEOUT_ERROR_TAG;
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

export { TIMEOUT_ERROR_TAG };
