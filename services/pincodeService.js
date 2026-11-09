const axios = require('axios');
const City = require('../models/City');
const Config = require('../models/Config');
const cache = require('../utils/cache');

// Standard District/City to PIN code prefix mapping across supported regions
const CITY_PREFIX_MAP = {
    'lucknow': { prefixes: ['226'], state: 'Uttar Pradesh' },
    'ayodhya': { prefixes: ['224'], state: 'Uttar Pradesh' },
    'faizabad': { prefixes: ['224'], state: 'Uttar Pradesh' },
    'sitapur': { prefixes: ['261'], state: 'Uttar Pradesh' },
    'bareilly': { prefixes: ['243'], state: 'Uttar Pradesh' },
    'lakhimpur': { prefixes: ['262'], state: 'Uttar Pradesh' },
    'lakhimpur kheri': { prefixes: ['262'], state: 'Uttar Pradesh' },
    'varanasi': { prefixes: ['221'], state: 'Uttar Pradesh' },
    'gonda': { prefixes: ['271'], state: 'Uttar Pradesh' },
    'ambedkar nagar': { prefixes: ['224'], state: 'Uttar Pradesh' },
    'akbarpur': { prefixes: ['224'], state: 'Uttar Pradesh' },
    'ghaziabad': { prefixes: ['201'], state: 'Uttar Pradesh' },
    'noida': { prefixes: ['201'], state: 'Uttar Pradesh' },
    'kanpur': { prefixes: ['208'], state: 'Uttar Pradesh' },
    'prayagraj': { prefixes: ['211'], state: 'Uttar Pradesh' },
    'allahabad': { prefixes: ['211'], state: 'Uttar Pradesh' },
    'gorakhpur': { prefixes: ['273'], state: 'Uttar Pradesh' },
    'delhi': { prefixes: ['110'], state: 'Delhi' },
    'mumbai': { prefixes: ['400'], state: 'Maharashtra' },
    'bangalore': { prefixes: ['560'], state: 'Karnataka' },
    'bengaluru': { prefixes: ['560'], state: 'Karnataka' },
    'hyderabad': { prefixes: ['500'], state: 'Telangana' }
};

/**
 * Normalizes city names for fuzzy comparison
 */
function normalizeName(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Get active serviceable cities from DB and defaults
 */
async function getActiveServiceableCities() {
    const cached = cache.get('active_serviceable_cities');
    if (cached) return cached;

    try {
        const dbCities = await City.find({}).lean();
        
        // If DB has cities, map them
        let cityMap = {};
        if (dbCities && dbCities.length > 0) {
            dbCities.forEach(c => {
                const norm = normalizeName(c.name);
                const defaultMapping = CITY_PREFIX_MAP[c.name.toLowerCase().trim()] || {};
                cityMap[norm] = {
                    name: c.name,
                    state: c.state,
                    isServiceable: c.isServiceableForDelivery !== false,
                    prefixes: (c.pincodePrefixes && c.pincodePrefixes.length > 0)
                        ? c.pincodePrefixes
                        : (defaultMapping.prefixes || [])
                };
            });
        } else {
            // Default active cities fallback
            Object.keys(CITY_PREFIX_MAP).forEach(k => {
                cityMap[normalizeName(k)] = {
                    name: k.charAt(0).toUpperCase() + k.slice(1),
                    state: CITY_PREFIX_MAP[k].state,
                    isServiceable: true,
                    prefixes: CITY_PREFIX_MAP[k].prefixes
                };
            });
        }

        cache.set('active_serviceable_cities', cityMap, 300); // 5 min cache
        return cityMap;
    } catch (err) {
        console.error('[PincodeService] Error getting active cities:', err);
        return {};
    }
}

/**
 * Check Postal Pincode API (Official India Post Data)
 * Returns { district, state, postOffices }
 */
async function lookupPostalAPI(pincode) {
    const cacheKey = `postal_api_${pincode}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const res = await axios.get(`https://api.postalpincode.in/pincode/${pincode}`, { timeout: 3500 });
        if (res.data && res.data[0] && res.data[0].Status === 'Success' && res.data[0].PostOffice) {
            const firstPO = res.data[0].PostOffice[0];
            const data = {
                district: firstPO.District || '',
                state: firstPO.State || '',
                area: firstPO.Name || '',
                postOffices: res.data[0].PostOffice.map(p => p.Name)
            };
            cache.set(cacheKey, data, 86400); // 24 hours
            return data;
        }
    } catch (err) {
        console.warn(`[PincodeService] India Post API lookup failed for ${pincode}:`, err.message);
    }

    return null;
}

/**
 * Check if a 6-digit PIN code is serviceable.
 * Covers ALL pincodes for active cities automatically.
 */
async function checkServiceability(pincode) {
    if (!pincode || !/^\d{6}$/.test(pincode.toString().trim())) {
        return { available: false, message: 'Invalid 6-digit PIN code' };
    }

    const cleanPin = pincode.toString().trim();

    // 1. Check Manual Overrides from Config (serviceable_pincodes)
    try {
        const config = await Config.findOne({ key: 'serviceable_pincodes' }).lean();
        if (config && config.value) {
            let manualList = [];
            try {
                manualList = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
            } catch (e) {
                manualList = config.value.split(',').map(p => ({ code: p.trim(), isActive: true }));
            }

            const override = manualList.find(p => p.code === cleanPin);
            if (override) {
                if (override.isActive === false) {
                    return {
                        available: false,
                        pincode: cleanPin,
                        message: 'Delivery is temporarily paused for this specific PIN code.'
                    };
                }
                return {
                    available: true,
                    pincode: cleanPin,
                    city: override.desc || 'Serviceable Area',
                    message: `Delivery available to ${override.desc || cleanPin}`
                };
            }
        }
    } catch (e) {
        console.error('[PincodeService] Manual override check error:', e);
    }

    // 2. Check City Prefix / Range Matches
    const activeCities = await getActiveServiceableCities();
    for (const [normKey, cityData] of Object.entries(activeCities)) {
        if (!cityData.isServiceable) continue;

        // Check if cleanPin starts with any prefix for this city
        if (cityData.prefixes && cityData.prefixes.some(pref => cleanPin.startsWith(pref))) {
            return {
                available: true,
                pincode: cleanPin,
                city: cityData.name,
                state: cityData.state,
                message: `Delivery available in ${cityData.name} (${cleanPin})`
            };
        }
    }

    // 3. Fallback: Lookup India Post API dynamically
    const postalInfo = await lookupPostalAPI(cleanPin);
    if (postalInfo && postalInfo.district) {
        const normDistrict = normalizeName(postalInfo.district);
        const normState = normalizeName(postalInfo.state);

        // Check if district matches any of our active cities
        for (const [normKey, cityData] of Object.entries(activeCities)) {
            if (!cityData.isServiceable) continue;

            const matchesDistrict = normDistrict.includes(normKey) || normKey.includes(normDistrict);
            if (matchesDistrict) {
                return {
                    available: true,
                    pincode: cleanPin,
                    city: cityData.name || postalInfo.district,
                    state: postalInfo.state,
                    area: postalInfo.area,
                    message: `Delivery available in ${cityData.name || postalInfo.district} (${cleanPin})`
                };
            }
        }
    }

    return {
        available: false,
        pincode: cleanPin,
        message: 'Delivery is not available to this PIN code yet.'
    };
}

module.exports = {
    checkServiceability,
    getActiveServiceableCities,
    CITY_PREFIX_MAP
};
