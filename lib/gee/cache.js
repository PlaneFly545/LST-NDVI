// lib/gee/cache.js
// In-memory response cache for GEE API results (24h TTL, max 200 entries).
import crypto from 'crypto';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const MAX_ENTRIES  = 200;

/** @type {Map<string, { ts: number, data: object }>} */
const geeCache = new Map();

/**
 * Build a deterministic SHA-256 cache key from a params object.
 * Keys are sorted alphabetically before hashing so param order
 * doesn't produce different cache entries.
 *
 * @param {object} params
 * @returns {string} hex digest
 */
export function buildCacheKey(params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

/**
 * Retrieve a cached entry, or null if missing / expired.
 *
 * @param {string} key
 * @returns {object|null}
 */
export function getCached(key) {
  const entry = geeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    geeCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store data in the cache.
 * Evicts the oldest entry if the cache is at capacity (FIFO).
 *
 * @param {string} key
 * @param {object} data
 */
export function setCache(key, data) {
  if (geeCache.size >= MAX_ENTRIES) {
    // Map preserves insertion order — first key is the oldest
    const oldestKey = geeCache.keys().next().value;
    geeCache.delete(oldestKey);
  }
  geeCache.set(key, { ts: Date.now(), data });
}

/**
 * Return current cache statistics (useful for debugging/monitoring).
 *
 * @returns {{ size: number, maxEntries: number, ttlHours: number }}
 */
export function getCacheStats() {
  return {
    size: geeCache.size,
    maxEntries: MAX_ENTRIES,
    ttlHours: CACHE_TTL_MS / 3_600_000,
  };
}
