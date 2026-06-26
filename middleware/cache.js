/**
 * cache.js — WattOrbit In-Process Cache Middleware
 * 
 * Uses node-cache (already in dependencies) for zero-cost in-memory caching.
 * Falls back gracefully if cache is unavailable — no silent failures.
 * 
 * For Redis upgrade later, swap NodeCache with ioredis — same API surface.
 */

const NodeCache = require('node-cache');

// Global cache instance: TTL 5 minutes, checks for expired keys every 60s
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

/**
 * Cache keys registry — centralized for easy invalidation
 */
const CACHE_KEYS = {
  CATEGORIES:   'api:categories:active',
  SERVICES:     'api:services:all',
  PROMOTIONS:   'api:promotions:all',
  CURATIONS:    'api:curations:all',
  CITIES:       'api:cities:all',
  MATERIALS:    'api:materials:all',
  PACKAGES:     (serviceId) => `api:packages:${serviceId}`,
};

/**
 * cacheMiddleware(key, ttl?)
 * 
 * Usage:
 *   router.get('/', cacheMiddleware('api:categories:active'), async (req, res) => { ... });
 * 
 * @param {string} key   - Cache key to store/retrieve
 * @param {number} ttl   - TTL in seconds (default: 300 = 5 mins)
 */
function cacheMiddleware(key, ttl = 300) {
  return (req, res, next) => {
    try {
      const cached = cache.get(key);
      if (cached !== undefined) {
        // Cache HIT — serve instantly, bypass DB
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
      // Cache MISS — intercept res.json to store result
      res.setHeader('X-Cache', 'MISS');
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cache.set(key, data, ttl);
        }
        return originalJson(data);
      };
      next();
    } catch (err) {
      // Never let cache errors break the API
      console.warn('[Cache] Middleware error, bypassing:', err.message);
      next();
    }
  };
}

/**
 * invalidateCache(...keys)
 * Call this after any write (POST/PUT/DELETE) to clear stale cache.
 * 
 * Usage:
 *   invalidateCache(CACHE_KEYS.CATEGORIES);
 */
function invalidateCache(...keys) {
  keys.forEach(key => {
    try { cache.del(key); } catch (e) { /* ignore */ }
  });
}

/**
 * Cache stats — expose via /api/heartbeat or admin endpoint
 */
function getCacheStats() {
  return {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    ksize: cache.getStats().ksize,
    vsize: cache.getStats().vsize,
  };
}

module.exports = { cacheMiddleware, invalidateCache, CACHE_KEYS, getCacheStats, cache };
