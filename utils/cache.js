const NodeCache = require('node-cache');

// Initialize cache with a default TTL of 5 minutes (300 seconds)
// checkperiod: 60 seconds (checks for expired keys once a minute)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

module.exports = {
    get: (key) => cache.get(key),
    set: (key, value, ttl) => cache.set(key, value, ttl),
    del: (key) => cache.del(key),
    flush: () => cache.flushAll(),
    
    // Helper to generate cache keys
    generateKey: (prefix, params = {}) => {
        const queryStr = Object.keys(params)
            .sort()
            .map(k => `${k}=${params[k]}`)
            .join('&');
        return `${prefix}:${queryStr}`;
    }
};
